#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner; // quad corner, [-1,1]²

// Per instance
layout(location = 1) in vec4 aPosDir; // world x, y (tile corner), heading x, y
layout(location = 2) in vec4 aMeta; // ownerID, kind (+8 = untargetable), progress, seed

uniform mat3 uCamera;
uniform float uZoom; // screen pixels per tile for this camera
uniform float uMinLengthPx; // missiles never shrink below this on screen
uniform float uSizeScale;
uniform float uShadowHeight; // ground-shadow offset at mid-flight, in missile lengths

out vec2 vLocal; // fragment position in the missile frame, in missile lengths
flat out vec2 vShadow; // shadow offset in the missile frame, in missile lengths
flat out float vOwner;
flat out float vKind;
flat out float vUntargetable;
flat out float vProgress;
flat out float vSeed;
flat out float vPxPerUnit; // screen pixels per missile length (for anti-aliasing)

// Missile length in tiles per kind: atom, hydrogen, MIRV, MIRV warhead,
// tactical, EMP, dirty.
float kindLength(float k) {
  if (k < 0.5) return 8.0;
  if (k < 1.5) return 11.0;
  if (k < 2.5) return 13.0;
  if (k < 3.5) return 4.5;
  if (k < 4.5) return 5.5;
  if (k < 5.5) return 9.0;
  return 7.0;
}

void main() {
  float kindRaw = aMeta.y;
  float untargetable = step(7.5, kindRaw);
  float kind = kindRaw - 8.0 * untargetable;
  vKind = kind;
  vUntargetable = untargetable;
  vOwner = aMeta.x;
  vProgress = aMeta.z;
  vSeed = aMeta.w;

  float len = kindLength(kind) * uSizeScale;
  // Keep missiles readable when zoomed far out.
  len = max(len, uMinLengthPx / max(uZoom, 1e-4));
  vPxPerUnit = len * uZoom;

  vec2 dir = normalize(aPosDir.zw);
  vec2 perp = vec2(-dir.y, dir.x);

  // Ground shadow: the missile climbs then falls (sin arc); its shadow is
  // cast down-right, so it drifts away from the missile mid-flight.
  float alt = sin(3.14159265 * clamp(vProgress, 0.0, 1.0));
  vec2 shadowWorld = vec2(0.55, 0.85) * alt * uShadowHeight; // missile lengths
  vShadow = vec2(dot(shadowWorld, dir), dot(shadowWorld, perp));

  // Quad big enough for plume (behind), glow and shadow: 2.4 lengths across.
  float extent = 1.2 + uShadowHeight;
  vLocal = aCorner * extent;
  vec2 center = aPosDir.xy + 0.5;
  vec2 world = center + (dir * vLocal.x + perp * vLocal.y) * len;
  vec3 clip = uCamera * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
