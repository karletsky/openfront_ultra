#version 300 es
precision highp float;

uniform sampler2D uPalette; // row 0.25 territory color, 0.75 border color
uniform float uTime;

in vec3 vNormal;
flat in float vMaterial;
flat in float vOwner;
flat in float vConstruction;
flat in float vDisabled;
in float vZ;
out vec4 fragColor;

const vec3 LIGHT_DIR = vec3(-0.45, -0.55, 0.70);

void main() {
  float u = (vOwner + 0.5) / float(PALETTE_SIZE);
  vec3 owner = texture(uPalette, vec2(u, 0.25)).rgb;
  vec3 ownerDark = texture(uPalette, vec2(u, 0.75)).rgb;
  int mat = int(vMaterial + 0.5);
  vec3 base;
  float emissive = 0.0;
  if (mat == 0) base = owner;
  else if (mat == 1) base = ownerDark;
  else if (mat == 2) base = vec3(0.68, 0.67, 0.64); // concrete
  else if (mat == 3) base = vec3(0.32, 0.34, 0.38); // metal
  else if (mat == 4) { base = vec3(1.0, 0.86, 0.5); emissive = 0.45; } // windows
  else if (mat == 5) base = mix(ownerDark, vec3(0.25), 0.35); // roof
  else base = vec3(0.95, 0.78, 0.15); // hazard

  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(LIGHT_DIR)), 0.0);
  // Sky ambient from above, a little bounce from the ground.
  float amb = 0.42 + 0.18 * n.z;
  vec3 col = base * (amb + diff * 0.75);
  col = mix(col, base, emissive);
  // Contact darkening at the base.
  col *= 0.75 + 0.25 * smoothstep(0.0, 0.12, vZ);

  float alpha = 1.0;
  if (vConstruction > 0.5) {
    // Scaffold look: desaturated and striped.
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g), 0.6);
    alpha = 0.85;
  }
  if (vDisabled > 0.5) {
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    float flicker = 0.5 + 0.5 * sin(uTime * 23.0 + vZ * 30.0);
    col = mix(vec3(g * 0.55), vec3(0.35, 0.85, 1.0), 0.25 + 0.35 * flicker);
  }
  fragColor = vec4(col, alpha);
}
