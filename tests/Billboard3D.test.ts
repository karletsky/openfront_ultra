import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { injectBillboard } from "../src/client/render/gl/view3d/Billboard";

const SHADERS = path.join(__dirname, "../src/client/render/gl/shaders");

/** Overlays that must stand upright in the 3D view instead of being draped. */
const BILLBOARDED = [
  "structure/structure.vert.glsl",
  "structure-level/structure-level.vert.glsl",
  "bar/bar.vert.glsl",
  "world-text/world-text.vert.glsl",
  "unit/unit.vert.glsl",
  "name/name.vert.glsl",
  "name/icon.vert.glsl",
  "name/status-icon.vert.glsl",
];

describe("3D billboards", () => {
  test("injectBillboard swaps the marker for the projection chunk", () => {
    const src =
      "#version 300 es\nprecision highp float;\n#pragma billboard3d\nvoid main(){}";
    const out = injectBillboard(src);
    expect(out).not.toContain("#pragma billboard3d");
    expect(out).toContain(
      "vec4 bbProject(mat3 cam, vec2 anchor, vec2 worldPos)",
    );
    expect(out).toContain("uniform float uBBEnabled;");
    // Shaders without the marker are untouched.
    expect(injectBillboard("void main(){}")).toBe("void main(){}");
  });

  test.each(BILLBOARDED)("%s projects through bbProject", (file) => {
    const src = fs.readFileSync(path.join(SHADERS, file), "utf8");
    expect(src).toContain("#pragma billboard3d");
    expect(src).toMatch(/gl_Position = bbProject\(uCamera, .+, worldPos\);/);
    // No leftover flat projection that would bypass the billboard.
    expect(src).not.toMatch(/uCamera \* vec3\(worldPos, 1\.0\)/);
  });
});
