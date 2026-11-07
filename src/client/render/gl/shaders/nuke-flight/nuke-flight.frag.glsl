#version 300 es
precision highp float;

// Procedural nuke in flight, drawn in the missile's own frame: x runs from
// the tail (-0.5) to the nose (+0.5), y across; one unit = missile length.
// Layers back to front: ground shadow, heat glow, exhaust plume, body.

uniform sampler2D uPalette; // row 0.25 territory color, 0.75 border color
uniform float uTime; // seconds
uniform float uUntargetableAlpha;
uniform float uGlowStrength;
uniform float uPlumeLength; // in missile lengths

in vec2 vLocal;
flat in vec2 vShadow;
flat in float vOwner;
flat in float vKind;
flat in float vUntargetable;
flat in float vProgress;
flat in float vSeed;
flat in float vPxPerUnit;

out vec4 fragColor;

const float HALF = 0.5;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

float bodyRadius(float kind) {
  if (kind < 0.5) return 0.11; // atom
  if (kind < 1.5) return 0.12; // hydrogen
  if (kind < 2.5) return 0.14; // MIRV bus
  return 0.17; // warhead (short and stubby)
}

vec3 noseColor(float kind) {
  if (kind < 0.5) return vec3(0.95, 0.32, 0.12); // atom: red-orange
  if (kind < 1.5) return vec3(1.0, 0.8, 0.15); // hydrogen: yellow
  if (kind < 2.5) return vec3(0.68, 0.28, 0.95); // MIRV: violet
  return vec3(1.0, 0.45, 0.2); // warhead
}

vec3 glowColor(float kind) {
  if (kind < 0.5) return vec3(1.0, 0.5, 0.15);
  if (kind < 1.5) return vec3(1.0, 0.85, 0.35);
  if (kind < 2.5) return vec3(0.8, 0.4, 1.0);
  return vec3(1.0, 0.55, 0.25);
}

// Signed distance-ish to the missile silhouette (negative inside) and which
// part was hit: 0 body, 1 nose, 2 fin.
float silhouette(vec2 p, float r, out float part) {
  part = 0.0;
  float x = p.x;
  float ay = abs(p.y);
  if (x > HALF || x < -HALF - 0.02) {
    return 1.0;
  }
  float nose = 0.24;
  float noseStart = HALF - nose;
  float rad = r;
  if (x > noseStart) {
    float t = (x - noseStart) / nose;
    rad = r * sqrt(max(0.0, 1.0 - t * t)); // rounded ogive
    part = 1.0;
  }
  float d = ay - rad;
  // Tail fins: triangles flaring out over the last 22% of the body.
  float finLen = 0.22;
  float ft = clamp((-HALF + finLen - x) / finLen, 0.0, 1.0); // 0 root → 1 tail
  if (ft > 0.0) {
    float finRad = r * (1.0 + 1.1 * ft);
    if (ay > r) part = 2.0;
    return ay - finRad;
  }
  return d;
}

vec4 over(vec4 top, vec4 bottom) {
  float a = top.a + bottom.a * (1.0 - top.a);
  vec3 c = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / max(a, 1e-4);
  return vec4(c, a);
}

