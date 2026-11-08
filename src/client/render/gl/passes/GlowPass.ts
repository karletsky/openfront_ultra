/**
 * GlowPass — bloom for light-emitting effects.
 *
 * The renderer draws the glowing effects (fireballs, EMP pulses, SAM hits,
 * nuke plumes and heat glow) a second time into an "emissive" layer between
 * beginEmissive() and composite(). composite() downsamples that layer to a
 * quarter of the screen, blurs it at two radii and adds the result onto the
 * finished frame. Ordinary bright pixels (snow, white names) never bloom:
 * only what was drawn into the emissive layer does.
 *
 * The emissive layer has a depth buffer so the 3D view can drape its
 * emissive image over the terrain mesh with correct occlusion.
 */

import type { RenderSettings } from "../RenderSettings";
import blurFragSrc from "../shaders/glow/glow-blur.frag.glsl?raw";
import compositeFragSrc from "../shaders/glow/glow-composite.frag.glsl?raw";
import downFragSrc from "../shaders/glow/glow-downsample.frag.glsl?raw";
import vertSrc from "../shaders/glow/glow.vert.glsl?raw";
import {
  createProgram,
  createRenderTarget,
  type RenderTarget,
  resizeRenderTarget,
} from "../utils/GlUtils";

type BindFramebuffer = (target: GLenum, fb: WebGLFramebuffer | null) => void;

export class GlowPass {
  private down: WebGLProgram;
  private blur: WebGLProgram;
  private comp: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quad: WebGLBuffer;
  /** Full-resolution emissive layer (+ depth). */
  readonly emissive: RenderTarget;
  private depth: WebGLRenderbuffer;
  private a: RenderTarget; // quarter res
  private b: RenderTarget;
  private c: RenderTarget; // eighth res (wide bloom)
  private d: RenderTarget;
  private w = 0;
  private h = 0;
  private u = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private gl: WebGL2RenderingContext,
    private settings: RenderSettings["glow"],
    private rawBind: BindFramebuffer,
  ) {
    this.down = createProgram(gl, vertSrc, downFragSrc, "GlowDownsample");
    this.blur = createProgram(gl, vertSrc, blurFragSrc, "GlowBlur");
    this.comp = createProgram(gl, vertSrc, compositeFragSrc, "GlowComposite");
    for (const [p, names] of [
      [this.down, ["uSrc", "uSrcTexel"]],
      [this.blur, ["uSrc", "uDir"]],
      [this.comp, ["uTight", "uWide", "uIntensity"]],
    ] as const) {
      for (const n of names) {
        this.u.set(
          `${n}@${p === this.down ? "d" : p === this.blur ? "b" : "c"}`,
          gl.getUniformLocation(p, n),
        );
      }
    }

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.emissive = createRenderTarget(gl, 1, 1);
    this.depth = gl.createRenderbuffer()!;
    this.a = createRenderTarget(gl, 1, 1);
    this.b = createRenderTarget(gl, 1, 1);
    this.c = createRenderTarget(gl, 1, 1);
    this.d = createRenderTarget(gl, 1, 1);
  }

  enabled(): boolean {
    return this.settings.enabled && this.settings.intensity > 0;
  }

  private resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const gl = this.gl;
    resizeRenderTarget(gl, this.emissive, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    this.rawBind(gl.FRAMEBUFFER, this.emissive.fbo);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.depth,
    );
    const qw = Math.max(1, Math.round(w / 4));
    const qh = Math.max(1, Math.round(h / 4));
    resizeRenderTarget(gl, this.a, qw, qh);
    resizeRenderTarget(gl, this.b, qw, qh);
    const ew = Math.max(1, Math.round(w / 8));
    const eh = Math.max(1, Math.round(h / 8));
    resizeRenderTarget(gl, this.c, ew, eh);
    resizeRenderTarget(gl, this.d, ew, eh);
  }

  /** Bind and clear the emissive layer; draw glowing effects after this. */
  beginEmissive(w: number, h: number): void {
    const gl = this.gl;
    this.resize(w, h);
    this.rawBind(gl.FRAMEBUFFER, this.emissive.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private pass(
    program: WebGLProgram,
    target: RenderTarget | null,
    setup: () => void,
  ): void {
    const gl = this.gl;
    this.rawBind(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this.w, target ? target.h : this.h);
    gl.useProgram(program);
    setup();
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private blurInto(src: RenderTarget, tmp: RenderTarget, spread: number) {
    const gl = this.gl;
    const u = (n: string) => this.u.get(`${n}@b`) ?? null;
    // Horizontal src → tmp, vertical tmp → src.
    this.pass(this.blur, tmp, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(u("uSrc"), 0);
      gl.uniform2f(u("uDir"), spread / src.w, 0);
    });
    this.pass(this.blur, src, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
      gl.uniform1i(u("uSrc"), 0);
      gl.uniform2f(u("uDir"), 0, spread / tmp.h);
    });
  }

  /** Blur the emissive layer and add it onto the canvas. */
  composite(): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const ud = (n: string) => this.u.get(`${n}@d`) ?? null;
    // Emissive → quarter res.
    this.pass(this.down, this.a, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.emissive.tex);
      gl.uniform1i(ud("uSrc"), 0);
      gl.uniform2f(ud("uSrcTexel"), 1 / this.w, 1 / this.h);
    });
    // Quarter → eighth for the wide bloom.
    this.pass(this.down, this.c, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.a.tex);
      gl.uniform1i(ud("uSrc"), 0);
      gl.uniform2f(ud("uSrcTexel"), 0.5 / this.a.w, 0.5 / this.a.h);
    });
    this.blurInto(this.a, this.b, 1.2);
    this.blurInto(this.a, this.b, 2.0);
    this.blurInto(this.c, this.d, 1.5);
    this.blurInto(this.c, this.d, 3.0);

    const uc = (n: string) => this.u.get(`${n}@c`) ?? null;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.pass(this.comp, null, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.a.tex);
      gl.uniform1i(uc("uTight"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.c.tex);
      gl.uniform1i(uc("uWide"), 1);
      gl.uniform1f(uc("uIntensity"), this.settings.intensity);
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of [this.down, this.blur, this.comp]) gl.deleteProgram(p);
    for (const t of [this.emissive, this.a, this.b, this.c, this.d]) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    gl.deleteRenderbuffer(this.depth);
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
  }
}
