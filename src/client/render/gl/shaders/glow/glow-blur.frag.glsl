#version 300 es
precision highp float;

// Separable 9-tap gaussian using bilinear taps (5 fetches).
uniform sampler2D uSrc;
uniform vec2 uDir; // texel step along the blur axis, scaled by the spread

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec3 c = texture(uSrc, vUV).rgb * 0.227027;
  vec2 d1 = uDir * 1.3846153846;
  vec2 d2 = uDir * 3.2307692308;
  c += texture(uSrc, vUV + d1).rgb * 0.3162162162;
  c += texture(uSrc, vUV - d1).rgb * 0.3162162162;
  c += texture(uSrc, vUV + d2).rgb * 0.0702702703;
  c += texture(uSrc, vUV - d2).rgb * 0.0702702703;
  fragColor = vec4(c, 1.0);
}
