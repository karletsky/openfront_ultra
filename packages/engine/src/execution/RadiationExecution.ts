import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** How often the zone pulses, in ticks. */
export const RADIATION_PULSE_TICKS = 20;
/** One in this many owned tiles in the zone falls back to fallout per pulse. */
export const RADIATION_TILE_CHANCE = 6;

/**
 * Advanced warfare: the lingering radiation zone a dirty bomb leaves behind.
 *
 * Every pulse, a share of the land anyone holds inside the zone is lost back
 * to fallout, together with the troops stationed on it (the owner's troop
 * density per lost tile). Nobody can hold the area while it lasts; once it
 * expires the land stays as fallout until someone retakes it, like any nuke.
 * The bomber's own land is hit too.
 */
export class RadiationExecution implements Execution {
  private mg: Game | null = null;
  private active = true;

  constructor(
    private bomber: Player,
    private center: TileRef,
    private radius: number,
    private endTick: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    if (ticks >= this.endTick) {
      this.active = false;
      return;
    }
    if ((this.endTick - ticks) % RADIATION_PULSE_TICKS !== 0) return;
    this.pulse(mg, ticks);
  }

  private pulse(mg: Game, ticks: number): void {
    // Seeded by tick and place: deterministic on every client.
    const rand = new PseudoRandom(ticks * 7919 + this.center);
    const cx = mg.x(this.center);
    const cy = mg.y(this.center);
    const r = this.radius;
    const r2 = r * r;
    const lost = new Map<Player, number>();
    for (
      let y = Math.max(0, cy - r);
      y <= Math.min(mg.height() - 1, cy + r);
      y++
    ) {
      for (
        let x = Math.max(0, cx - r);
        x <= Math.min(mg.width() - 1, cx + r);
        x++
      ) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const tile = mg.ref(x, y);
        if (!mg.isLand(tile) || mg.isImpassable(tile)) continue;
        const owner = mg.owner(tile);
        if (!owner.isPlayer()) continue;
        if (!rand.chance(RADIATION_TILE_CHANCE)) continue;
        lost.set(owner, (lost.get(owner) ?? 0) + 1);
        owner.relinquish(tile);
        mg.setFallout(tile, true);
      }
    }
    for (const [player, tiles] of lost) {
      // The troops that were holding the lost land die with it.
      const owned = player.numTilesOwned() + tiles;
      const deaths = Math.floor((player.troops() * tiles) / Math.max(1, owned));
      player.removeTroops(deaths);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  owner(): Player {
    return this.bomber;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return RadiationExecutionSnapshot.write({
      active: this.active,
      bomber: w.player(this.bomber),
      center: this.center,
      radius: this.radius,
      endTick: this.endTick,
    });
  }

  restoreSnapshot(s: RadiationState, r: SnapshotReader): void {
    this.mg = r.game;
    this.active = s.active;
    this.bomber = r.player(s.bomber);
    this.center = s.center;
    this.radius = s.radius;
    this.endTick = s.endTick;
  }
}

const RadiationStateSchema = z.object({
  active: z.boolean(),
  bomber: zPlayerRef(),
  center: zTile(),
  radius: zInt(),
  endTick: zInt(),
});
type RadiationState = z.infer<typeof RadiationStateSchema>;

export const RadiationExecutionSnapshot = execSnapshotType({
  name: "Radiation",
  version: 1,
  schema: RadiationStateSchema,
  cls: () => RadiationExecution,
});
