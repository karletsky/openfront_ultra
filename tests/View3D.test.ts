import { describe, expect, test } from "vitest";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import { applyGraphicsOverrides } from "../src/client/render/gl/RenderOverrides";
import { createRenderSettings } from "../src/client/render/gl/RenderSettings";
import {
  HeightField,
  rawHeight,
} from "../src/client/render/gl/view3d/HeightField";
import {
  buildView3D,
  fitOrtho,
  groundFootprint,
  projectToScreen,
  rayToPlane,
  rayToTerrain,
  type View3DParams,
} from "../src/client/render/gl/view3d/Projection3D";
import { View3DProjector } from "../src/client/render/gl/view3d/View3DProjector";

const base: View3DParams = {
  centerX: 500,
  centerY: 300,
  zoom: 2,
  viewW: 1200,
  viewH: 800,
  pitchDeg: 40,
  fovDeg: 35,
};

/** Apply a column-major mat4 to a point and return NDC. */
function clip(m: Float32Array, x: number, y: number, z: number) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return { x: cx / cw, y: cy / cw, z: cz / cw, w: cw };
}

describe("Projection3D", () => {
  test("the look-at point projects to the screen center", () => {
    for (const pitchDeg of [0, 20, 45, 60]) {
      const v = buildView3D({ ...base, pitchDeg });
      const p = projectToScreen(v, base.centerX, base.centerY, 0);
      expect(p.x).toBeCloseTo(600, 6);
      expect(p.y).toBeCloseTo(400, 6);
    }
  });

  test("at pitch 0 it matches the flat 2D camera", () => {
    const v = buildView3D({ ...base, pitchDeg: 0 });
    // 2D: screen = (world - center) * zoom + view / 2
    const p = projectToScreen(v, 530, 280, 0);
    expect(p.x).toBeCloseTo((530 - 500) * 2 + 600, 6);
    expect(p.y).toBeCloseTo((280 - 300) * 2 + 400, 6);
  });

  test("north is up and the far side is foreshortened when tilted", () => {
    const v = buildView3D(base);
    const north = projectToScreen(v, 500, 250, 0);
    const south = projectToScreen(v, 500, 350, 0);
    expect(north.y).toBeLessThan(400);
    expect(south.y).toBeGreaterThan(400);
    // Equal world distances: the far (north) side covers fewer pixels.
    expect(400 - north.y).toBeLessThan(south.y - 400);
  });

  test("raised terrain appears higher on screen", () => {
    const v = buildView3D(base);
    const ground = projectToScreen(v, 500, 300, 0);
    const peak = projectToScreen(v, 500, 300, 20);
    expect(peak.y).toBeLessThan(ground.y);
  });

  test("viewProj agrees with projectToScreen", () => {
    const v = buildView3D(base);
    for (const [x, y, z] of [
      [500, 300, 0],
      [420, 260, 10],
      [610, 340, 3],
    ]) {
      const ndc = clip(v.viewProj, x, y, z);
      const s = projectToScreen(v, x, y, z);
      expect(((ndc.x + 1) / 2) * 1200).toBeCloseTo(s.x, 3);
      expect(((1 - ndc.y) / 2) * 800).toBeCloseTo(s.y, 3);
      expect(ndc.w).toBeGreaterThan(0);
      expect(ndc.z).toBeGreaterThan(-1);
      expect(ndc.z).toBeLessThan(1);
    }
  });

  test("screen → ground → screen round-trips", () => {
    const v = buildView3D(base);
    for (const [sx, sy] of [
      [0, 0],
      [1200, 0],
      [600, 400],
      [100, 750],
      [1199, 799],
    ]) {
      const g = rayToPlane(v, sx, sy, 0)!;
      const s = projectToScreen(v, g.x, g.y, 0);
      expect(s.x).toBeCloseTo(sx, 4);
      expect(s.y).toBeCloseTo(sy, 4);
    }
  });

  test("terrain picking hits the visible surface", () => {
    const v = buildView3D(base);
    // A 20-tile-high plateau north of the look-at point.
    const heightAt = (_x: number, y: number) => (y < 290 ? 20 : 0);
    const target = { x: 500, y: 280 };
    const s = projectToScreen(v, target.x, target.y, 20);
    const hit = rayToTerrain(v, s.x, s.y, heightAt, 20)!;
    expect(hit.x).toBeCloseTo(target.x, 1);
    expect(hit.y).toBeCloseTo(target.y, 1);
    // The flat-plane pick lands somewhere else (further north).
    const flat = rayToPlane(v, s.x, s.y, 0)!;
    expect(flat.y).toBeLessThan(target.y - 5);
  });

  test("the footprint contains every visible ground point", () => {
    const v = buildView3D(base);
    const fp = groundFootprint(v, 30);
    for (let sx = 0; sx <= 1200; sx += 200) {
      for (let sy = 0; sy <= 800; sy += 200) {
        const g = rayToPlane(v, sx, sy, 0)!;
        expect(g.x).toBeGreaterThanOrEqual(fp.minX - 1e-6);
        expect(g.x).toBeLessThanOrEqual(fp.maxX + 1e-6);
        expect(g.y).toBeGreaterThanOrEqual(fp.minY - 1e-6);
        expect(g.y).toBeLessThanOrEqual(fp.maxY + 1e-6);
      }
    }
    // An ortho camera fitted to the footprint covers it.
    const o = fitOrtho(fp, 1200, 800);
    expect((fp.maxX - fp.minX) * o.zoom).toBeLessThanOrEqual(1200 + 1e-6);
    expect((fp.maxY - fp.minY) * o.zoom).toBeLessThanOrEqual(800 + 1e-6);
  });

  test("pitch is clamped below the horizon", () => {
    const v = buildView3D({ ...base, pitchDeg: 89 });
    // Even the top screen edge still hits the ground.
    expect(rayToPlane(v, 600, 0, 0)).not.toBeNull();
  });
});

