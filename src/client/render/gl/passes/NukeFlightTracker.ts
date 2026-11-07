/**
 * NukeFlightTracker — per-tick bookkeeping for nukes in flight (CPU only).
 *
 * The simulation only gives a nuke's current and previous tile. The enhanced
 * nuke renderer (NukeFlightPass) also needs where it's heading (to point the
 * missile and its exhaust) and how far through its flight it is (shadow
 * height, terminal-phase warning glow). This tracks each nuke's launch point
 * across ticks and derives both.
 */

import type { UnitState } from "../../types";
import {
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
} from "../../types";

/** Visual kind per nuke type; also indexes the shader's per-kind styling. */
export const NUKE_KIND: ReadonlyMap<string, number> = new Map([
  [UT_ATOM_BOMB, 0],
  [UT_HYDROGEN_BOMB, 1],
  [UT_MIRV, 2],
  [UT_MIRV_WARHEAD, 3],
]);

export interface NukeFlight {
  id: number;
  kind: number;
  ownerID: number;
  /** Tile at the previous tick and now; renderers lerp between them. */
  lastX: number;
  lastY: number;
  x: number;
  y: number;
  /** Unit heading at the previous tick and now (normalized). */
  lastDirX: number;
  lastDirY: number;
  dirX: number;
  dirY: number;
  /** 0 at launch → 1 at the target. */
  progress: number;
  targetable: boolean;
  /** Stable per-nuke value in [0,1) for animation phase offsets. */
  seed: number;
}

interface Track {
  originX: number;
  originY: number;
  dirX: number;
  dirY: number;
}

function hash01(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export class NukeFlightTracker {
  private tracks = new Map<number, Track>();
  private seen = new Set<number>();
  readonly flights: NukeFlight[] = [];

  constructor(private mapW: number) {}

  update(units: Map<number, UnitState>): readonly NukeFlight[] {
    this.flights.length = 0;
    this.seen.clear();
    const w = this.mapW;
    for (const unit of units.values()) {
      const kind = NUKE_KIND.get(unit.unitType);
      if (kind === undefined || !unit.isActive || unit.waitTicks > 0) continue;
      this.seen.add(unit.id);

      const x = unit.pos % w;
      const y = (unit.pos - x) / w;
      const lx = unit.lastPos % w;
      const ly = (unit.lastPos - lx) / w;

      let track = this.tracks.get(unit.id);
      if (!track) {
        // First sighting: the launch point is where it was last tick.
        track = { originX: lx, originY: ly, dirX: 0, dirY: -1 };
        this.tracks.set(unit.id, track);
        if (unit.targetTile !== null) {
          const tx = unit.targetTile % w;
          const ty = (unit.targetTile - tx) / w;
          const d = Math.hypot(tx - x, ty - y);
          if (d > 0) {
            track.dirX = (tx - x) / d;
            track.dirY = (ty - y) / d;
          }
        }
      }
      const lastDirX = track.dirX;
      const lastDirY = track.dirY;
      const mx = x - lx;
      const my = y - ly;
      const moved = Math.hypot(mx, my);
      if (moved > 0) {
        track.dirX = mx / moved;
        track.dirY = my / moved;
      }

      let progress = 0;
      if (unit.targetTile !== null) {
        const tx = unit.targetTile % w;
        const ty = (unit.targetTile - tx) / w;
        const total = Math.hypot(tx - track.originX, ty - track.originY);
        const left = Math.hypot(tx - x, ty - y);
        progress = total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 1;
      }

      this.flights.push({
        id: unit.id,
        kind,
        ownerID: unit.ownerID,
        lastX: lx,
        lastY: ly,
        x,
        y,
        lastDirX,
        lastDirY,
        dirX: track.dirX,
        dirY: track.dirY,
        progress,
        targetable: unit.targetable,
        seed: hash01(unit.id),
      });
    }
    // Forget nukes that are gone.
    for (const id of this.tracks.keys()) {
      if (!this.seen.has(id)) this.tracks.delete(id);
    }
    return this.flights;
  }
}

/** Interpolated position + heading of a flight, `alpha` 0..1 through a tick. */
export function interpolateFlight(
  f: NukeFlight,
  alpha: number,
): { x: number; y: number; dirX: number; dirY: number } {
  const a = Math.min(1, Math.max(0, alpha));
  let dx = f.lastDirX + (f.dirX - f.lastDirX) * a;
  let dy = f.lastDirY + (f.dirY - f.lastDirY) * a;
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) {
    dx /= len;
    dy /= len;
  } else {
    dx = f.dirX;
    dy = f.dirY;
  }
  return {
    x: f.lastX + (f.x - f.lastX) * a,
    y: f.lastY + (f.y - f.lastY) * a,
    dirX: dx,
    dirY: dy,
  };
}
