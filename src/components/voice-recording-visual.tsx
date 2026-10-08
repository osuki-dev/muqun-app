import { useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Fill, Shader, Skia } from 'react-native-skia';
import { useEffect } from 'react';
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { timing } from '@/lib/motion';

const WIDTH = 280;
const HEIGHT = 196;

// A quiet liquid surface surrounds an actual microphone-driven waveform.
// Processing replaces the waveform with a travelling arc, rather than fake speech.
const effect = Skia.RuntimeEffect.Make(`
uniform float2 size;
uniform float time;
uniform float level;
uniform float processing;
uniform float3 tint;
uniform float3 ink;

half4 main(float2 coord) {
  float2 p = (coord - size * 0.5) / min(size.x, size.y);
  float aa = 1.0 / min(size.x, size.y);
  float r = length(p);
  float angle = atan(p.y, p.x);
  float voice = clamp(level, 0.0, 1.0) * (1.0 - processing);
  float radius = 0.31 + voice * 0.012;
  float mask = 1.0 - smoothstep(radius - aa, radius + aa, r);

  // Slow layers of light give the surface depth without orbiting particles.
  float bend = sin(p.x * 6.0 + time * 0.45) * 0.038;
  float ribbon = exp(-pow((p.y - bend - 0.04) * 10.0, 2.0));
  float light = clamp(0.22 - p.y * 0.6 + ribbon * 0.18, 0.0, 0.65);
  float3 surface = mix(tint, ink, light);
  float edge = smoothstep(radius * 0.65, radius, r);
  surface = mix(surface, tint * 0.78, edge * 0.28);

  // Silence stays nearly flat; the measured input controls each bar's height.
  float bars = 0.0;
  for (int i = 0; i < 7; i++) {
    float n = float(i) - 3.0;
    float envelope = 1.0 - abs(n) * 0.16;
    float variation = 0.72 + 0.28 * sin(time * 4.5 + n * 1.2);
    float height = 0.007 + voice * envelope * variation * 0.084;
    float2 q = float2(p.x - n * 0.033, max(abs(p.y) - height, 0.0));
    bars += 1.0 - smoothstep(0.005, 0.005 + aa, length(q));
  }
  bars = clamp(bars, 0.0, 1.0) * (1.0 - processing);

  float arcRadius = 0.10;
  float arcLine = 1.0 - smoothstep(aa, aa * 2.0, abs(r - arcRadius));
  float sweep = pow(0.5 + 0.5 * cos(angle - time * 2.0), 3.0);
  float arc = arcLine * (0.14 + sweep * 0.86) * processing;
  surface = mix(surface, ink, clamp(bars + arc, 0.0, 1.0) * 0.94);

  float ringRadius = radius + 0.036 + voice * 0.017;
  float ring = 1.0 - smoothstep(aa * 0.4, aa * 1.1, abs(r - ringRadius));
  float halo = exp(-pow((r - radius) * 26.0, 2.0)) * (0.05 + voice * 0.08);
  float outsideAlpha = (ring * (0.16 + voice * 0.2) + halo) * (1.0 - mask);
  float alpha = mask + outsideAlpha;
  float3 color = surface * mask + tint * outsideAlpha;
  return half4(color, alpha);
}`);

export function VoiceRecordingVisual({
  level,
  processing,
}: {
  level: SharedValue<number>;
  processing: boolean;
}) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const clock = useSharedValue(0);
  const phase = useSharedValue(processing ? 1 : 0);
  useEffect(() => {
    phase.set(reduced ? (processing ? 1 : 0) : withTiming(processing ? 1 : 0, timing('medium')));
  }, [phase, processing, reduced]);
  useFrameCallback((frame) => {
    if (!reduced) clock.set((frame.timeSinceFirstFrame ?? 0) / 1000);
  });
  const tint = Array.from(Skia.Color(theme.colors.primary)).slice(0, 3);
  const ink = Array.from(Skia.Color(theme.colors.onPrimary)).slice(0, 3);
  const uniforms = useDerivedValue(() => ({
    size: [WIDTH, HEIGHT],
    time: clock.get(),
    level: level.get(),
    processing: phase.get(),
    tint,
    ink,
  }));
  if (!effect) return null;
  return (
    <Canvas style={{ width: WIDTH, height: HEIGHT }} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
