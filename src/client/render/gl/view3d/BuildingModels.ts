/**
 * Procedural low-poly building models for the 3D view (Building3DPass).
 *
 * Each model is built from boxes and cylinders in a unit footprint:
 * x, y in [-0.5, 0.5] (map axes: +y is south), z up, roughly 0..1 tall.
 * Every vertex carries a normal and a material id the shader turns into a
 * color (owner colors, concrete, metal, glass…), so one mesh serves every
 * player.
 */

/** Material ids (see building3d.frag.glsl). */
export const MAT = {
  owner: 0, // owner's territory color
  ownerDark: 1, // owner's border color
  concrete: 2,
  metal: 3,
  glass: 4, // lit windows
  roof: 5,
  hazard: 6, // yellow/black warning paint
} as const;

export type Material = (typeof MAT)[keyof typeof MAT];

export interface MeshData {
  /** xyz per vertex. */
  positions: number[];
  /** xyz per vertex. */
  normals: number[];
  /** One material id per vertex. */
  materials: number[];
}

function emptyMesh(): MeshData {
  return { positions: [], normals: [], materials: [] };
}

type V3 = [number, number, number];

function tri(m: MeshData, a: V3, b: V3, c: V3, n: V3, mat: Material) {
  for (const p of [a, b, c]) {
    m.positions.push(p[0], p[1], p[2]);
    m.normals.push(n[0], n[1], n[2]);
    m.materials.push(mat);
  }
}

function quad(m: MeshData, a: V3, b: V3, c: V3, d: V3, n: V3, mat: Material) {
  tri(m, a, b, c, n, mat);
  tri(m, a, c, d, n, mat);
}

/** Axis-aligned box; `top` can use a different material (roofs). */
export function box(
  m: MeshData,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  mat: Material,
  top: Material = mat,
): void {
  // top
  quad(
    m,
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
    [0, 0, 1],
    top,
  );
  // sides (no bottom: models sit on the ground)
  quad(
    m,
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [0, -1, 0],
    mat,
  );
  quad(
    m,
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y1, z1],
    [x1, y1, z1],
    [0, 1, 0],
    mat,
  );
  quad(
    m,
    [x0, y1, z0],
    [x0, y0, z0],
    [x0, y0, z1],
    [x0, y1, z1],
    [-1, 0, 0],
    mat,
  );
  quad(
    m,
    [x1, y0, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x1, y0, z1],
    [1, 0, 0],
    mat,
  );
}

/** Vertical cylinder (capped on top). */
export function cylinder(
  m: MeshData,
  cx: number,
  cy: number,
  r: number,
  z0: number,
  z1: number,
  mat: Material,
  top: Material = mat,
  segments = 12,
): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0: V3 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, 0];
    const p1: V3 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 0];
    const am = (a0 + a1) / 2;
    const n: V3 = [Math.cos(am), Math.sin(am), 0];
    quad(
      m,
      [p0[0], p0[1], z0],
      [p1[0], p1[1], z0],
      [p1[0], p1[1], z1],
      [p0[0], p0[1], z1],
      n,
      mat,
    );
    tri(
      m,
      [cx, cy, z1],
      [p0[0], p0[1], z1],
      [p1[0], p1[1], z1],
      [0, 0, 1],
      top,
    );
  }
}

/**
 * A box tilted up by `angle` radians about the x axis around its rear
 * bottom edge (y = y1), e.g. a missile rack aimed at the sky.
 */
function tiltedBox(
  m: MeshData,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  thick: number,
  baseZ: number,
  angle: number,
  mat: Material,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Local frame: length along -y tilted up; (u along rack, v thickness).
  const len = y1 - y0;
  const P = (x: number, u: number, v: number): V3 => [
    x,
    y1 - u * c + v * s,
    baseZ + u * s + v * c,
  ];
  const up: V3 = [0, s, c];
  const fwd: V3 = [0, -c, s];
  const quadL = (a: V3, b: V3, cc: V3, d: V3, n: V3) =>
    quad(m, a, b, cc, d, n, mat);
  quadL(
    P(x0, 0, thick),
    P(x1, 0, thick),
    P(x1, len, thick),
    P(x0, len, thick),
    up,
  );
  quadL(P(x1, 0, 0), P(x0, 0, 0), P(x0, len, 0), P(x1, len, 0), [0, -s, -c]);
  quadL(
    P(x0, len, 0),
    P(x0, len, thick),
    P(x1, len, thick),
    P(x1, len, 0),
    fwd,
  );
  quadL(
    P(x0, 0, 0),
    P(x0, 0, thick),
    P(x0, len, thick),
    P(x0, len, 0),
    [-1, 0, 0],
  );
  quadL(
    P(x1, 0, thick),
    P(x1, 0, 0),
    P(x1, len, 0),
    P(x1, len, thick),
    [1, 0, 0],
  );
}

export function cityModel(): MeshData {
  const m = emptyMesh();
  box(m, -0.5, -0.5, 0, 0.5, 0.5, 0.04, MAT.concrete);
  // Towers: [x0, y0, x1, y1, height]
  const towers: [number, number, number, number, number][] = [
    [-0.38, -0.38, -0.06, -0.06, 0.95],
    [0.02, -0.4, 0.36, -0.12, 0.6],
    [-0.4, 0.04, -0.12, 0.36, 0.5],
    [0.0, -0.02, 0.4, 0.4, 0.78],
  ];
  for (const [x0, y0, x1, y1, h] of towers) {
    box(m, x0, y0, 0.04, x1, y1, h, MAT.owner, MAT.roof);
    // Window bands.
    for (let z = 0.18; z < h - 0.08; z += 0.16) {
      box(
        m,
        x0 - 0.005,
        y0 - 0.005,
        z,
        x1 + 0.005,
        y1 + 0.005,
        z + 0.05,
        MAT.glass,
      );
    }
  }
  return m;
}

