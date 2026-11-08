/**
 * Building3DPass — 3D models for structures in the 3D view.
 *
 * Instanced low-poly models (view3d/BuildingModels.ts) standing on the
 * terrain, lit by the same sun as the terrain and colored by their owner.
 * Depth-tested against the terrain mesh, so hills hide what's behind them.
 * Drawn only when the 3D view is zoomed in enough for models to read; the
 * renderer falls back to the flat icons otherwise (and in alt view).
 */

import type { UnitState } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import fragSrc from "../shaders/building3d/building3d.frag.glsl?raw";
import vertSrc from "../shaders/building3d/building3d.vert.glsl?raw";
import { getPaletteSize } from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";
import { buildModelAtlas } from "../view3d/BuildingModels";
import type { View3D } from "../view3d/Projection3D";

const INSTANCE_FLOATS = 6;

interface TypeBatch {
  first: number;
  count: number;
  data: Float32Array;
  instances: number;
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
}

export class Building3DPass {
  private program: WebGLProgram;
  private meshBuf: WebGLBuffer;
  private batches = new Map<string, TypeBatch>();
  private gameTick = 0;
  private startMs = performance.now();
  private u = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
    private paletteTex: WebGLTexture,
    private settings: RenderSettings["view3d"],
  ) {
    this.program = createProgram(
      gl,
      vertSrc,
      shaderSrc(fragSrc, { PALETTE_SIZE: getPaletteSize() }),
      "Building3DPass",
    );
    for (const n of [
      "uViewProj",
      "uHeight",
      "uHeightScale",
      "uMapSize",
      "uScale",
      "uGameTick",
      "uPalette",
      "uTime",
    ]) {
      this.u.set(n, gl.getUniformLocation(this.program, n));
    }

    const { mesh, ranges } = buildModelAtlas();
    const n = mesh.materials.length;
    const interleaved = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) {
      interleaved.set(mesh.positions.slice(i * 3, i * 3 + 3), i * 7);
      interleaved.set(mesh.normals.slice(i * 3, i * 3 + 3), i * 7 + 3);
      interleaved[i * 7 + 6] = mesh.materials[i];
    }
    this.meshBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);

    for (const [type, range] of ranges) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
      const stride = 7 * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const istride = INSTANCE_FLOATS * 4;
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, istride, 0);
      gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 2, gl.FLOAT, false, istride, 16);
      gl.vertexAttribDivisor(4, 1);
      gl.bindVertexArray(null);
      this.batches.set(type, {
        ...range,
        data: new Float32Array(INSTANCE_FLOATS * 16),
        instances: 0,
        buffer,
        vao,
      });
    }
  }

  setGameTick(tick: number): void {
    this.gameTick = tick;
  }

  /** Whether models replace the flat structure icons at this zoom. */
  visibleAt(zoom: number): boolean {
    return this.settings.buildings && zoom >= this.settings.buildingsMinZoom;
  }

  updateStructures(units: Map<number, UnitState>): void {
    for (const b of this.batches.values()) b.instances = 0;
    for (const unit of units.values()) {
      if (!unit.isActive) continue;
      const b = this.batches.get(unit.unitType);
      if (b === undefined) continue;
      if (b.data.length < (b.instances + 1) * INSTANCE_FLOATS) {
        const grown = new Float32Array(b.data.length * 2);
        grown.set(b.data);
        b.data = grown;
      }
      const o = b.instances * INSTANCE_FLOATS;
      const x = unit.pos % this.mapW;
      b.data[o] = x;
      b.data[o + 1] = (unit.pos - x) / this.mapW;
      b.data[o + 2] = unit.ownerID;
      b.data[o + 3] = unit.underConstruction ? 1 : 0;
      b.data[o + 4] = unit.level;
      b.data[o + 5] = unit.disabledUntil ?? -1;
      b.instances++;
    }
    const gl = this.gl;
    for (const b of this.batches.values()) {
      if (b.instances === 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        b.data.subarray(0, b.instances * INSTANCE_FLOATS),
        gl.DYNAMIC_DRAW,
      );
    }
  }

  /**
   * Draw into the bound framebuffer (the canvas, with the terrain's depth).
   * `zoom` is screen pixels per tile at the look-at point: models keep about
   * the on-screen size of the icons they replace.
   */
  draw(view: View3D, zoom: number, heightTex: WebGLTexture): void {
    const gl = this.gl;
    const u = (n: string) => this.u.get(n) ?? null;
    const scale = Math.min(
      20,
      Math.max(2.5, this.settings.buildingsScreenPx / Math.max(zoom, 1e-3)),
    );
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(u("uViewProj"), false, view.viewProj);
    gl.uniform1f(u("uHeightScale"), this.settings.heightScale);
    gl.uniform2f(u("uMapSize"), this.mapW, this.mapH);
    gl.uniform1f(u("uScale"), scale);
    gl.uniform1f(u("uGameTick"), this.gameTick);
    gl.uniform1f(u("uTime"), (performance.now() - this.startMs) / 1000);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.uniform1i(u("uPalette"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.uniform1i(u("uHeight"), 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const b of this.batches.values()) {
      if (b.instances === 0) continue;
      gl.bindVertexArray(b.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, b.first, b.count, b.instances);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.meshBuf);
    for (const b of this.batches.values()) {
      gl.deleteBuffer(b.buffer);
      gl.deleteVertexArray(b.vao);
    }
  }
}