describe("HeightField", () => {
  test("water and impassable terrain are flat, land rises with magnitude", () => {
    expect(rawHeight(0x00)).toBe(0); // water
    expect(rawHeight(0x9f)).toBe(0); // impassable
    expect(rawHeight(0x80)).toBeGreaterThan(0); // low coast land
    expect(rawHeight(0x80 | 20)).toBeGreaterThan(rawHeight(0x80 | 5));
    expect(rawHeight(0x80 | 30)).toBe(255);
  });

  test("blurs into smooth slopes and samples bilinearly", () => {
    const w = 21;
    const h = 21;
    const bytes = new Uint8Array(w * h);
    // A single mountain tile in the middle.
    bytes[10 * w + 10] = 0x80 | 30;
    const hf = new HeightField(w, h, bytes);
    const peak = hf.sample(10.5, 10.5);
    const slope = hf.sample(12.5, 10.5);
    const far = hf.sample(18.5, 10.5);
    expect(peak).toBeGreaterThan(slope);
    expect(slope).toBeGreaterThan(0);
    expect(far).toBe(0);
    // Halfway between two tile centers is the average.
    const a = hf.sample(10.5, 10.5);
    const b = hf.sample(11.5, 10.5);
    expect(hf.sample(11, 10.5)).toBeCloseTo((a + b) / 2, 6);
  });

  test("craters only lower the terrain", () => {
    const w = 8;
    const h = 8;
    const bytes = new Uint8Array(w * h).fill(0x80 | 30);
    const hf = new HeightField(w, h, bytes);
    hf.applyRect(2, 2, 2, 2, new Uint8Array(4), 0);
    expect(hf.data[2 * w + 2]).toBe(0);
    expect(hf.data[0]).toBe(255);
  });
});

describe("View3DProjector", () => {
  const cam = { centerX: 50, centerY: 50, zoom: 4, viewW: 800, viewH: 600 };

  test("follows the live settings object", () => {
    const settings = createRenderSettings();
    const p = new View3DProjector(settings.view3d, () => null);
    settings.view3d.enabled = false;
    expect(p.isActive()).toBe(false);
    settings.view3d.enabled = true;
    expect(p.isActive()).toBe(true);
  });

  test("screen center maps to the camera center and back", () => {
    const settings = createRenderSettings();
    const p = new View3DProjector(settings.view3d, () => null);
    const w = p.screenToWorld(cam, 400, 300, true);
    expect(w.x).toBeCloseTo(50, 6);
    expect(w.y).toBeCloseTo(50, 6);
    const s = p.worldToScreen(cam, 50, 50);
    expect(s.x).toBeCloseTo(400, 6);
    expect(s.y).toBeCloseTo(300, 6);
  });

  test("worldToScreen and screenToWorld agree on terrain", () => {
    const settings = createRenderSettings();
    const w = 100;
    const bytes = new Uint8Array(w * w).fill(0x80 | 20);
    const hf = new HeightField(w, w, bytes);
    const p = new View3DProjector(settings.view3d, () => hf);
    const s = p.worldToScreen(cam, 60, 40);
    const back = p.screenToWorld(cam, s.x, s.y, true);
    expect(back.x).toBeCloseTo(60, 1);
    expect(back.y).toBeCloseTo(40, 1);
  });
});

describe("3D view settings", () => {
  test("on by default and can be turned off or tuned by overrides", () => {
    expect(createRenderSettings().view3d.enabled).toBe(true);
    const overrides = {
      view3d: { enabled: false, pitch: 25, heightScale: 50 },
    };
    expect(GraphicsOverridesSchema.safeParse(overrides).success).toBe(true);
    const s = createRenderSettings();
    applyGraphicsOverrides(s, overrides);
    expect(s.view3d).toMatchObject({
      enabled: false,
      pitch: 25,
      heightScale: 50,
    });
  });
});
