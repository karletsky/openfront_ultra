/**
 * Upright "billboard" projection for icons, names, bars and unit sprites in
 * the tilted 3D view.
 *
 * Those overlays are laid out in 2D world space around an anchor point (the
 * structure, unit or name center). Painted into the flat map image and
 * draped over the terrain, they'd be skewed and squashed by the tilt and
 * drift off the mountains they stand on. Instead, a vertex shader that
 * includes `#pragma billboard3d` gets `bbProject(camera, anchor, worldPos)`:
 *
 *   - 2D view (uBBEnabled = 0): exactly `camera * worldPos`, as before.
 *   - 3D view: the anchor is projected through the perspective camera at its
 *     terrain height, and the overlay keeps its flat on-screen layout around
 *     it (offsets measured with `camera`, a top-down camera at the true zoom),
 *     scaled by distance so far icons shrink like the terrain does.
 *
 * Programs that include the chunk register themselves on creation; the
 * renderer sets the shared uniforms on all of them once per frame
 * (applyBillboardState), so the passes' own draw code is untouched. Programs
 * created in contexts that never enable 3D (cosmetic previews) keep the
 * uniform defaults, i.e. plain 2D.
 */

const PRAGMA = "#pragma billboard3d";

/** Texture unit the height field is bound to for billboard lookups. */
export const BILLBOARD_HEIGHT_UNIT = 15;

const CHUNK = `
uniform float uBBEnabled;
uniform mat4 uBBViewProj;
uniform float uBBHeightScale;
uniform float uBBCenterDepth;
uniform vec2 uBBMapSize;
uniform sampler2D uBBHeight;

vec4 bbProject(mat3 cam, vec2 anchor, vec2 worldPos) {
  vec3 c2 = cam * vec3(worldPos, 1.0);
  if (uBBEnabled < 0.5) return vec4(c2.xy, 0.0, 1.0);
  vec3 a2 = cam * vec3(anchor, 1.0);
  float h = textureLod(uBBHeight, anchor / uBBMapSize, 0.0).r * uBBHeightScale;
  vec4 a3 = uBBViewProj * vec4(anchor, h, 1.0);
  float w = max(a3.w, 1e-4);
  float persp = uBBCenterDepth / w;
  return vec4(a3.xy / w + (c2.xy - a2.xy) * persp, 0.0, 1.0);
}
`;

/** Replace the `#pragma billboard3d` marker with the projection chunk. */
export function injectBillboard(src: string): string {
  return src.includes(PRAGMA) ? src.replace(PRAGMA, CHUNK) : src;
}

interface Registered {
  program: WebGLProgram;
  enabled: WebGLUniformLocation | null;
  viewProj: WebGLUniformLocation | null;
  heightScale: WebGLUniformLocation | null;
  centerDepth: WebGLUniformLocation | null;
  mapSize: WebGLUniformLocation | null;
}

const registry = new WeakMap<WebGL2RenderingContext, Set<Registered>>();

/**
 * Called by createProgram after linking: if the program uses the billboard
 * chunk, point its height sampler at BILLBOARD_HEIGHT_UNIT and remember it.
 */
export function registerBillboardProgram(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): void {
  const heightLoc = gl.getUniformLocation(program, "uBBHeight");
  const enabled = gl.getUniformLocation(program, "uBBEnabled");
  if (!heightLoc && !enabled) return;
  const prev = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  gl.useProgram(program);
  if (heightLoc) gl.uniform1i(heightLoc, BILLBOARD_HEIGHT_UNIT);
  gl.useProgram(prev);
  let set = registry.get(gl);
  if (!set) {
    set = new Set();
    registry.set(gl, set);
  }
  set.add({
    program,
    enabled,
    viewProj: gl.getUniformLocation(program, "uBBViewProj"),
    heightScale: gl.getUniformLocation(program, "uBBHeightScale"),
    centerDepth: gl.getUniformLocation(program, "uBBCenterDepth"),
    mapSize: gl.getUniformLocation(program, "uBBMapSize"),
  });
}

export interface BillboardState {
  enabled: boolean;
  viewProj: Float32Array;
  heightScale: number;
  centerDepth: number;
  mapW: number;
  mapH: number;
}

/**
 * Push the billboard uniforms to every registered program (dropping deleted
 * ones) and bind the height texture. Leaves texture unit 0 active.
 */
export function applyBillboardState(
  gl: WebGL2RenderingContext,
  state: BillboardState,
  heightTex: WebGLTexture | null,
): void {
  const set = registry.get(gl);
  if (!set) return;
  for (const r of set) {
    if (!gl.isProgram(r.program)) {
      set.delete(r);
      continue;
    }
    gl.useProgram(r.program);
    gl.uniform1f(r.enabled, state.enabled ? 1 : 0);
    if (state.enabled) {
      gl.uniformMatrix4fv(r.viewProj, false, state.viewProj);
      gl.uniform1f(r.heightScale, state.heightScale);
      gl.uniform1f(r.centerDepth, state.centerDepth);
      gl.uniform2f(r.mapSize, state.mapW, state.mapH);
    }
  }
  if (heightTex) {
    gl.activeTexture(gl.TEXTURE0 + BILLBOARD_HEIGHT_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.activeTexture(gl.TEXTURE0);
  }
}
