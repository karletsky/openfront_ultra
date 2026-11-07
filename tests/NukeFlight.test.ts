import { describe, expect, test } from "vitest";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import {
  interpolateFlight,
  NukeFlightTracker,
} from "../src/client/render/gl/passes/NukeFlightTracker";
import { applyGraphicsOverrides } from "../src/client/render/gl/RenderOverrides";
import { createRenderSettings } from "../src/client/render/gl/RenderSettings";
import type { UnitState } from "../src/client/render/types";

const W = 100;
const ref = (x: number, y: number) => y * W + x;

function unit(over: Partial<UnitState>): UnitState {
  return {
    id: 1,
    unitType: "Atom Bomb",
    ownerID: 7,
    lastOwnerID: null,
    pos: 0,
    lastPos: 0,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    waitTicks: 0,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    targetUnitId: null,
    targetTile: null,
    troops: 0,
    missileTimerQueue: [],
    level: 1,
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    samUpgradeStartTick: null,
    samUpgradeStartRange: null,
    samUpgradeTargetLevel: null,
    samUpgradeDuration: null,
    ...over,
  };
}

function units(...us: UnitState[]): Map<number, UnitState> {
  return new Map(us.map((u) => [u.id, u]));
}

describe("NukeFlightTracker", () => {
  test("tracks only nukes, with kinds per type", () => {
    const t = new NukeFlightTracker(W);
    const flights = t.update(
      units(
        unit({ id: 1, unitType: "Atom Bomb" }),
        unit({ id: 2, unitType: "Hydrogen Bomb" }),
        unit({ id: 3, unitType: "MIRV" }),
        unit({ id: 4, unitType: "MIRV Warhead" }),
        unit({ id: 5, unitType: "Warship" }),
        unit({ id: 6, unitType: "Atom Bomb", isActive: false }),
      ),
    );
    expect(flights.map((f) => [f.id, f.kind])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
  });

  test("points along its motion and measures progress from launch", () => {
    const t = new NukeFlightTracker(W);
    // Launched at (10,50), flying east toward (50,50).
    let [f] = t.update(
      units(
        unit({
          pos: ref(10, 50),
          lastPos: ref(10, 50),
          targetTile: ref(50, 50),
        }),
      ),
    );
    // Not moved yet: aims at the target.
    expect(f.dirX).toBeCloseTo(1);
    expect(f.dirY).toBeCloseTo(0);
    expect(f.progress).toBeCloseTo(0);

    [f] = t.update(
      units(
        unit({
          pos: ref(30, 40),
          lastPos: ref(20, 40),
          targetTile: ref(50, 50),
        }),
      ),
    );
    expect(f.dirX).toBeCloseTo(1);
    expect(f.dirY).toBeCloseTo(0);
    // Launch point is remembered across ticks: 1 - dist(30,40→50,50)/40.
    expect(f.progress).toBeCloseTo(1 - Math.hypot(20, 10) / 40, 6);
  });

  test("keeps its heading while stationary and forgets dead nukes", () => {
    const t = new NukeFlightTracker(W);
    t.update(units(unit({ pos: ref(5, 6), lastPos: ref(5, 5) })));
    let [f] = t.update(units(unit({ pos: ref(5, 6), lastPos: ref(5, 6) })));
    expect(f.dirY).toBeCloseTo(1);
    // Gone for a tick, then a new nuke reuses the id: fresh launch point.
    t.update(new Map());
    [f] = t.update(
      units(
        unit({
          pos: ref(40, 40),
          lastPos: ref(40, 40),
          targetTile: ref(40, 80),
        }),
      ),
    );
    expect(f.progress).toBeCloseTo(0);
  });

  test("interpolates position and heading through a tick", () => {
    const t = new NukeFlightTracker(W);
    t.update(units(unit({ pos: ref(10, 10), lastPos: ref(10, 9) }))); // south
    const [f] = t.update(
      units(unit({ pos: ref(12, 10), lastPos: ref(10, 10) })),
    ); // east
    const start = interpolateFlight(f, 0);
    expect([start.x, start.y]).toEqual([10, 10]);
    expect(start.dirY).toBeCloseTo(1);
    const mid = interpolateFlight(f, 0.5);
    expect(mid.x).toBeCloseTo(11);
    expect(Math.hypot(mid.dirX, mid.dirY)).toBeCloseTo(1);
    expect(mid.dirX).toBeGreaterThan(0);
    expect(mid.dirY).toBeGreaterThan(0);
    const end = interpolateFlight(f, 5); // clamped
    expect([end.x, end.y]).toEqual([12, 10]);
    expect(end.dirX).toBeCloseTo(1);
  });
});

describe("enhanced units setting", () => {
  test("on by default; one override turns every upgrade off", () => {
    const d = createRenderSettings();
    expect(d.unit.enhancedNukes).toBe(true);
    expect(d.unit.shipOutline).toBe(true);
    expect(d.fx.enhancedNukeExplosion).toBe(true);

    const overrides = { units: { enhanced: false } };
    expect(GraphicsOverridesSchema.safeParse(overrides).success).toBe(true);
    const s = createRenderSettings();
    applyGraphicsOverrides(s, overrides);
    expect(s.unit.enhancedNukes).toBe(false);
    expect(s.unit.shipOutline).toBe(false);
    expect(s.fx.enhancedNukeExplosion).toBe(false);
  });
});
