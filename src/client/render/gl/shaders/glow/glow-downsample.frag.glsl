#version 300 es
precision highp float;

// Emissive layer → quarter-resolution bright source. A 4-tap box filter
// (each tap is itself a bilinear 2×2 average) keeps small sparks from
// shimmering as they move between source pixels.
uniform sampler2D uSrc;
uniform vec2 uSrcTexel; // 1 / source size

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec2 o = uSrcTexel;
  vec4 c =
    texture(uSrc, vUV + vec2(-o.x, -o.y)) +
    texture(uSrc, vUV + vec2(o.x, -o.y)) +
    texture(uSrc, vUV + vec2(-o.x, o.y)) +
    texture(uSrc, vUV + vec2(o.x, o.y));
  c *= 0.25;
  // Premultiplied: the effects were drawn with alpha blending onto a clear
  // (transparent) target, so rgb already carries their coverage.
  fragColor = vec4(c.rgb, 1.0);
}
