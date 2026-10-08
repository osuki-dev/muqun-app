import { useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Fill, Image, ImageShader, Shader, Skia, useImage } from 'react-native-skia';
import { useEffect } from 'react';
import Animated, {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { fadeOut, timing } from '@/lib/motion';

const WIDTH = 280;
const HEIGHT = 260;
const MARK = { x: 60, y: 50, width: 160, height: 160 };

// A split magnetic field follows the Cyber mark's angular geometry. Speech
// opens its two filaments; transcription gathers them back into the core.
const source = `
uniform shader logo;
uniform float2 size;
uniform float time;
uniform float level;
uniform float processing;
uniform float reveal;
uniform float motion;
uniform float3 tint;

float beam(float distance, float width) {
  return exp(-abs(distance) / width);
}

float hull(float2 point) {
  float2 q = abs(point);
  return max(max(q.x * 0.98, q.y * 1.04), (q.x + q.y) * 0.74);
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
  float unit = min(size.x, size.y);
  float2 p = (coord - center) / unit;
  float aa = 1.0 / unit;
  float r = length(p);
  float angle = atan(p.y, p.x);
  float voice = sqrt(clamp(level, 0.0, 1.0)) * (1.0 - processing);
  float breath = 0.5 + 0.5 * sin(time * 1.15);
  float scale = 0.94 + reveal * 0.06 + motion * (voice * 0.018 + breath * 0.003);
  float2 point = center + (coord - center) / scale;
  half4 mark = logo.eval(point);
  float3 cyan = mix(float3(0.03, 0.85, 1.0), tint, 0.12);
  float3 pink = float3(0.98, 0.22, 0.64);
  float3 neon = mix(cyan, pink, smoothstep(-0.22, 0.32, p.x));

  // A chamfered shadow echoes the logo's facets instead of enclosing it in a
  // generic orb. Its feathered edge leaves the surrounding sheet untouched.
  float contour = hull(p);
  float plate = 1.0 - smoothstep(0.315, 0.365, contour);
  float alpha = plate * 0.95;
  float3 color = float3(0.014, 0.025, 0.046) * alpha;
  float haze = exp(-r * r / 0.10) * (0.055 + voice * 0.12);
  color += neon * haze * plate;

  // Two opposing currents travel along the angular perimeter. The field
  // contracts during transcription, handing the motion to the core's scan.
  float radius = 0.376 + motion * voice * 0.012 - processing * 0.023;
  float current = pow(0.5 + 0.5 * cos(angle - time * 0.62), 8.0);
  float returning = pow(0.5 + 0.5 * cos(angle + time * 0.43 + 2.6), 10.0);
  float contourLight = beam(contour - radius, aa * 0.9)
    * (0.055 + current * 0.43 + returning * 0.18);
  float contourGlow = beam(contour - radius, 0.018) * current * 0.075;

  // The left and right filaments emerge from the mark, rather than floating
  // independently. Voice drives their spread; a quiet microphone stays calm.
  float side = abs(p.x);
  float envelope = smoothstep(0.25, 0.34, side)
    * (1.0 - smoothstep(0.47, 0.52, side));
  float amplitude = (0.014 + motion * voice * 0.043) * (1.0 - processing * 0.86);
  float wave = sin(side * 24.0 - time * 1.35) * amplitude
    + sin(side * 43.0 + time * 0.62) * amplitude * 0.24;
  float filament = (beam(p.y - wave, aa * 0.85)
    + beam(p.y + wave + 0.014, aa * 0.7) * 0.42) * envelope;
  float filamentGlow = beam(p.y - wave, 0.017) * envelope * 0.13;
  float light = contourLight + contourGlow
    + (filament * (0.20 + voice * 0.50) + filamentGlow) * (1.0 - processing * 0.7);

  // Sparse paired motes follow those same currents. Constant loop bounds keep
  // this compatible with the Android runtime shader compiler.
  for (int i = 0; i < 5; i++) {
    float index = float(i);
    float travel = fract(index * 0.2 + time * 0.065);
    float x = 0.32 + travel * 0.17;
    float y = sin(x * 24.0 - time * 1.35) * amplitude;
    float2 delta = float2(side - x, p.y - y);
    float mote = exp(-dot(delta, delta) / (aa * aa * 1.6));
    light += mote * sin(travel * 3.14159) * (0.12 + voice * 0.30)
      * (1.0 - processing);
  }

  float glow = (halo(point, 5.0) * 0.28 + halo(point, 11.0) * 0.14)
    * (1.0 - mark.a) * (0.40 + voice * 1.05 + processing * 0.16);
  float lightAlpha = clamp(light + glow, 0.0, 0.78);
  color = neon * lightAlpha + color * (1.0 - lightAlpha);
  alpha = lightAlpha + alpha * (1.0 - lightAlpha);

  // A single broad scan reads as work in progress, not a fabricated percentage.
  float sweep = beam(p.y - sin(time * 0.9) * 0.26, 0.038);
  float sheen = 0.025 + voice * 0.065 + processing * sweep * 0.26;
  float3 metal = min(float3(mark.rgb) + cyan * sheen * mark.a, float3(mark.a));
  color = metal + color * (1.0 - mark.a);
  alpha = mark.a + alpha * (1.0 - mark.a);
  float arrival = smoothstep(0.0, 1.0, reveal);
  return half4(min(color, float3(alpha)) * arrival, alpha * arrival);
}`;

const departure = fadeOut('short');

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
  const reveal = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    reveal.set(reduced ? 1 : withTiming(1, timing('medium')));
  }, [reveal, reduced]);
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
    reveal: reveal.get(),
    motion: reduced ? 0 : 1,
    tint,
  }));
  return (
    <Animated.View exiting={departure} pointerEvents="none">
      <Canvas
        testID={
          image
            ? effect
              ? 'voice-recording-logo'
              : 'voice-recording-logo-fallback'
            : 'voice-recording-loading'
        }
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
    </Animated.View>
  );
}
