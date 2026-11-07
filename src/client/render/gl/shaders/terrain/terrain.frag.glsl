#version 300 es
precision highp float;

// RGB = baked terrain color, A = raw terrain byte / 255
// (bit 7 isLand, bit 6 isShoreline, bit 5 isOcean, bits 0-4 magnitude).
uniform sampler2D uTerrain;
uniform float uTime; // seconds, wrapped
uniform float uEnhanced; // 0 = flat baked colors, 1 = enhanced terrain
uniform float uRelief; // hillshade strength on land
uniform float uWater; // water shimmer / depth shading strength
uniform float uFoam; // shoreline foam strength

in vec2 vUV;
out vec4 fragColor;

const vec2 MAP_SIZE = vec2(float(MAP_W), float(MAP_H));
// Light from the upper-left (tile y grows downward), fairly low so relief
// reads clearly at gameplay zoom levels.
const vec3 LIGHT_DIR = vec3(-0.5773, -0.5773, 0.5773);

int terrainByte(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(MAP_W - 1, MAP_H - 1));
  return int(texelFetch(uTerrain, p, 0).a * 255.0 + 0.5);
}

// Land elevation in "magnitude" units. Water sits just below the lowest land
// so coasts get a gentle slope; impassable peaks clamp to the highest
// passable mountain so they don't form a cliff wall.
float tileHeight(ivec2 p) {
  int tb = terrainByte(p);
  if ((tb & 0x80) == 0) return -1.0;
  return float(min(tb & 0x1f, 30));
}

// Bilinearly interpolated height so shading is smooth inside each tile
// while the base colors stay pixel-crisp.
float smoothHeight(vec2 tp) {
  vec2 q = tp - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  float a = tileHeight(i);
  float b = tileHeight(i + ivec2(1, 0));
  float c = tileHeight(i + ivec2(0, 1));
  float d = tileHeight(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec4 texel = texture(uTerrain, vUV);
  vec3 color = texel.rgb;

  if (uEnhanced < 0.5) {
    fragColor = vec4(color, 1.0);
    return;
  }

  vec2 tp = vUV * MAP_SIZE;
  int tb = int(texel.a * 255.0 + 0.5);
  bool isLand = (tb & 0x80) != 0;
  bool isShore = (tb & 0x40) != 0;
  int mag = tb & 0x1f;

  // Screen pixels per tile. Animated detail fades out when tiles shrink
  // below a few pixels so zoomed-out views don't shimmer or alias.
  float pxPerTile = 1.0 / max(max(fwidth(tp.x), fwidth(tp.y)), 1e-4);
  float detail = smoothstep(1.5, 5.0, pxPerTile);

  if (isLand) {
    // Impassable terrain matches the background color; leave it flat.
    if (mag == 31) {
      fragColor = vec4(color, 1.0);
      return;
    }
    // Central differences over a 3-tile footprint smooth out the abrupt
    // magnitude steps between terrain bands.
    float hx = smoothHeight(tp + vec2(1.5, 0.0)) - smoothHeight(tp - vec2(1.5, 0.0));
    float hy = smoothHeight(tp + vec2(0.0, 1.5)) - smoothHeight(tp - vec2(0.0, 1.5));
    vec3 n = normalize(vec3(-hx * 0.07, -hy * 0.07, 1.0));
    // Relative to a flat tile, so flat plains keep their original color.
    float shade = clamp((dot(n, LIGHT_DIR) - LIGHT_DIR.z) * 2.0, -0.6, 0.6);
    color *= 1.0 + uRelief * shade * 0.5;

    // Large-scale soft variation so wide plains aren't a single flat color.
    float v = valueNoise(tp * 0.08) * 0.6 + valueNoise(tp * 0.31) * 0.4;
    color *= 1.0 + uRelief * (v - 0.5) * 0.08;
  } else {
    // Smooth depth shading: magnitude is the distance from shore. Sample the
    // depth bilinearly so the per-tile banding becomes a soft gradient.
    vec2 q = tp - 0.5;
    ivec2 i = ivec2(floor(q));
    vec2 f = fract(q);
    float da = float(terrainByte(i) & 0x1f);
    float db = float(terrainByte(i + ivec2(1, 0)) & 0x1f);
    float dc = float(terrainByte(i + ivec2(0, 1)) & 0x1f);
    float dd = float(terrainByte(i + ivec2(1, 1)) & 0x1f);
    float depth = mix(mix(da, db, f.x), mix(dc, dd, f.x), f.y);
    color *= 1.0 - uWater * 0.14 * smoothstep(0.0, 14.0, depth);

    // Two drifting noise layers → soft moving highlights on the water.
    float t = uTime;
    float w1 = valueNoise(tp * 0.18 + vec2(t * 0.35, t * 0.12));
    float w2 = valueNoise(tp * 0.41 - vec2(t * 0.22, -t * 0.31));
    float ripple = w1 * 0.6 + w2 * 0.4;
    float glint = smoothstep(0.72, 0.95, ripple);
    color += uWater * detail * (glint * 0.04 + (ripple - 0.5) * 0.03);

    // Pulsing foam along the shoreline water ring.
    if (isShore) {
      float phase = valueNoise(tp * 0.25 + vec2(t * 0.2, 0.0)) * 6.2831;
      float pulse = 0.5 + 0.5 * sin(t * 1.6 + phase);
      float foamNoise = valueNoise(tp * 1.3 + vec2(0.0, t * 0.5));
      float foam = pulse * smoothstep(0.35, 0.75, foamNoise);
      color = mix(color, vec3(1.0), uFoam * detail * foam * 0.45);
    }
  }

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
