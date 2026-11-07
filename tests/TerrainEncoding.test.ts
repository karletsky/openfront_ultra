import { describe, expect, test } from "vitest";
import { applyGraphicsOverrides } from "../src/client/render/gl/RenderOverrides";
import { createRenderSettings } from "../src/client/render/gl/RenderSettings";
import {
  buildTerrainRGBA,
  encodeTerrainTile,
} from "../src/client/render/gl/utils/ColorUtils";

describe("terrain texture encoding", () => {
  test("alpha carries the raw terrain byte for the terrain shader", () => {
    const bytes = new Uint8Array([
      0x00, // deep water, magnitude 0
      0x2a, // ocean water, magnitude 10
      0x40, // shoreline water
      0x85, // land, magnitude 5
      0xc0, // shoreline land (sand)
      0x9f, // impassable
    ]);
    const rgba = buildTerrainRGBA(bytes, bytes.length, 1);
    for (let i = 0; i < bytes.length; i++) {
      expect(rgba[i * 4 + 3]).toBe(bytes[i]);
    }
  });

  test("RGB colors are unchanged by the alpha encoding", () => {
    const out = new Uint8Array(4);
    encodeTerrainTile(0x80, out, 0); // plains, magnitude 0
    expect([out[0], out[1], out[2]]).toEqual([190, 220, 138]);
  });
});

describe("enhanced terrain setting", () => {
  test("is on by default", () => {
    expect(createRenderSettings().terrain.enhanced).toBe(true);
  });

  test("graphics override can turn it off", () => {
    const settings = createRenderSettings();
    applyGraphicsOverrides(settings, { terrain: { enhanced: false } });
    expect(settings.terrain.enhanced).toBe(false);
  });
});
