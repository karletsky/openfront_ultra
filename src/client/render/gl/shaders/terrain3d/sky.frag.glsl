#version 300 es
precision highp float;

// 3D view background: a vertical gradient from the background colour at the
// top to a lighter, hazier tone at the bottom, with a soft vignette.
uniform vec3 uTop;
uniform vec3 uBottom;

in vec2 vUV;
out vec4 fragColor;

void main() {
  float t = smoothstep(0.0, 1.0, vUV.y);
  vec3 c = mix(uBottom, uTop, t);
  vec2 q = vUV - 0.5;
  c *= 1.0 - dot(q, q) * 0.45;
  fragColor = vec4(c, 1.0);
}
