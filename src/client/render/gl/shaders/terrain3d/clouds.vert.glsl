#version 300 es
precision highp float;

// A horizontal plane at the cloud altitude, covering the map plus a margin.
layout(location = 0) in vec2 aCorner; // [0,1]²
uniform mat4 uViewProj;
uniform vec4 uBounds; // minX, minY, maxX, maxY (tiles): the map
uniform float uCloudHeight;
out vec2 vXY;

void main() {
  vXY = mix(uBounds.xy, uBounds.zw, aCorner);
  gl_Position = uViewProj * vec4(vXY, uCloudHeight, 1.0);
}
