/**
 * Pure math for the tilted 3D map view.
 *
 * World space: x east, y south (tile units, matching the 2D map), z up
 * (tile units). The camera orbits a look-at point on the ground plane:
 * it sits south of the point, tilted `pitch` degrees from straight down,
 * always looking north (no yaw). At pitch 0 the view matches the 2D camera
 * exactly: one tile at the look-at point spans `zoom` pixels.
 *
 * Screen space: pixels, (0,0) top-left, y down. The unit (CSS or device
 * pixels) is whatever `viewW`/`viewH`/`zoom` are given in — the geometry is
 * the same either way, so the renderer (device px) and the input handler
 * (CSS px) agree.
 */

export interface View3DParams {
  /** Look-at point on the ground (world tiles). */
  centerX: number;
  centerY: number;
  /** Pixels per tile at the look-at point when pitch is 0. */
  zoom: number;
  viewW: number;
  viewH: number;
  /** Tilt from straight down, degrees (0 = top-down). */
  pitchDeg: number;
  /** Vertical field of view, degrees. */
  fovDeg: number;
}

export type Vec3 = [number, number, number];

export interface View3D {
  readonly eye: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly fwd: Vec3;
  readonly tanHalf: number;
  readonly aspect: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly near: number;
  readonly far: number;
  /** Column-major world → clip matrix. */
  readonly viewProj: Float32Array;
}

export interface Footprint {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Highest allowed tilt; keeps the top screen edge well below the horizon. */
export const MAX_PITCH_DEG = 60;
export const MIN_FOV_DEG = 10;
export const MAX_FOV_DEG = 60;

const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function buildView3D(p: View3DParams): View3D {
  const pitch = clamp(p.pitchDeg, 0, MAX_PITCH_DEG) * DEG;
  const fov = clamp(p.fovDeg, MIN_FOV_DEG, MAX_FOV_DEG) * DEG;
  const viewW = Math.max(1, p.viewW);
  const viewH = Math.max(1, p.viewH);
  const zoom = Math.max(1e-6, p.zoom);
  const tanHalf = Math.tan(fov / 2);
  const aspect = viewW / viewH;
  // Distance at which the look-at plane shows viewH / zoom tiles vertically.
  const dist = viewH / 2 / zoom / tanHalf;

  const s = Math.sin(pitch);
  const c = Math.cos(pitch);
  const fwd: Vec3 = [0, -s, -c];
  const up: Vec3 = [0, -c, s];
  const right: Vec3 = [1, 0, 0];
  const eye: Vec3 = [p.centerX, p.centerY + dist * s, dist * c];

  const near = dist * 0.02;
  const far = dist * 12;

  // View matrix rows: right, up, -fwd (camera looks down -Z).
  const tx = -dot(right, eye);
  const ty = -dot(up, eye);
  const tz = dot(fwd, eye);
  const f1 = 1 / tanHalf;
  const a = (far + near) / (near - far);
  const b = (2 * far * near) / (near - far);
  // P * V, written out. Column-major: m[col * 4 + row].
  const m = new Float32Array(16);
  const px = f1 / aspect;
  const py = f1;
  // Row 0 = px * (right row)
  m[0] = px * right[0];
  m[4] = px * right[1];
  m[8] = px * right[2];
  m[12] = px * tx;
  // Row 1 = py * (up row)
  m[1] = py * up[0];
  m[5] = py * up[1];
  m[9] = py * up[2];
  m[13] = py * ty;
  // Row 2 = a * (-fwd row) + b
  m[2] = -a * fwd[0];
  m[6] = -a * fwd[1];
  m[10] = -a * fwd[2];
  m[14] = a * tz + b;
  // Row 3 = -(-fwd row) = fwd row, i.e. w = depth along fwd
  m[3] = fwd[0];
  m[7] = fwd[1];
  m[11] = fwd[2];
  m[15] = -tz;

  return {
    eye,
    right,
    up,
    fwd,
    tanHalf,
    aspect,
    viewW,
    viewH,
    near,
    far,
    viewProj: m,
  };
}

/**
 * Project a world point to screen pixels. `depth` is the distance along the
 * view direction; points with depth <= 0 are behind the camera.
 */
export function projectToScreen(
  v: View3D,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; depth: number } {
  const d: Vec3 = [x - v.eye[0], y - v.eye[1], z - v.eye[2]];
  const depth = Math.max(1e-6, dot(v.fwd, d));
  const xc = dot(v.right, d) / (depth * v.tanHalf * v.aspect);
  const yc = dot(v.up, d) / (depth * v.tanHalf);
  return {
    x: ((xc + 1) / 2) * v.viewW,
    y: ((1 - yc) / 2) * v.viewH,
    depth: dot(v.fwd, d),
  };
}

/** World-space ray through a screen pixel (not normalized). */
export function screenRay(v: View3D, sx: number, sy: number): Vec3 {
  const nx = (sx / v.viewW) * 2 - 1;
  const ny = 1 - (sy / v.viewH) * 2;
  const a = nx * v.tanHalf * v.aspect;
  const b = ny * v.tanHalf;
  return [
    v.right[0] * a + v.up[0] * b + v.fwd[0],
    v.right[1] * a + v.up[1] * b + v.fwd[1],
    v.right[2] * a + v.up[2] * b + v.fwd[2],
  ];
}

/** Where the ray through a screen pixel meets the horizontal plane z = h. */
export function rayToPlane(
  v: View3D,
  sx: number,
  sy: number,
  h = 0,
): { x: number; y: number } | null {
  const dir = screenRay(v, sx, sy);
  if (dir[2] >= -1e-9) return null;
  const t = (h - v.eye[2]) / dir[2];
  if (t <= 0) return null;
  return { x: v.eye[0] + dir[0] * t, y: v.eye[1] + dir[1] * t };
}

/**
 * Where the ray through a screen pixel first hits a height field: marches
 * from the plane z = maxHeight down to z = 0, then refines by bisection.
 * Falls back to the ground plane when nothing is hit.
 */
export function rayToTerrain(
  v: View3D,
  sx: number,
  sy: number,
  heightAt: (x: number, y: number) => number,
  maxHeight: number,
): { x: number; y: number } | null {
  const dir = screenRay(v, sx, sy);
  if (dir[2] >= -1e-9) return null;
  const tTop = Math.max(0, (maxHeight - v.eye[2]) / dir[2]);
  const tBot = (0 - v.eye[2]) / dir[2];
  if (tBot <= 0) return null;
  const at = (t: number): Vec3 => [
    v.eye[0] + dir[0] * t,
    v.eye[1] + dir[1] * t,
    v.eye[2] + dir[2] * t,
  ];
  const STEPS = 48;
  let prevT = tTop;
  for (let i = 1; i <= STEPS; i++) {
    const t = tTop + ((tBot - tTop) * i) / STEPS;
    const p = at(t);
    if (p[2] <= heightAt(p[0], p[1])) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        const q = at(mid);
        if (q[2] <= heightAt(q[0], q[1])) hi = mid;
        else lo = mid;
      }
      const hit = at(hi);
      return { x: hit[0], y: hit[1] };
    }
    prevT = t;
  }
  const g = at(tBot);
  return { x: g[0], y: g[1] };
}

