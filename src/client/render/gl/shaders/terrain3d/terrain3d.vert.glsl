#version 300 es
precision highp float;

// World-space grid vertex (tiles).
layout(location = 0) in vec2 aPos;

uniform mat4 uViewProj;
// The 2D camera the flat map image was rendered with (world → clip).
uniform mat3 uImgCam;
uniform sampler2D uHeight;
uniform float uHeightScale;
uniform vec2 uMapSize;
uniform float uStep;

out vec2 vImgUV;
out vec3 vNormal;
out vec3 vWorld;

float heightAt(vec2 p) {
  return texture(uHeight, p / uMapSize).r * uHeightScale;
}

void main() {
  float h = heightAt(aPos);
  float e = uStep;
  float hx = heightAt(aPos + vec2(e, 0.0)) - heightAt(aPos - vec2(e, 0.0));
  float hy = heightAt(aPos + vec2(0.0, e)) - heightAt(aPos - vec2(0.0, e));
  vNormal = normalize(vec3(-hx, -hy, 2.0 * e));

  vec3 world = vec3(aPos, h);
  vWorld = world;
  gl_Position = uViewProj * vec4(world, 1.0);

  vec3 c = uImgCam * vec3(aPos, 1.0);
  vImgUV = c.xy * 0.5 + 0.5;
}