void main() {
  vec2 p = vLocal;
  float r = bodyRadius(vKind);
  float aa = 1.5 / max(vPxPerUnit, 1.0); // ~1.5 px in missile units
  float t = uTime;

  float u = (vOwner + 0.5) / float(PALETTE_SIZE);
  vec3 ownerColor = texture(uPalette, vec2(u, 0.25)).rgb;
  vec3 ownerDark = texture(uPalette, vec2(u, 0.75)).rgb;

  vec4 col = vec4(0.0);

  // --- Ground shadow ---------------------------------------------------
  {
    vec2 q = p - vShadow;
    float e = (q.x * q.x) / (HALF * HALF * 1.1) + (q.y * q.y) / (r * r * 3.0);
    float s = exp(-e * 2.2) * 0.32;
    col = over(vec4(0.0, 0.0, 0.0, s), col);
  }

  // --- Heat glow -------------------------------------------------------
  // Pulses gently; in the terminal phase it brightens and flashes red as a
  // warning that impact is imminent.
  float terminal = smoothstep(0.82, 1.0, vProgress);
  {
    float d2 = dot(p, p);
    float pulse = 0.8 + 0.2 * sin(t * 7.0 + vSeed * 6.2831);
    vec3 gc = glowColor(vKind);
    float warn = terminal * (0.5 + 0.5 * sin(t * 18.0 + vSeed * 6.2831));
    gc = mix(gc, vec3(1.0, 0.15, 0.1), warn);
    float g = exp(-d2 / (0.42 * 0.42)) * uGlowStrength * pulse * (1.0 + terminal * 0.8);
    col = over(vec4(gc, clamp(g, 0.0, 0.85)), col);
  }

  // --- Exhaust plume ---------------------------------------------------
  {
    float tail = -HALF;
    float dBehind = tail - p.x; // > 0 behind the nozzle
    if (dBehind > -0.02) {
      float plume = uPlumeLength * (vKind > 2.5 ? 0.55 : 1.0);
      float d = max(dBehind, 0.0);
      float flick = noise1(d * 9.0 - t * 38.0 + vSeed * 50.0);
      float flick2 = noise1(t * 21.0 + vSeed * 13.0);
      float len = plume * (0.75 + 0.35 * flick2);
      float width = r * (0.75 + 1.3 * d / len);
      float across = p.y / width;
      float core = exp(-across * across * 6.0) * exp(-d / (len * 0.28));
      float outer = exp(-across * across * 1.6) * exp(-d / (len * 0.6));
      outer *= 0.7 + 0.5 * flick;
      float fade = smoothstep(len * 1.4, len * 0.6, d);
      float intensity = clamp(core * 1.2 + outer * 0.8, 0.0, 1.0) * fade;
      vec3 hot = vec3(1.0, 0.98, 0.9);
      vec3 mid = vec3(1.0, 0.78, 0.25);
      vec3 cool = vec3(0.95, 0.3, 0.08);
      vec3 pc = mix(cool, mid, smoothstep(0.15, 0.55, intensity));
      pc = mix(pc, hot, smoothstep(0.6, 0.95, intensity));
      // Smoke wisps further back.
      float smoke = exp(-across * across * 0.7) *
        smoothstep(len * 0.5, len * 1.2, d) * smoothstep(len * 2.2, len * 1.2, d) *
        (0.35 + 0.4 * noise1(d * 5.0 - t * 12.0 + vSeed * 20.0));
      col = over(vec4(vec3(0.55, 0.55, 0.58), smoke * 0.35), col);
      col = over(vec4(pc, intensity), col);
    }
  }

  // --- Body ------------------------------------------------------------
  {
    float part;
    float d = silhouette(p, r, part);
    float inside = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);
    if (inside > 0.0) {
      float n = clamp(p.y / r, -1.0, 1.0);
      // Cylinder shading lit from the upper side, plus a specular streak.
      float shade = 0.62 + 0.38 * sqrt(max(0.0, 1.0 - n * n)) - 0.18 * n;
      float spec = pow(max(0.0, 1.0 - abs(n + 0.45) * 2.2), 3.0) * 0.45;
      vec3 base = vec3(0.86, 0.87, 0.9);
      // Owner-colored band behind the nose.
      if (part < 0.5 && p.x > 0.02 && p.x < 0.16) base = ownerColor;
      // Dark band near the tail.
      if (part < 0.5 && p.x > -0.3 && p.x < -0.25) base = ownerDark;
      if (part > 0.5 && part < 1.5) base = noseColor(vKind);
      if (part > 1.5) base = ownerDark;
      vec3 bc = base * shade + spec;
      // Hydrogen bombs carry a hazard stripe pattern on the body.
      if (vKind > 0.5 && vKind < 1.5 && part < 0.5 && p.x > -0.2 && p.x < 0.0) {
        float stripe = step(0.5, fract((p.x + p.y) * 22.0));
        bc = mix(bc, vec3(0.12) * shade + spec, stripe * 0.85);
      }
      // Re-entry heating on the nose in the terminal phase.
      float heat = terminal * smoothstep(0.1, HALF, p.x);
      bc = mix(bc, vec3(1.0, 0.55, 0.2), heat * 0.6);
      // Dark outline for contrast against any terrain.
      float rim = smoothstep(-aa * 2.0, -aa * 0.5, d);
      bc = mix(bc, vec3(0.06, 0.06, 0.08), rim * 0.85);
      col = over(vec4(bc, inside), col);
    }
  }

  float alpha = col.a * mix(1.0, uUntargetableAlpha, vUntargetable);
  if (alpha < 0.003) discard;
  fragColor = vec4(col.rgb, alpha);
}
