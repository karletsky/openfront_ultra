import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  UnitUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { TechId } from "@openfront/engine-api/game/Tech";
import {
  packUnitUpdates,
  unpackUnitUpdates,
} from "@openfront/engine-lib/game/PackedUnitUpdates";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { RadiationExecution } from "@openfront/engine/execution/RadiationExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";
import { executeTicks } from "../util/utils";

/** Real blast radii, fast flights. */
class RealNukeConfig extends TestConfig {
  nukeMagnitudes(...args: Parameters<EngineConfig["nukeMagnitudes"]>) {
    return EngineConfig.prototype.nukeMagnitudes.apply(this, args);
  }
  nukeSpeed(): number {
    return 50;
  }
}

const A = new PlayerInfo("a", PlayerType.Human, "ca", "a");
const B = new PlayerInfo("b", PlayerType.Human, "cb", "b");

function grant(player: Player, ...techs: TechId[]) {
  for (const t of techs) {
    (player as unknown as { _techs: Set<TechId> })._techs.add(t);
  }
}

/** Give `p` a filled square of land. */
function claim(g: Game, p: Player, x0: number, y0: number, size: number) {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) p.conquer(g.ref(x, y));
  }
}

async function world(advancedWarfare = true) {
  const g = await setup(
    "big_plains",
    { infiniteGold: true, instantBuild: true, advancedWarfare },
    [A, B],
    __dirname,
    RealNukeConfig,
  );
  const a = g.player(A.id);
  const b = g.player(B.id);
  claim(g, a, 2, 2, 12);
  claim(g, b, 60, 60, 60);
  b.addTroops(100_000);
  g.addExecution(
    new ConstructionExecution(a, UnitType.MissileSilo, g.ref(5, 5)),
  );
  executeTicks(g, 3);
  expect(a.units(UnitType.MissileSilo)).toHaveLength(1);
  return { g, a, b };
}

/** Launch and fly a nuke to `target` until it detonates. */
function strike(g: Game, a: Player, type: UnitType, target: number) {
  const exec = new NukeExecution(type as never, a, target);
  g.addExecution(exec);
  for (let i = 0; i < 200 && exec.isActive(); i++) g.executeNextTick();
  expect(exec.isActive()).toBe(false);
}

