#version 300 es
precision highp float;

// Add the blurred glow (two radii mixed: a tight halo plus a wide bloom)
// onto the finished frame. Drawn with additive blending.
uniform sampler2D uTight;
uniform sampler2D uWide;
uniform float uIntensity;

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec3 g = texture(uTight, vUV).rgb * 0.9 + texture(uWide, vUV).rgb * 0.8;
  // Soft-clip so stacked explosions don't blow out to flat white.
  g = 1.0 - exp(-g * uIntensity);
  fragColor = vec4(g, 1.0);
}
