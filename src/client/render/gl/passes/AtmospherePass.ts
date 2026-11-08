/**
 * AtmospherePass — the 3D view's sky gradient and drifting cloud layer.
 *
 * drawSky() replaces the flat background color behind the terrain mesh;
 * drawClouds() draws a translucent noise layer on a plane high above the map.
 * Terrain3DPass shades the matching cloud shadows on the ground (the same
 * noise function), and both fade the clouds out when the camera comes close.
 */

import type { RenderSettings } from "../RenderSettings";
import fullscreenVertSrc from "../shaders/glow/glow.vert.glsl?raw";
import cloudsFragSrc from "../shaders/terrain3d/clouds.frag.glsl?raw";
import cloudsVertSrc from "../shaders/terrain3d/clouds.vert.glsl?raw";
import skyFragSrc from "../shaders/terrain3d/sky.frag.glsl?raw";
import { createProgram } from "../utils/GlUtils";
import type { View3D } from "../view3d/Projection3D";
import { cloudFade, skyColors } from "./Terrain3DPass";

export class AtmospherePass {
  private sky: WebGLProgram;
  private clouds: WebGLProgram;
  private fsVao: WebGLVertexArrayObject;
  private planeVao: WebGLVertexArrayObject;
  private bufs: WebGLBuffer[] = [];
  private startMs = performance.now();
  private u = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
    private settings: RenderSettings["view3d"],
  ) {
    this.sky = createProgram(gl, fullscreenVertSrc, skyFragSrc, "Sky");
    this.clouds = createProgram(gl, cloudsVertSrc, cloudsFragSrc, "Clouds");
    for (const n of ["uTop", "uBottom"]) {
      this.u.set(`sky.${n}`, gl.getUniformLocation(this.sky, n));
    }
    for (const n of [
      "uViewProj",
      "uBounds",
      "uCloudHeight",
      "uTime",
      "uCloudCover",
      "uCloudFade",
      "uCloudAlpha",
    ]) {
      this.u.set(`cl.${n}`, gl.getUniformLocation(this.clouds, n));
    }
    this.fsVao = this.quadVao([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.planeVao = this.quadVao([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
  }

  private quadVao(verts: number[]): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    this.bufs.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  /** Fill the bound framebuffer with the sky gradient (no depth write). */
  drawSky(background: readonly [number, number, number]): void {
    const gl = this.gl;
    const { top, bottom } = skyColors(background);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.sky);
    gl.uniform3f(this.u.get("sky.uTop")!, top[0], top[1], top[2]);
    gl.uniform3f(this.u.get("sky.uBottom")!, bottom[0], bottom[1], bottom[2]);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  /** Draw the cloud layer over the terrain (alpha blended). */
  drawClouds(view: View3D): void {
    const s = this.settings;
    const fade = cloudFade(view, s);
    if (fade <= 0) return;
    const gl = this.gl;
    const u = (n: string) => this.u.get(`cl.${n}`) ?? null;
    gl.useProgram(this.clouds);
    gl.uniformMatrix4fv(u("uViewProj"), false, view.viewProj);
    gl.uniform4f(u("uBounds"), 0, 0, this.mapW, this.mapH);
    gl.uniform1f(u("uCloudHeight"), s.cloudHeight);
    gl.uniform1f(u("uTime"), (performance.now() - this.startMs) / 1000);
    gl.uniform1f(u("uCloudCover"), s.cloudCover);
    gl.uniform1f(u("uCloudFade"), fade);
    gl.uniform1f(u("uCloudAlpha"), s.cloudAlpha);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.planeVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.sky);
    gl.deleteProgram(this.clouds);
    for (const b of this.bufs) gl.deleteBuffer(b);
    gl.deleteVertexArray(this.fsVao);
    gl.deleteVertexArray(this.planeVao);
  }
}
