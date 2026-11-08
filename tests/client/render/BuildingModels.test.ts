import { describe, expect, test } from "vitest";
import {
  buildModelAtlas,
  MAT,
  MODEL_BUILDERS,
} from "../../../src/client/render/gl/view3d/BuildingModels";

describe("3D building models", () => {
  test.each(Object.keys(MODEL_BUILDERS))("%s is a well-formed mesh", (type) => {
    const m = MODEL_BUILDERS[type]();
    const n = m.materials.length;
    expect(n).toBeGreaterThan(0);
    expect(n % 3).toBe(0); // whole triangles
    expect(m.positions).toHaveLength(n * 3);
    expect(m.normals).toHaveLength(n * 3);
    const mats = new Set<number>(Object.values(MAT));
    for (let i = 0; i < n; i++) {
      const [x, y, z] = m.positions.slice(i * 3, i * 3 + 3);
      // Fits the unit footprint (a little overhang allowed) and stands on
      // the ground.
      expect(Math.abs(x)).toBeLessThanOrEqual(0.56);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.56);
      expect(z).toBeGreaterThanOrEqual(-1e-9);
      expect(z).toBeLessThanOrEqual(1.0);
      const [nx, ny, nz] = m.normals.slice(i * 3, i * 3 + 3);
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 1);
      expect(mats.has(m.materials[i])).toBe(true);
    }
    // Every model shows its owner's color somewhere.
    expect(
      m.materials.some((mm) => mm === MAT.owner || mm === MAT.ownerDark),
    ).toBe(true);
  });

  test("the atlas packs every model in contiguous ranges", () => {
    const { mesh, ranges } = buildModelAtlas();
    let next = 0;
    for (const type of Object.keys(MODEL_BUILDERS)) {
      const r = ranges.get(type)!;
      expect(r.first).toBe(next);
      next += r.count;
    }
    expect(next).toBe(mesh.materials.length);
  });
});
