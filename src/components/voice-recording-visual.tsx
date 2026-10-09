import { useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Fill, Path, Shader, Skia } from 'react-native-skia';
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

// Three folded sheets of light form an open spatial field. The mark is
// suggested by paired crests and a returning loop, never drawn as letterforms.
// Analytic curves keep the work bounded: no ray marching or texture sampling.
const source = `
uniform float2 size;
uniform float time;
uniform float level;
uniform float processing;
uniform float reveal;
uniform float motion;
uniform float dark;

float2 turn(float2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

half4 main(float2 coord) {
  float unit = min(size.x, size.y);
  float aa = 0.65 / unit;
  float voice = sqrt(clamp(level, 0.0, 1.0)) * motion * (1.0 - processing);
  float t = time;
  float expansion = 0.90 + reveal * 0.10 + voice * 0.12 - processing * 0.07;
  float2 p = (coord - size * 0.5) / (unit * expansion);
  float r = length(p);
  float3 light = float3(0.0);
  float density = 0.0;
  float3 ice = float3(0.12, 0.87, 1.0);
  float3 violet = float3(0.48, 0.32, 0.96);

  // Folded sheets are composed of fine parallel filaments, rather than solid
  // tubes. Opposing flows cross with varying depth and expose the hollow core.
  for (int i = 0; i < 3; i++) {
    float k = float(i);
    float2 q = turn(p, k * 1.05 + t * (0.075 - k * 0.055));
    q.y /= 0.88 + k * 0.055;
    float angle = atan(q.y, q.x);
    float radius = 0.235 + k * 0.012;
    float fold = sin(angle * 2.0 + t * 0.55 + k * 1.8) * (0.028 + voice * 0.026);
    fold += sin(angle * 3.0 - t * 0.4 + k * 2.2) * 0.017;
    radius += fold * (1.0 - processing * 0.50);
    float d = length(q) - radius;
    float depth = 0.5 + 0.5 * sin(angle * 2.0 + k * 2.0 + t * 0.22);
    float width = 0.018 + depth * 0.020 + voice * 0.010;
    float u = d / width;
    float veil = exp(-u * u * 1.4);
    float phase = u * 22.0 + angle * 8.0 - t * (1.1 + processing * 1.2) + k * 2.1;
    float strandDistance = abs(fract(phase / 6.283185 + 0.5) - 0.5) * 6.283185 * width / 22.0;
    float fibers = 1.0 - smoothstep(aa * 0.12, aa * 0.82, strandDistance);
    float edge = exp(-abs(d - width * 0.75) / (aa * 0.85));
    float wake = exp(-abs(d) / (width * 1.4));
    float current = pow(0.5 + 0.5 * cos(angle - t * (0.6 + processing * 0.6)
      + k * 2.1), 10.0);
    float front = 0.24 + depth * 0.76;
    float glow = veil * (0.13 + fibers * 0.65) * front
      + edge * (0.10 + current * 0.8) + wake * 0.055;
    float3 hue = mix(ice, violet, 0.5 + 0.5 * sin(angle + k * 1.3 - t * 0.22));
    float3 ink = hue * float3(0.34, 0.48, 0.78);
    float3 color = mix(ink, hue, dark * 0.78 + depth * 0.16);
    color = mix(color, float3(0.78, 0.98, 1.0), current * depth * 0.65);
    light += color * glow;
    density += glow;
  }

  // A diffuse inner field adds depth without an opaque disc. Sparse particles
  // orbit within it; the mask disappears smoothly before the canvas boundary.
  float core = exp(-r * r / 0.023) * (0.07 + voice * 0.08);
  float2 dust = turn(p, -t * 0.07) * 85.0;
  float2 cell = floor(dust);
  float seed = hash(cell);
  float2 center = float2(0.2 + 0.6 * seed, 0.2 + 0.6 * hash(cell + 7.0));
  float2 delta = fract(dust) - center;
  float star = exp(-dot(delta, delta) * 140.0) * step(0.92, seed);
  star *= smoothstep(0.12, 0.19, r) * (1.0 - smoothstep(0.31, 0.40, r));
  star *= 0.16 + 0.14 * sin(t * 0.7 + seed * 20.0);
  light += ice * (core + star) * mix(0.48, 0.9, dark);
  density += core + star;

  float alpha = 1.0 - exp(-density * 1.5);
  float3 color = light / max(density, 0.0001);
  float arrival = smoothstep(0.0, 1.0, reveal);
  return half4(clamp(color, 0.0, 1.0) * alpha * arrival, alpha * arrival);
}`;

// Preserve the same abstract silhouette if a device cannot compile the effect.
const fallback = Skia.Path.MakeFromSVGString(
  'M74 107 C93 57 208 99 206 145 C204 187 63 158 74 107 ' +
    'M103 65 C159 57 193 193 142 195 C90 195 53 73 103 65 ' +
    'M66 156 C49 113 182 55 208 101 C234 149 87 199 66 156'
);
const departure = fadeOut('short');

function compileEffect() {
  try {
    return Skia.RuntimeEffect.Make(source);
  } catch {
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
  const frameCallback = useFrameCallback((frame) => {
    clock.set((frame.timeSinceFirstFrame ?? 0) / 1000);
  }, false);
  useEffect(() => {
    frameCallback.setActive(!reduced);
    return () => frameCallback.setActive(false);
  }, [frameCallback, reduced]);
  const background = Skia.Color(theme.colors.background);
  const dark = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722 < 0.5;
  const uniforms = useDerivedValue(() => ({
    size: [WIDTH, HEIGHT],
    time: reduced ? 0 : clock.get(),
    level: reduced ? 0 : level.get(),
    processing: phase.get(),
    reveal: reveal.get(),
    motion: reduced ? 0 : 1,
    dark: dark ? 1 : 0,
  }));
  return (
    <Animated.View exiting={departure} pointerEvents="none">
      <Canvas
        testID={effect ? 'voice-recording-logo' : 'voice-recording-logo-fallback'}
        style={{ width: WIDTH, height: HEIGHT }}
        pointerEvents="none">
        {effect ? (
          <Fill>
            <Shader source={effect} uniforms={uniforms} />
          </Fill>
        ) : (
          fallback && (
            <Path
              path={fallback}
              style="stroke"
              strokeWidth={2}
              strokeCap="round"
              strokeJoin="round"
              color={theme.colors.primary}
            />
          )
        )}
      </Canvas>
    </Animated.View>
  );
}
