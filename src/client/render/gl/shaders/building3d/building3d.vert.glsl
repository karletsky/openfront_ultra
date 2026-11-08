#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos; // model space: unit footprint, z up
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aMaterial;
// Per instance: tile x, y, ownerID, flags (1 = under construction)
layout(location = 3) in vec4 aInst;
// Per instance: level, EMP-disabled-until tick
layout(location = 4) in vec2 aInst2;

uniform mat4 uViewProj;
uniform sampler2D uHeight;
uniform float uHeightScale;
uniform vec2 uMapSize;
uniform float uScale; // model footprint, tiles
uniform float uGameTick;

out vec3 vNormal;
flat out float vMaterial;
flat out float vOwner;
flat out float vConstruction;
flat out float vDisabled;
out float vZ;

void main() {
  vec2 center = aInst.xy + 0.5;
  float ground = texture(uHeight, center / uMapSize).r * uHeightScale;
  // Higher levels grow taller (cities get more skyscraper).
  float levelBoost = 1.0 + 0.12 * clamp(aInst2.x - 1.0, 0.0, 6.0);
  float construction = step(0.5, aInst.w);
  // Under construction: rising from the ground at half height.
  float hScale = levelBoost * mix(1.0, 0.45, construction);
  vec3 p = vec3(aPos.xy * uScale, aPos.z * uScale * 1.15 * hScale);
  vec3 world = vec3(center + p.xy, ground + p.z);
  gl_Position = uViewProj * vec4(world, 1.0);
  vNormal = normalize(vec3(aNormal.xy, aNormal.z / max(hScale, 0.01)));
  vMaterial = aMaterial;
  vOwner = aInst.z;
  vConstruction = construction;
  vDisabled = step(uGameTick + 0.5, aInst2.y);
  vZ = aPos.z;
}