/**
 * World-space bounding box of everything that can be visible on screen,
 * for terrain up to `maxHeight`: the screen corners cast onto both the
 * ground plane and the z = maxHeight plane.
 */
export function groundFootprint(v: View3D, maxHeight = 0): Footprint {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corners: [number, number][] = [
    [0, 0],
    [v.viewW, 0],
    [0, v.viewH],
    [v.viewW, v.viewH],
  ];
  const planes = maxHeight > 0 && maxHeight < v.eye[2] ? [0, maxHeight] : [0];
  for (const h of planes) {
    for (const [sx, sy] of corners) {
      const p = rayToPlane(v, sx, sy, h);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) {
    // Degenerate (shouldn't happen below MAX_PITCH_DEG): fall back to a box
    // around the camera's ground position.
    const r = v.eye[2] * 4;
    return {
      minX: v.eye[0] - r,
      minY: v.eye[1] - r,
      maxX: v.eye[0] + r,
      maxY: v.eye[1] + r,
    };
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The 2D orthographic camera (center + zoom in px/tile) whose viewport of
 * `w`×`h` pixels covers the footprint.
 */
export function fitOrtho(
  fp: Footprint,
  w: number,
  h: number,
): { centerX: number; centerY: number; zoom: number } {
  const bw = Math.max(1e-6, fp.maxX - fp.minX);
  const bh = Math.max(1e-6, fp.maxY - fp.minY);
  return {
    centerX: (fp.minX + fp.maxX) / 2,
    centerY: (fp.minY + fp.maxY) / 2,
    zoom: Math.min(w / bw, h / bh),
  };
}

/**
 * Column-major mat3 world → clip for a 2D camera — the same layout as
 * Camera.getMatrix().
 */
export function orthoMatrix(
  centerX: number,
  centerY: number,
  zoom: number,
  w: number,
  h: number,
  out: Float32Array = new Float32Array(9),
): Float32Array {
  const sx = (zoom * 2) / w;
  const sy = (zoom * -2) / h;
  out[0] = sx;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = sy;
  out[5] = 0;
  out[6] = -centerX * sx;
  out[7] = -centerY * sy;
  out[8] = 1;
  return out;
}
