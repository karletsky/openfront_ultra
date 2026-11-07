#version 300 es
precision highp float;

uniform float uTime;
uniform float uCloudCover;
uniform float uCloudFade; // 0 when zoomed in close, 1 when far out
uniform float uCloudAlpha;
uniform vec4 uBounds; // the map, tiles: clouds thin out toward its edges

in vec2 vXY;
out vec4 fragColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// Must match cloudDensity() in terrain3d.frag.glsl (shadows).
float cloudNoise(vec2 xy) {
  vec2 p = xy * 0.006 + vec2(uTime * 0.004, uTime * 0.0015);
  float n = vnoise(p) * 0.5 + vnoise(p * 2.03 + 7.1) * 0.25 +
    vnoise(p * 4.1 - 3.3) * 0.125 + vnoise(p * 8.3 + 1.7) * 0.0625;
  return n / 0.9375;
}

void main() {
  float n = cloudNoise(vXY);
  float t = 1.0 - uCloudCover;
  float density = smoothstep(t, t + 0.18, n);
  if (density < 0.01 || uCloudFade <= 0.0) discard;
  // Brighter where denser (lit tops), slightly blue-gray at thin edges.
  float lit = smoothstep(t, t + 0.35, n);
  vec3 c = mix(vec3(0.74, 0.78, 0.85), vec3(1.0), lit);
  // Self-shadow: darker on the side away from the sun.
  float away = cloudNoise(vXY + vec2(6.0, 7.0)) - n;
  c *= 1.0 - clamp(away, 0.0, 0.2) * 0.8;
  vec2 size = uBounds.zw - uBounds.xy;
  vec2 e = min(vXY - uBounds.xy, uBounds.zw - vXY) / (size * 0.08);
  float edge = clamp(min(e.x, e.y), 0.0, 1.0);
  fragColor = vec4(c, density * uCloudAlpha * uCloudFade * edge);
}
