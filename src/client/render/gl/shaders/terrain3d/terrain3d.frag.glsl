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

in vec2 vImgUV;
in vec3 vNormal;
in vec3 vWorld;
out vec4 fragColor;

// Sun from the north-west, matching the 2D terrain hillshade.
const vec3 LIGHT_DIR = vec3(-0.45, -0.55, 0.70);

void main() {
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

  float d = distance(vWorld, uEye);
  float haze = smoothstep(uHazeStart, uHazeEnd, d) * uHaze;
  vec3 hazeColor = mix(uBackground, vec3(0.78, 0.84, 0.92), 0.5);
  col = mix(col, hazeColor, haze);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
