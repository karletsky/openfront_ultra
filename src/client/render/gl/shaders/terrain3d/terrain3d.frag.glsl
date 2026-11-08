#version 300 es
precision highp float;

// The flat map (terrain, territory, units, names…) rendered top-down.
uniform sampler2D uScene;
uniform vec3 uBackground;
uniform vec3 uEye;
uniform float uLight; // directional lighting strength
uniform float uHaze; // distance haze strength
uniform float uHazeStart;
uniform float uHazeEnd;
uniform int uEmissive; // 1: draping the glow layer (raw colour, no lighting)
uniform sampler2D uWater; // 1 = water, bilinear (soft coastline)
uniform vec2 uMapSize;
uniform float uTime; // seconds
uniform float uSea; // sun glints / waves on water (0 = off)
uniform vec3 uSkyColor; // reflected in water at grazing angles
uniform float uCloudCover; // 0..1 share of the sky with clouds
uniform float uCloudFade; // 0..1 clouds fade out when zoomed in
uniform float uCloudHeight; // cloud layer altitude, tiles
uniform float uCloudShadow; // ground darkening under clouds

in vec2 vImgUV;
in vec3 vNormal;
in vec3 vWorld;
out vec4 fragColor;

// Sun from the north-west, matching the 2D terrain hillshade.
const vec3 LIGHT_DIR = vec3(-0.45, -0.55, 0.70);

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

// Cloud density at a world point on the cloud layer (same function as
// clouds.frag.glsl, so shadows line up with the clouds above).
float cloudDensity(vec2 xy) {
  vec2 p = xy * 0.006 + vec2(uTime * 0.004, uTime * 0.0015);
  float n = vnoise(p) * 0.5 + vnoise(p * 2.03 + 7.1) * 0.25 +
    vnoise(p * 4.1 - 3.3) * 0.125 + vnoise(p * 8.3 + 1.7) * 0.0625;
  n /= 0.9375;
  float t = 1.0 - uCloudCover;
  return smoothstep(t, t + 0.18, n);
}

void main() {
  if (uEmissive != 0) {
    bool inImg = all(greaterThanEqual(vImgUV, vec2(0.0))) &&
      all(lessThanEqual(vImgUV, vec2(1.0)));
    fragColor = inImg ? texture(uScene, vImgUV) : vec4(0.0);
    return;
  }
  vec3 col;
  if (any(lessThan(vImgUV, vec2(0.0))) || any(greaterThan(vImgUV, vec2(1.0)))) {
    col = uBackground;
  } else {
    col = texture(uScene, vImgUV).rgb;
  }

  vec3 L = normalize(LIGHT_DIR);
  vec3 n = normalize(vNormal);
  // Relative to flat ground, so flat areas keep the 2D colors exactly.
  float lit = dot(n, L) - L.z;
  col *= 1.0 + uLight * lit * 1.4;

  bool inMap = all(greaterThanEqual(vImgUV, vec2(0.0))) &&
    all(lessThanEqual(vImgUV, vec2(1.0)));
  vec3 V = normalize(uEye - vWorld);

  // Sea: wind-driven wave normals, sun glints and sky reflection at grazing
  // angles. The water mask is bilinear, so coasts blend smoothly.
  float water = inMap ? texture(uWater, vWorld.xy / uMapSize).r : 0.0;
  if (water > 0.01 && uSea > 0.0) {
    vec2 wp = vWorld.xy * 0.35;
    vec2 drift1 = vec2(uTime * 0.55, uTime * 0.21);
    vec2 drift2 = vec2(-uTime * 0.31, uTime * 0.47);
    float e = 0.35;
    float hx = vnoise(wp + drift1 + vec2(e, 0.0)) - vnoise(wp + drift1 - vec2(e, 0.0)) +
      0.5 * (vnoise(wp * 2.3 + drift2 + vec2(e, 0.0)) - vnoise(wp * 2.3 + drift2 - vec2(e, 0.0)));
    float hy = vnoise(wp + drift1 + vec2(0.0, e)) - vnoise(wp + drift1 - vec2(0.0, e)) +
      0.5 * (vnoise(wp * 2.3 + drift2 + vec2(0.0, e)) - vnoise(wp * 2.3 + drift2 - vec2(0.0, e)));
    // Waves are a few tiles wide: when a tile is under ~2 pixels they'd
    // alias into sparkle, so fade them toward a calm, broad sun reflection.
    float tilesPerPx = max(length(fwidth(vWorld.xy)), 1e-4);
    float detail = 1.0 - smoothstep(0.25, 0.6, tilesPerPx);
    vec3 wn = normalize(vec3(-hx * 0.9 * detail, -hy * 0.9 * detail, 1.0));
    vec3 R = reflect(-normalize(LIGHT_DIR), wn);
    float rv = max(dot(R, V), 0.0);
    float spec = pow(rv, 90.0) * 1.1 * detail + pow(rv, 14.0) * 0.07 +
      pow(rv, 4.0) * 0.05;
    float fresnel = pow(1.0 - max(V.z, 0.0), 3.0);
    col = mix(col, uSkyColor, fresnel * 0.35 * water * uSea);
    col += vec3(1.0, 0.97, 0.9) * spec * water * uSea;
  }

  // Cloud shadows: look up the cloud above this point toward the sun.
  if (uCloudFade > 0.0 && uCloudShadow > 0.0) {
    vec3 L = normalize(LIGHT_DIR);
    vec2 above = vWorld.xy + L.xy / L.z * (uCloudHeight - vWorld.z);
    col *= 1.0 - uCloudShadow * uCloudFade * cloudDensity(above);
  }

  float d = distance(vWorld, uEye);
  float haze = smoothstep(uHazeStart, uHazeEnd, d) * uHaze;
  vec3 hazeColor = mix(uBackground, vec3(0.78, 0.84, 0.92), 0.5);
  col = mix(col, hazeColor, haze);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
