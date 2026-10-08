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
const HEIGHT = 260;

// A luminous instrument: measured speech drives the waveform and orbit energy.
// Processing uses a scanner instead of inventing microphone activity.
const effect = Skia.RuntimeEffect.Make(`
uniform float2 size;
uniform float time;
uniform float level;
uniform float processing;
uniform float3 tint;

float beam(float distance, float width) {
  return exp(-abs(distance) / width);
}

half4 main(float2 coord) {
  float2 p = (coord - size * 0.5) / min(size.x, size.y);
  float aa = 1.0 / min(size.x, size.y);
  float r = length(p);
  float angle = atan(p.y, p.x);
  float voice = clamp(level, 0.0, 1.0) * (1.0 - processing);
  float radius = 0.31;
  float core = 1.0 - smoothstep(radius - aa, radius + aa, r);
  float3 cyan = float3(0.08, 0.86, 1.0);
  float3 violet = float3(0.55, 0.32, 1.0);
  float palette = 0.5 + 0.5 * sin(angle + time * 0.35);
  float3 neon = mix(cyan, violet, palette);
  neon = mix(neon, tint, 0.12);

  // A dark recessed core makes the light readable on any theme wallpaper.
  float3 color = float3(0.018, 0.035, 0.075) * core;
  float alpha = core;
  float gridX = pow(0.5 + 0.5 * cos(p.x * 140.0), 24.0);
  float gridY = pow(0.5 + 0.5 * cos(p.y * 140.0), 24.0);
  color += cyan * (gridX + gridY) * 0.023 * core;

  // Segmented outer rails and two travelling scan arcs.
  float rail = beam(r - 0.385, aa * 0.8);
  float segments = smoothstep(-0.25, 0.2, sin(angle * 32.0));
  float scanner = pow(0.5 + 0.5 * cos(angle - time * 1.4), 14.0);
  float counter = pow(0.5 + 0.5 * cos(angle + time * 0.9 + 2.4), 18.0);
  float orbit = beam(r - 0.348, aa) * (0.2 + scanner * 0.8);
  float outer = rail * segments * (0.22 + counter * 0.78);
  float edge = beam(r - radius, aa * 1.1);
  float halo = beam(r - radius, 0.018 + voice * 0.012) * (0.14 + voice * 0.2);
  float energy = edge * (0.5 + voice * 0.5) + orbit + outer + halo;
  color += neon * energy;
  alpha = max(alpha, clamp(energy, 0.0, 1.0));

  // Real metering controls the envelope; silence never looks like speech.
  float wave = 0.0;
  for (int i = 0; i < 17; i++) {
    float n = float(i) - 8.0;
    float envelope = exp(-n * n * 0.027);
    float variation = 0.65 + 0.35 * sin(time * 7.0 + n * 0.9);
    float height = 0.007 + voice * envelope * variation * 0.11;
    float2 q = float2(p.x - n * 0.023, max(abs(p.y) - height, 0.0));
    wave += beam(length(q), 0.0036);
  }
  wave *= 1.0 - processing;
  float sweep = pow(0.5 + 0.5 * cos(angle - time * 2.2), 6.0);
  float scan = beam(r - 0.105, aa * 1.2) * (0.12 + sweep) * processing;
  color += mix(cyan, float3(0.8, 0.96, 1.0), 0.55) * (wave + scan);
  // Premultiplied output preserves transparent edges around the instrument.
  return half4(min(color, float3(alpha)), alpha);
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
  const uniforms = useDerivedValue(() => ({
    size: [WIDTH, HEIGHT],
    time: clock.get(),
    level: level.get(),
    processing: phase.get(),
    tint,
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
