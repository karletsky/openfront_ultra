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

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.heightTex);
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
  }
}