export function factoryModel(): MeshData {
  const m = emptyMesh();
  box(m, -0.5, -0.45, 0, 0.5, 0.45, 0.04, MAT.concrete);
  box(m, -0.42, -0.32, 0.04, 0.32, 0.36, 0.36, MAT.owner);
  // Sawtooth roof: three slanted panels.
  for (let i = 0; i < 3; i++) {
    const x0 = -0.42 + i * (0.74 / 3);
    const x1 = x0 + 0.74 / 3;
    const n: V3 = [-0.6, 0, 0.8];
    quad(
      m,
      [x0, -0.32, 0.36],
      [x1, -0.32, 0.52],
      [x1, 0.36, 0.52],
      [x0, 0.36, 0.36],
      n,
      MAT.roof,
    );
    quad(
      m,
      [x1, -0.32, 0.36],
      [x1, -0.32, 0.52],
      [x1, 0.36, 0.52],
      [x1, 0.36, 0.36],
      [1, 0, 0],
      MAT.glass,
    );
  }
  cylinder(m, 0.38, 0.18, 0.07, 0.04, 0.95, MAT.metal, MAT.metal, 10);
  box(m, 0.33, 0.13, 0.82, 0.43, 0.23, 0.86, MAT.hazard);
  return m;
}

export function portModel(): MeshData {
  const m = emptyMesh();
  // Pier reaching out (toward -y), warehouse, crane.
  box(m, -0.5, -0.5, 0, 0.5, 0.15, 0.06, MAT.concrete);
  box(m, -0.1, -0.5, 0, 0.1, -0.2, 0.08, MAT.metal);
  box(m, -0.45, 0.15, 0, 0.1, 0.5, 0.32, MAT.owner, MAT.roof);
  box(m, 0.25, -0.3, 0.06, 0.32, -0.23, 0.85, MAT.hazard);
  box(m, -0.05, -0.3, 0.78, 0.45, -0.23, 0.85, MAT.hazard);
  box(m, -0.05, -0.32, 0.55, 0.0, -0.21, 0.78, MAT.metal);
  box(m, 0.18, 0.2, 0.06, 0.45, 0.45, 0.2, MAT.ownerDark);
  return m;
}

export function siloModel(): MeshData {
  const m = emptyMesh();
  cylinder(m, 0, 0, 0.48, 0, 0.1, MAT.concrete, MAT.concrete, 16);
  cylinder(m, 0, 0, 0.3, 0.1, 0.14, MAT.ownerDark, MAT.metal, 16);
  // Hazard ring and hatch doors.
  cylinder(m, 0, 0, 0.34, 0.1, 0.12, MAT.hazard, MAT.hazard, 16);
  box(m, -0.26, -0.03, 0.14, 0.26, 0.03, 0.16, MAT.ownerDark);
  box(m, 0.3, 0.22, 0.1, 0.48, 0.42, 0.3, MAT.owner, MAT.roof);
  return m;
}

export function samModel(): MeshData {
  const m = emptyMesh();
  box(m, -0.45, -0.45, 0, 0.45, 0.45, 0.06, MAT.concrete);
  box(m, -0.3, -0.25, 0.06, 0.3, 0.3, 0.2, MAT.owner, MAT.roof);
  // Missile rack aimed up at 55°.
  tiltedBox(m, -0.28, 0.28, -0.25, 0.3, 0.12, 0.2, 0.96, MAT.ownerDark);
  for (const x of [-0.18, 0, 0.18]) {
    tiltedBox(m, x - 0.05, x + 0.05, -0.32, 0.3, 0.06, 0.32, 0.96, MAT.metal);
  }
  return m;
}

export function defensePostModel(): MeshData {
  const m = emptyMesh();
  // Low bunker with a gun slit and a flag.
  box(m, -0.4, -0.4, 0, 0.4, 0.4, 0.28, MAT.concrete, MAT.ownerDark);
  box(m, -0.3, -0.405, 0.15, 0.3, -0.39, 0.2, MAT.metal);
  box(m, 0.28, 0.28, 0.28, 0.31, 0.31, 0.85, MAT.metal);
  box(m, 0.31, 0.28, 0.65, 0.55, 0.3, 0.83, MAT.owner);
  return m;
}

export const MODEL_BUILDERS: Record<string, () => MeshData> = {
  City: cityModel,
  Factory: factoryModel,
  Port: portModel,
  "Missile Silo": siloModel,
  "SAM Launcher": samModel,
  "Defense Post": defensePostModel,
};

/** All models concatenated, with each type's vertex range. */
export function buildModelAtlas(): {
  mesh: MeshData;
  ranges: Map<string, { first: number; count: number }>;
} {
  const mesh = emptyMesh();
  const ranges = new Map<string, { first: number; count: number }>();
  for (const [type, build] of Object.entries(MODEL_BUILDERS)) {
    const m = build();
    const first = mesh.materials.length;
    mesh.positions.push(...m.positions);
    mesh.normals.push(...m.normals);
    mesh.materials.push(...m.materials);
    ranges.set(type, { first, count: m.materials.length });
  }
  return { mesh, ranges };
}
