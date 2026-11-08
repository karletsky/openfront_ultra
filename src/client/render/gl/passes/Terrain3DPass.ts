/**
 * Terrain3DPass — the tilted 3D view.
 *
 * The rest of the renderer draws the map flat and top-down into an offscreen
 * image (see GPURenderer.renderFrame3D). This pass drapes that image over a
 * grid mesh displaced by the terrain height field and draws it through a
 * perspective camera, with directional lighting on the slopes and a light
 * distance haze. Everything on the map (territory, units, names, effects)
 * therefore follows the terrain without each pass knowing about 3D.
 */

import type { RenderSettings } from "../RenderSettings";
import terrain3dFragSrc from "../shaders/terrain3d/terrain3d.frag.glsl?raw";
import terrain3dVertSrc from "../shaders/terrain3d/terrain3d.vert.glsl?raw";
import { createProgram, createTexture2D } from "../utils/GlUtils";
import type { HeightField } from "../view3d/HeightField";
import type { View3D } from "../view3d/Projection3D";

/** Target number of grid cells along the map's longer side. */
const GRID_CELLS = 640;

export class Terrain3DPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private indexCount: number;
  private heightTex: WebGLTexture;
  private waterTex: WebGLTexture;
  private startMs = performance.now();
  private step: number;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
    heights: HeightField,
    private settings: RenderSettings["view3d"],
  ) {
    this.program = createProgram(
      gl,
      terrain3dVertSrc,
      terrain3dFragSrc,
      "Terrain3DPass",
    );
    for (const name of [
      "uViewProj",
      "uImgCam",
      "uHeight",
      "uHeightScale",
      "uMapSize",
      "uStep",
      "uScene",
      "uBackground",
      "uEye",
      "uLight",
      "uHaze",
      "uHazeStart",
      "uHazeEnd",
      "uEmissive",
      "uWater",
      "uTime",
      "uSea",
      "uSkyColor",
      "uCloudCover",
      "uCloudFade",
      "uCloudHeight",
      "uCloudShadow",
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.heightTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      data: heights.data,
      filter: gl.LINEAR,
    });
    this.waterTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      data: heights.water,
      filter: gl.LINEAR,
    });

    // Grid mesh over the whole map; vertices land exactly on the map edges.
    this.step = Math.max(1, Math.ceil(Math.max(mapW, mapH) / GRID_CELLS));
    const xs: number[] = [];
    for (let x = 0; x < mapW; x += this.step) xs.push(x);
    xs.push(mapW);
    const ys: number[] = [];
    for (let y = 0; y < mapH; y += this.step) ys.push(y);
    ys.push(mapH);
    const nx = xs.length;
    const ny = ys.length;
    const verts = new Float32Array(nx * ny * 2);
    let k = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        verts[k++] = xs[i];
        verts[k++] = ys[j];
      }
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    k = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        idx[k++] = a;
        idx[k++] = c;
        idx[k++] = b;
        idx[k++] = b;
        idx[k++] = c;
        idx[k++] = d;
      }
    }
    this.indexCount = idx.length;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /** The R8 height texture (also sampled by billboard projection). */
  heightTexture(): WebGLTexture {
    return this.heightTex;
  }

  /** Re-upload part of the height field (after water-nuke craters). */
  updateHeights(
    heights: HeightField,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const gl = this.gl;
    const sub = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      const row = (y + j) * heights.width + x;
      sub.set(heights.data.subarray(row, row + w), j * w);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      w,
      h,
      gl.RED,
      gl.UNSIGNED_BYTE,
      sub,
    );
    // The water mask follows (land → water conversions).
    for (let j = 0; j < h; j++) {
      const row = (y + j) * heights.width + x;
      sub.set(heights.water.subarray(row, row + w), j * w);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.waterTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      w,
      h,
      gl.RED,
      gl.UNSIGNED_BYTE,
      sub,
    );
  }

  /**
   * Draw the mesh to the currently bound framebuffer, which must have a
   * depth buffer. Leaves depth testing disabled.
   */
  draw(
    view: View3D,
    imgCam: Float32Array,
    sceneTex: WebGLTexture,
    background: readonly [number, number, number],
  ): void {
    const gl = this.gl;
    const s = this.settings;
    const u = this.u;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.uViewProj, false, view.viewProj);
    gl.uniformMatrix3fv(u.uImgCam, false, imgCam);
    gl.uniform1f(u.uHeightScale, s.heightScale);
    gl.uniform2f(u.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(u.uStep, this.step);
    gl.uniform3f(u.uBackground, background[0], background[1], background[2]);
    gl.uniform3f(u.uEye, view.eye[0], view.eye[1], view.eye[2]);
    gl.uniform1f(u.uLight, s.lightStrength);
    gl.uniform1f(u.uHaze, s.haze);
    // Haze starts past the look-at distance and is full near the far edge.
    const centerDist = view.eye[2] / Math.max(1e-6, -view.fwd[2]);
    gl.uniform1f(u.uHazeStart, centerDist);
    gl.uniform1f(u.uHazeEnd, centerDist * 3);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.uniform1i(u.uHeight, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.waterTex);
    gl.uniform1i(u.uWater, 2);
    gl.uniform1f(u.uTime, (performance.now() - this.startMs) / 1000);
    gl.uniform1f(u.uSea, s.sea);
    const sky = skyColors(background).bottom;
    gl.uniform3f(u.uSkyColor, sky[0], sky[1], sky[2]);
    gl.uniform1f(u.uCloudCover, s.cloudCover);
    gl.uniform1f(u.uCloudFade, cloudFade(view, s));
    gl.uniform1f(u.uCloudHeight, s.cloudHeight);
    gl.uniform1f(u.uCloudShadow, s.cloudShadow);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Glow: drape the image-space emissive layer over the same mesh into the
   * bound (emissive) framebuffer, depth-tested so hills hide glows behind.
   */
  drawEmissive(
    view: View3D,
    imgCam: Float32Array,
    emissiveTex: WebGLTexture,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform1i(this.u.uEmissive, 1);
    this.draw(view, imgCam, emissiveTex, [0, 0, 0]);
    gl.useProgram(this.program);
    gl.uniform1i(this.u.uEmissive, 0);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.heightTex);
    gl.deleteTexture(this.waterTex);
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
  }
}

/**
 * How visible the cloud layer is: none when the camera is close to it
 * (zoomed in, where clouds would hide the game), fully when far above.
 */
export function cloudFade(view: View3D, s: RenderSettings["view3d"]): number {
  if (!s.clouds) return 0;
  const h = view.eye[2];
  const a = s.cloudHeight * 4;
  const b = s.cloudHeight * 9;
  const t = Math.min(1, Math.max(0, (h - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Sky gradient for the 3D background, derived from the background color. */
export function skyColors(bg: readonly [number, number, number]): {
  top: [number, number, number];
  bottom: [number, number, number];
} {
  const haze: [number, number, number] = [0.62, 0.72, 0.84];
  return {
    top: [bg[0] * 0.75, bg[1] * 0.8, bg[2] * 0.95],
    bottom: [
      bg[0] * 0.55 + haze[0] * 0.45,
      bg[1] * 0.55 + haze[1] * 0.45,
      bg[2] * 0.55 + haze[2] * 0.45,
    ],
  };
}
