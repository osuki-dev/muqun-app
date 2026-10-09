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

// The monogram is geometry, not a composited bitmap. Its signed-distance field
// drives the liquid silhouette, rounded metal, travelling light and echoes.
const source = `
uniform float2 size;
uniform float time;
uniform float level;
uniform float processing;
uniform float reveal;
uniform float motion;
uniform float dark;

float segment(float2 p, float2 a, float2 b) {
  float2 v = b - a;
  return length(p - a - v * clamp(dot(p - a, v) / dot(v, v), 0.0, 1.0));
}

float join(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float monogram(float2 p) {
  float m = segment(p, float2(-0.31, 0.16), float2(-0.31, -0.17));
  m = join(m, segment(p, float2(-0.31, -0.17), float2(-0.15, 0.035)), 0.025);
  m = join(m, segment(p, float2(-0.15, 0.035), float2(0.01, -0.17)), 0.025);
  m = join(m, segment(p, float2(0.01, -0.17), float2(0.01, 0.16)), 0.025);
  float2 q = (p - float2(0.155, -0.005)) / float2(0.15, 0.175);
  float ring = abs(length(q) - 1.0) * 0.15;
  float tail = segment(p, float2(0.19, 0.09), float2(0.32, 0.22));
  return join(m, join(ring, tail, 0.028), 0.025);
}

half4 main(float2 coord) {
  float unit = min(size.x, size.y);
  float aa = 0.75 / unit;
  float voice = sqrt(clamp(level, 0.0, 1.0)) * (1.0 - processing);
  float energy = motion * voice;
  float breath = sin(time * 1.35);
  float scale = 0.90 + reveal * 0.10 + energy * 0.07
    + motion * breath * 0.009 - processing * 0.045;
  float2 p = (coord - size * float2(0.5, 0.49)) / (unit * scale);

  // Slow domain flow bends the actual strokes. The microphone opens the mark;
  // transcription settles its silhouette while the light keeps circulating.
  float flow = motion * (0.0035 + voice * 0.017) * (1.0 - processing * 0.8);
  p += flow * float2(sin(p.y * 10.0 + time * 1.8),
    sin(p.x * 11.0 - time * 1.6));
  float width = 0.023 + energy * 0.004;
  float d = monogram(p);
  float edge = d - width;
  float shape = 1.0 - smoothstep(-aa, aa, edge);

  // A rounded cross-section and grazing highlight give the ribbon depth. No
  // opaque plate: negative space and the sheet's own theme remain visible.
  float e = 0.001;
  float2 gradient = float2(monogram(p + float2(e, 0.0)) - monogram(p - float2(e, 0.0)),
    monogram(p + float2(0.0, e)) - monogram(p - float2(0.0, e)));
  gradient /= max(length(gradient), 0.0001);
  float radial = clamp(d / width, 0.0, 1.0);
  float3 normal = float3(gradient * radial, sqrt(max(0.0, 1.0 - radial * radial)));
  float diffuse = max(dot(normal, normalize(float3(-0.5, -0.65, 1.0))), 0.0);
  float specular = pow(max(dot(normal, normalize(float3(-0.4, -0.55, 0.76))), 0.0), 24.0);
  float hue = 0.5 + 0.5 * sin(p.x * 7.5 - p.y * 5.0 - time * 0.55);
  float3 cyan = float3(0.05, 0.80, 0.86);
  float3 violet = float3(0.43, 0.33, 0.95);
  float3 spectrum = mix(cyan, violet, hue);
  float traveling = pow(0.5 + 0.5 * sin(p.x * 12.0 + p.y * 9.0
    - time * mix(1.25, 2.3, processing)), 9.0);
  float3 metal = mix(float3(0.018, 0.10, 0.17), spectrum, 0.28 + diffuse * 0.52);
  metal += float3(0.65, 0.92, 1.0) * specular * 0.85;
  metal += spectrum * traveling * (0.18 + energy * 0.28 + processing * 0.18);
  float rim = exp(-abs(edge) / (aa * 1.35));
  metal += float3(0.65, 0.95, 1.0) * rim * (0.25 + traveling * 0.42);

  // Quiet echoes follow the MQ silhouette itself. Speech releases them farther
  // out; processing draws them inward. No periodic on/off flash or fake progress.
  float echoes = 0.0;
  for (int i = 0; i < 3; i++) {
    float offset = float(i) / 3.0;
    float travel = fract(time * 0.18 + offset);
    float spread = mix(travel, 1.0 - travel, processing);
    float distance = 0.014 + spread * (0.044 + energy * 0.065);
    float envelope = sin(travel * 3.141593);
    float visibility = 0.5 + 0.5 * sin(p.x * 9.0 - p.y * 6.0 + offset * 6.283185 + time);
    echoes += exp(-abs(edge - distance) / (aa * 0.8))
      * envelope * envelope * visibility * (0.10 + energy * 0.16);
  }
  float halo = exp(-max(edge, 0.0) / 0.023) * (0.11 + energy * 0.15);
  float shadow = exp(-abs(monogram(p - float2(0.005, 0.012)) - width) / 0.016) * 0.10;
  float auraAlpha = clamp(echoes + halo + shadow, 0.0, 0.55) * (1.0 - shape);
  float3 aura = mix(spectrum * 0.60, spectrum, dark);
  float3 color = clamp(metal, 0.0, 1.0) * shape + aura * auraAlpha;
  float alpha = shape + auraAlpha;
  float arrival = smoothstep(0.0, 1.0, reveal);
  return half4(color * arrival, alpha * arrival);
}`;

// A shader compilation failure still leaves an identifiable, tappable mark.
const fallback = Skia.Path.MakeFromSVGString(
  'M59.4 169 L59.4 83.2 L101 136.5 L142.6 83.2 L142.6 169 ' +
    'M219.3 125.9 A39 45.5 0 1 1 141.3 125.9 A39 45.5 0 1 1 219.3 125.9 ' +
    'M189.4 150.6 L223.2 184.4'
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
              strokeWidth={12}
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
