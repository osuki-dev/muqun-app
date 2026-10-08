import { useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Fill, Image, ImageShader, Shader, Skia, useImage } from 'react-native-skia';
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
const MARK = { x: 60, y: 50, width: 160, height: 160 };

// The shipped Cyber mark stays legible. Speech energizes its silhouette rather
// than replacing it with an unrelated equalizer; processing uses a slow scan.
const source = `
uniform shader logo;
uniform float2 size;
uniform float time;
uniform float level;
uniform float processing;
uniform float motion;
uniform float3 tint;

float beam(float distance, float width) {
  return exp(-abs(distance) / width);
}

float halo(float2 point, float spread) {
  float2 x = float2(spread, 0.0);
  float2 y = float2(0.0, spread);
  float2 diagonal = float2(spread * 0.7071);
  return (logo.eval(point + x).a + logo.eval(point - x).a
    + logo.eval(point + y).a + logo.eval(point - y).a
    + logo.eval(point + diagonal).a + logo.eval(point - diagonal).a
    + logo.eval(point + float2(diagonal.x, -diagonal.y)).a
    + logo.eval(point + float2(-diagonal.x, diagonal.y)).a) / 8.0;
}

half4 main(float2 coord) {
  float2 center = size * 0.5;
  float2 p = (coord - center) / min(size.x, size.y);
  float aa = 1.0 / min(size.x, size.y);
  float r = length(p);
  float angle = atan(p.y, p.x);
  float voice = clamp(level, 0.0, 1.0) * (1.0 - processing);
  float breath = sin(time * 1.25) * 0.5 + 0.5;
  float scale = 1.0 + motion * (voice * 0.035 + breath * 0.008);
  float2 point = center + (coord - center) / scale;
  half4 mark = logo.eval(point);
  float3 cyan = mix(float3(0.02, 0.87, 0.96), tint, 0.08);
  float3 pink = float3(0.90, 0.20, 0.65);
  float3 neon = mix(cyan, pink, smoothstep(-0.3, 0.4, p.x));

  // A softly feathered midnight backing keeps the mark readable on any theme.
  float plate = 1.0 - smoothstep(0.335, 0.395, r);
  float3 color = float3(0.018, 0.032, 0.060) * plate * 0.96;
  float alpha = plate * 0.96;
  float haze = exp(-r * r / 0.12) * (0.07 + voice * 0.10);
  color += neon * haze * plate;

  // Two restrained light trails leave the middle quiet and the logo intact.
  float radius = 0.382 + motion * voice * 0.012;
  float trail = pow(0.5 + 0.5 * cos(angle - time * 0.65), 12.0);
  float counter = pow(0.5 + 0.5 * cos(angle + time * 0.45 + 2.4), 18.0);
  float rail = beam(r - radius, aa * 0.85) * (0.08 + trail * 0.48);
  float outer = beam(r - 0.428, aa * 0.65) * counter * 0.22;
  float orbit = rail + outer;
  float glow = halo(point, 6.0) * 0.26 + halo(point, 12.0) * 0.12;
  glow *= (1.0 - mark.a) * (0.48 + voice * 0.85);
  float energy = glow + orbit;
  float lightAlpha = clamp(energy, 0.0, 0.65);
  color = neon * lightAlpha + color * (1.0 - lightAlpha);
  alpha = lightAlpha + alpha * (1.0 - lightAlpha);

  // A broad, low-contrast sheen follows the metal; no flashing or distortion.
  float sweep = beam(p.y - sin(time * 0.75) * 0.27, 0.045);
  float sheen = (0.03 + voice * 0.07 + processing * sweep * 0.16);
  float3 metal = min(float3(mark.rgb) + cyan * sheen * mark.a, float3(mark.a));
  color = metal + color * (1.0 - mark.a);
  alpha = mark.a + alpha * (1.0 - mark.a);
  return half4(min(color, float3(alpha)), alpha);
}`;

function compileEffect() {
  try {
    return Skia.RuntimeEffect.Make(source);
  } catch {
    // Decorative lighting must never prevent recording or hide the mark.
    return null;
  }
}
const effect = compileEffect();

export function VoiceRecordingVisual({
  level,
  processing,
}: {
  level: SharedValue<number>;
  processing: boolean;
}) {
  const theme = useThemeTokens();
  const image = useImage(require('../../assets/icons/cyber/mark.png'));
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
    motion: reduced ? 0 : 1,
    tint,
  }));
  return (
    <Canvas
      testID={image ? 'voice-recording-logo' : 'voice-recording-loading'}
      style={{ width: WIDTH, height: HEIGHT }}
      pointerEvents="none">
      {image &&
        (effect ? (
          <Fill>
            <Shader source={effect} uniforms={uniforms}>
              <ImageShader image={image} fit="contain" rect={MARK} tx="decal" ty="decal" />
            </Shader>
          </Fill>
        ) : (
          <Image image={image} fit="contain" {...MARK} />
        ))}
    </Canvas>
  );
}
