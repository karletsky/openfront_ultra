/**
 * NukeFlightPass — enhanced nukes in flight.
 *
 * Replaces the flickering nuke sprites (atom, hydrogen, MIRV, MIRV warhead)
 * with a procedural missile: a shaded body pointing along its heading with
 * an owner-colored band and a per-type nose cone, a flickering exhaust plume
 * with smoke, a pulsing heat glow that flashes red in the terminal phase,
 * and a ground shadow that drifts away mid-flight to suggest altitude.
 *
 * UnitPass skips these types while `unit.enhancedNukes` is on (outside alt
 * view, which keeps the plain strategic sprites). Positions and headings are
 * interpolated per frame between ticks, like UnitPass's nuke smoothing.
 */

import type { Config } from "@openfront/engine-lib/configuration/Config";
import type { UnitState } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import nukeFragSrc from "../shaders/nuke-flight/nuke-flight.frag.glsl?raw";
import nukeVertSrc from "../shaders/nuke-flight/nuke-flight.vert.glsl?raw";
import { getPaletteSize } from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";
import {
  interpolateFlight,
  type NukeFlight,
  NukeFlightTracker,
} from "./NukeFlightTracker";

const FLOATS_PER_INSTANCE = 8;
/** Added to the kind for nukes SAMs can't target (see nuke-flight.vert). */
const UNTARGETABLE_FLAG = 8;

export class NukeFlightPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quadBuf: WebGLBuffer;
  private instBuf: WebGLBuffer;
  private instData = new Float32Array(FLOATS_PER_INSTANCE * 16);
  private tracker: NukeFlightTracker;
  private flights: readonly NukeFlight[] = [];
  private lastUpdateMs = 0;
  private tickIntervalMs: number;
  private startMs = performance.now();
  private altView = false;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(
    private gl: WebGL2RenderingContext,
    mapW: number,
    private paletteTex: WebGLTexture,
    private settings: RenderSettings,
    config: Config,
  ) {
    this.tracker = new NukeFlightTracker(mapW);
    this.tickIntervalMs = config.msPerTick();
    const defines = { PALETTE_SIZE: getPaletteSize() };
    this.program = createProgram(
      gl,
      shaderSrc(nukeVertSrc, defines),
      shaderSrc(nukeFragSrc, defines),
      "NukeFlightPass",
    );
    for (const name of [
      "uCamera",
      "uZoom",
      "uMinLengthPx",
      "uSizeScale",
      "uShadowHeight",
      "uPalette",
      "uTime",
      "uUntargetableAlpha",
      "uGlowStrength",
      "uPlumeLength",
      "uMode",
      "uArcHeight",
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instData.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  /** Whether the enhanced nukes are drawn (UnitPass skips nukes then). */
  isActive(): boolean {
    return this.settings.unit.enhancedNukes && !this.altView;
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }

  updateUnits(units: Map<number, UnitState>): void {
    this.flights = this.tracker.update(units);
    this.lastUpdateMs = performance.now();
  }

  /**
   * mode: "all" in the 2D view; in the 3D view "shadow" (draped with the
   * map) and "missile" (drawn upright after the terrain, lifted along its
   * arc through the billboard projection).
   */
  draw(
    cameraMatrix: Float32Array,
    zoom: number,
    mode: "all" | "shadow" | "missile" = "all",
  ): void {
    if (!this.isActive() || this.flights.length === 0) return;
    const gl = this.gl;
    const n = this.flights.length;
    if (this.instData.length < n * FLOATS_PER_INSTANCE) {
      this.instData = new Float32Array(n * FLOATS_PER_INSTANCE * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.instData.byteLength, gl.DYNAMIC_DRAW);
    }
    const alpha = (performance.now() - this.lastUpdateMs) / this.tickIntervalMs;
    const d = this.instData;
    for (let i = 0; i < n; i++) {
      const f = this.flights[i];
      const p = interpolateFlight(f, alpha);
      const o = i * FLOATS_PER_INSTANCE;
      d[o] = p.x;
      d[o + 1] = p.y;
      d[o + 2] = p.dirX;
      d[o + 3] = p.dirY;
      d[o + 4] = f.ownerID;
      d[o + 5] = f.kind + (f.targetable ? 0 : UNTARGETABLE_FLAG);
      d[o + 6] = f.progress;
      d[o + 7] = f.seed;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * FLOATS_PER_INSTANCE);

    const us = this.settings.unit;
    const u = this.u;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(u.uCamera, false, cameraMatrix);
    gl.uniform1f(u.uZoom, zoom);
    gl.uniform1f(u.uMinLengthPx, us.nukeMinLengthPx);
    gl.uniform1f(u.uSizeScale, us.nukeSizeScale);
    gl.uniform1f(u.uShadowHeight, us.nukeShadowHeight);
    gl.uniform1f(u.uTime, (performance.now() - this.startMs) / 1000);
    gl.uniform1f(u.uUntargetableAlpha, us.untargetableAlpha);
    gl.uniform1f(u.uGlowStrength, us.nukeGlowStrength);
    gl.uniform1f(u.uPlumeLength, us.nukePlumeLength);
    gl.uniform1i(u.uMode, mode === "all" ? 0 : mode === "shadow" ? 1 : 2);
    gl.uniform1f(u.uArcHeight, us.nukeArcHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.uniform1i(u.uPalette, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteBuffer(this.instBuf);
    gl.deleteVertexArray(this.vao);
  }
}
