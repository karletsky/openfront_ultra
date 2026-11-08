/**
 * Terrain elevation for the 3D view, derived from the terrain bytes.
 *
 * One byte per tile (0-255 = 0..1 of the configured height scale), box
 * blurred so mountains rise as smooth slopes instead of tile-sized steps.
 * The same array backs the GPU height texture (sampled LINEAR, so texel
 * centers sit at tile + 0.5) and CPU picking (`sample`, which matches that
 * filtering), so clicks land where the mesh is drawn.
 */

/** Blur radius (tiles) applied to the raw elevation. */
const BLUR_RADIUS = 2;
/** Height of the lowest land above water, as a fraction of full height. */
const COAST_LIFT = 0.06;

/** Raw elevation of one terrain byte, 0-255. */
export function rawHeight(tb: number): number {
  const isLand = (tb & 0x80) !== 0;
  if (!isLand) return 0;
  const mag = tb & 0x1f;
  // Impassable terrain renders as the background color; keep it flat.
  if (mag === 31) return 0;
  return Math.round(255 * (COAST_LIFT + (1 - COAST_LIFT) * (mag / 30)));
}

function boxBlur(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  const lineStride = horizontal ? w : 1;
  const win = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    // Clamp-to-edge running sum.
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const i = Math.min(len - 1, Math.max(0, k));
      sum += src[base + i * stride];
    }
    for (let i = 0; i < len; i++) {
      dst[base + i * stride] = sum / win;
      const out = Math.max(0, i - r);
      const inn = Math.min(len - 1, i + r + 1);
      sum += src[base + inn * stride] - src[base + out * stride];
    }
  }
}

export class HeightField {
  readonly data: Uint8Array;
  /** 255 for water tiles, 0 for land (3D view sea shading). */
  readonly water: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    terrainBytes: Uint8Array,
  ) {
    this.data = new Uint8Array(width * height);
    this.water = new Uint8Array(width * height);
    this.rebuild(terrainBytes);
  }

  /** Recompute the whole field (e.g. after terrain changed). */
  rebuild(terrainBytes: Uint8Array): void {
    const { width: w, height: h } = this;
    const n = w * h;
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = rawHeight(terrainBytes[i]);
      this.water[i] = (terrainBytes[i] & 0x80) === 0 ? 255 : 0;
    }
    // Two box passes ≈ a soft tent blur.
    boxBlur(a, b, w, h, BLUR_RADIUS, true);
    boxBlur(b, a, w, h, BLUR_RADIUS, false);
    boxBlur(a, b, w, h, BLUR_RADIUS, true);
    boxBlur(b, a, w, h, BLUR_RADIUS, false);
    for (let i = 0; i < n; i++) this.data[i] = Math.round(a[i]);
  }

  /**
   * Lower a rectangle of tiles to the new terrain (water-nuke craters).
   * Takes the minimum so a crater never raises anything; no re-blur, the
   * change is local and the GPU sampling smooths the edge.
   */
  applyRect(
    x: number,
    y: number,
    rw: number,
    rh: number,
    bytes: Uint8Array,
    offset: number,
  ): void {
    for (let j = 0; j < rh; j++) {
      for (let i = 0; i < rw; i++) {
        const idx = (y + j) * this.width + (x + i);
        const tb = bytes[offset + j * rw + i];
        const v = rawHeight(tb);
        if (v < this.data[idx]) this.data[idx] = v;
        this.water[idx] = (tb & 0x80) === 0 ? 255 : 0;
      }
    }
  }

  private at(ix: number, iy: number): number {
    const cx = Math.min(this.width - 1, Math.max(0, ix));
    const cy = Math.min(this.height - 1, Math.max(0, iy));
    return this.data[cy * this.width + cx];
  }

  /** Bilinear sample in world tile coordinates, 0..1. */
  sample(x: number, y: number): number {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const a = this.at(ix, iy);
    const b = this.at(ix + 1, iy);
    const c = this.at(ix, iy + 1);
    const d = this.at(ix + 1, iy + 1);
    const top = a + (b - a) * tx;
    const bot = c + (d - c) * tx;
    return (top + (bot - top) * ty) / 255;
  }
}
