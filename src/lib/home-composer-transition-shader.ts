/** A bounded rim of particles: open choices, collect a selection, then send. */
export const HOME_COMPOSER_TRANSITION_SKSL = `
uniform float2 size;
uniform float radius;
uniform float phase;
uniform float progress;
uniform float4 tint;

float hash(float n) { return fract(sin(n * 127.1 + 23.7) * 43758.5453); }

// Clockwise around the inset rounded field, starting at the top-left tangent.
float2 rim(float t) {
  float2 box = max(size - 8.0, float2(2.0));
  float r = clamp(radius - 4.0, 1.0, min(box.x, box.y) * 0.5);
  float x = box.x - 2.0 * r;
  float y = box.y - 2.0 * r;
  float arc = 1.5707963 * r;
  float d = fract(t) * (2.0 * x + 2.0 * y + 4.0 * arc);
  float2 p;
  if (d < x) p = float2(r + d, 0.0);
  else if ((d -= x) < arc) p = float2(box.x - r, r) + r * float2(sin(d / r), -cos(d / r));
  else if ((d -= arc) < y) p = float2(box.x, r + d);
  else if ((d -= y) < arc) p = float2(box.x - r, box.y - r) + r * float2(cos(d / r), sin(d / r));
  else if ((d -= arc) < x) p = float2(box.x - r - d, box.y);
  else if ((d -= x) < arc) p = float2(r, box.y - r) + r * float2(-sin(d / r), cos(d / r));
  else if ((d -= arc) < y) p = float2(0.0, box.y - r - d);
  else { d -= y; p = float2(r, r) + r * float2(-cos(d / r), -sin(d / r)); }
  return p + 4.0;
}

half4 main(float2 coord) {
  float p = clamp(progress, 0.0, 1.0);
  float envelope = smoothstep(0.0, 0.12, p) * (1.0 - smoothstep(0.62, 1.0, p));
  if (envelope <= 0.0 || tint.a <= 0.0) return half4(0.0);

  float r = clamp(radius, 1.0, min(size.x, size.y) * 0.5);
  float2 q = abs(coord - size * 0.5) - (size * 0.5 - r);
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  // Text and controls occupy the middle. Most fragments stop here.
  if (edge < -15.0 || edge > -0.5) return half4(0.0);

  float eased = smoothstep(0.0, 1.0, p);
  float ink = 0.0;
  for (int i = 0; i < 28; i++) {
    float seed = (float(i) + 0.5) / 28.0;
    float noise = hash(float(i));
    float t;
    if (phase < 0.5) {
      // Two small streams fan out from the options end of the field.
      t = 0.78 + (seed - 0.5) * eased * 1.5;
    } else if (phase < 1.5) {
      // The chosen value gathers back toward the draft.
      float delta = fract(0.78 - seed + 0.5) - 0.5;
      t = seed + delta * eased;
    } else {
      // An input gesture moving toward Send, with no success/progress claim.
      t = 0.78 - eased * 0.31 + (seed - 0.5) * (0.12 + p * 0.08);
    }
    float2 center = rim(t);
    float2 inward = normalize(size * 0.5 - center);
    center += inward * sin(seed * 18.84956 + p * 6.28318) * (1.0 - eased) * 3.0;
    float dist = length(coord - center);
    float core = 1.0 - smoothstep(0.4, 1.4 + noise * 0.7, dist);
    float halo = exp(-dist * dist / 18.0) * 0.26;
    float2 tail = rim(t + (phase > 1.5 ? 1.0 : -1.0) * (0.006 + noise * 0.008));
    float2 direction = center - tail;
    float along = clamp(dot(coord - tail, direction) / max(dot(direction, direction), 0.01), 0.0, 1.0);
    float trail = (1.0 - smoothstep(0.4, 1.4, length(coord - tail - direction * along))) * along;
    ink += (core + halo + trail * 0.32) * (0.4 + noise * 0.45);
  }
  // A fine line ties the individual lights together without painting a plate.
  float line = exp(-pow((edge + 4.0) / 0.85, 2.0));
  float ripple = 0.5 + 0.5 * sin(coord.x * 0.028 + coord.y * 0.04 - p * 7.0);
  float alpha = clamp(ink + line * ripple * 0.2, 0.0, 0.9) * envelope * tint.a;
  return half4(tint.rgb * alpha, alpha);
}
`;