describe("Advanced warfare nukes", () => {
  test("need advanced warfare and the unlocking tech", async () => {
    const off = await world(false);
    grant(off.a, TechId.TacticalNukes);
    expect(off.a.canBuild(UnitType.TacticalNuke, off.g.ref(90, 90))).toBe(
      false,
    );

    const { g, a } = await world();
    const target = g.ref(90, 90);
    expect(a.canBuild(UnitType.TacticalNuke, target)).toBe(false);
    expect(a.canBuild(UnitType.EMPBomb, target)).toBe(false);
    grant(a, TechId.TacticalNukes);
    expect(a.canBuild(UnitType.TacticalNuke, target)).not.toBe(false);
    expect(a.canBuild(UnitType.EMPBomb, target)).toBe(false);
    grant(a, TechId.Electromagnetics, TechId.RadiologicalWeapons);
    expect(a.canBuild(UnitType.EMPBomb, target)).not.toBe(false);
    expect(a.canBuild(UnitType.DirtyBomb, target)).not.toBe(false);
  });

  test("tactical nuke: small blast that destroys land and troops", async () => {
    const { g, a, b } = await world();
    grant(a, TechId.TacticalNukes);
    const tiles = b.numTilesOwned();
    const troops = b.troops();
    strike(g, a, UnitType.TacticalNuke, g.ref(90, 90));
    const lost = tiles - b.numTilesOwned();
    const outer = g.config().nukeMagnitudes(UnitType.TacticalNuke).outer;
    expect(lost).toBeGreaterThan(0);
    // Never more than the outer disc.
    expect(lost).toBeLessThanOrEqual(Math.ceil(Math.PI * outer * outer) + 4);
    expect(b.troops()).toBeLessThan(troops);
    // Not in the closed-source stats schema: recorded nowhere, no crash.
    expect(g.stats().stats()[a.clientID()!]?.bombs?.abomb).toBeUndefined();
  });

  test("EMP: no damage, disables structures in range for a while", async () => {
    const { g, a, b } = await world();
    grant(a, TechId.TacticalNukes, TechId.Electromagnetics);
    const near = b.buildUnit(UnitType.SAMLauncher, g.ref(110, 112), {});
    const far = b.buildUnit(UnitType.SAMLauncher, g.ref(61, 61), {});
    const tiles = b.numTilesOwned();
    const troops = b.troops();

    // Blast at (118,118): the near SAM is ~10 tiles away, the far one ~81,
    // outside the 70-tile EMP radius.
    strike(g, a, UnitType.EMPBomb, g.ref(118, 118));
    // No land or troops lost, nothing destroyed.
    expect(b.numTilesOwned()).toBe(tiles);
    expect(b.troops()).toBeGreaterThanOrEqual(troops);
    expect(near.isActive()).toBe(true);
    expect(near.isDisabled()).toBe(true);
    expect(far.isDisabled()).toBe(false);
    // The client is told when it ends.
    expect(near.toUpdate().disabledUntil).toBe(near.disabledUntil());

    executeTicks(g, g.config().empDisableTicks());
    expect(near.isDisabled()).toBe(false);
  });

  test("EMP-disabled silos can't launch", async () => {
    const { g, a } = await world();
    grant(a, TechId.TacticalNukes, TechId.Electromagnetics);
    const silo = a.units(UnitType.MissileSilo)[0];
    silo.disableUntil(g.ticks() + 50);
    expect(a.canBuild(UnitType.TacticalNuke, g.ref(90, 90))).toBe(false);
    executeTicks(g, 51);
    expect(a.canBuild(UnitType.TacticalNuke, g.ref(90, 90))).not.toBe(false);
  });

  test("dirty bomb: radiation zone keeps taking land, then ends", async () => {
    const { g, a, b } = await world();
    grant(a, TechId.TacticalNukes, TechId.RadiologicalWeapons);
    strike(g, a, UnitType.DirtyBomb, g.ref(90, 90));
    const afterBlast = b.numTilesOwned();

    executeTicks(g, 60);
    const afterPulses = b.numTilesOwned();
    expect(afterPulses).toBeLessThan(afterBlast);
    // Lost land becomes fallout.
    expect(g.numTilesWithFallout()).toBeGreaterThan(0);

    // The zone survives a snapshot round trip mid-effect.
    await expectSnapshotRoundTrip(g, "big_plains", 25);

    executeTicks(g, g.config().dirtyBombZoneTicks());
    const settled = b.numTilesOwned();
    executeTicks(g, 60);
    expect(b.numTilesOwned()).toBe(settled);
  });

  test("radiation zone pulses are deterministic", async () => {
    const run = async () => {
      const { g, a, b } = await world();
      g.addExecution(
        new RadiationExecution(a, g.ref(90, 90), 20, g.ticks() + 200),
      );
      executeTicks(g, 120);
      return b.numTilesOwned();
    };
    expect(await run()).toBe(await run());
  });
});

describe("EMP state on the wire", () => {
  test("disabledUntil and the new unit types survive packing", () => {
    const update: UnitUpdate = {
      type: GameUpdateType.Unit,
      unitType: UnitType.SAMLauncher,
      troops: 0,
      id: 9,
      ownerID: 3,
      pos: 1234,
      lastPos: 1234,
      isActive: true,
      reachedTarget: false,
      targetable: true,
      markedForDeletion: false,
      level: 2,
      hasTrainStation: false,
      missileTimerQueue: [],
      disabledUntil: 812,
    };
    const nuke: UnitUpdate = {
      ...update,
      id: 10,
      unitType: UnitType.DirtyBomb,
      disabledUntil: undefined,
    };
    const { packedUnitUpdates, packedMissileTimers } = packUnitUpdates([
      update,
      nuke,
    ]);
    const [a, b] = unpackUnitUpdates(packedUnitUpdates, packedMissileTimers);
    expect(a.disabledUntil).toBe(812);
    expect(a.unitType).toBe(UnitType.SAMLauncher);
    expect(b.unitType).toBe(UnitType.DirtyBomb);
    expect(b.disabledUntil).toBeUndefined();
  });
});
