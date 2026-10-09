import { useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Fill, Group, Path, Shader, Skia } from 'react-native-skia';
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
const VISUAL_SCALE = 0.85;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const FALLBACK_TRANSFORM = [{ scale: VISUAL_SCALE }];

// Three folded sheets of light form an open spatial field. The mark is
// suggested by paired crests and a returning loop, never drawn as letterforms.
// Analytic curves keep the work bounded: no ray marching or texture sampling.
const source = `
uniform float2 size;
uniform float time;
uniform float level;
uniform float4 activity;
uniform float3 primaryColor;
uniform float3 accentColor;
uniform float3 successColor;
uniform float3 dangerColor;
uniform float3 inkColor;
uniform float3 lightColor;
uniform float reveal;
uniform float motion;
uniform float dark;
uniform float visualScale;

float2 turn(float2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}

half4 main(float2 coord) {
  float unit = min(size.x, size.y);
  float aa = 0.8 / (unit * visualScale);
  float recording = activity.x;
  float processing = activity.y;
  float success = activity.z;
  float failure = activity.w;
  float idle = max(0.0, 1.0 - recording - processing - success - failure);
  float voice = sqrt(clamp(level, 0.0, 1.0)) * motion * recording;
  float t = time;
  float expansion = visualScale * (0.90 + reveal * 0.10 + voice * 0.12 - processing * 0.09
    - idle * 0.12 + success * 0.12);
  float2 p = (coord - size * 0.5) / (unit * expansion);
  float r = length(p);
  float3 light = float3(0.0);
  float density = 0.0;
  float3 base = mix(mix(primaryColor, successColor, success), dangerColor, failure);
  float3 accent = mix(accentColor, base, max(success, failure));
  float3 highlight = mix(base, lightColor, 0.65);

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
    radius += fold * (1.0 - processing * 0.65 - success * 0.92 - failure * 0.65 - idle * 0.65);
    radius += success * k * 0.008;
    float d = length(q) - radius;
    float depth = 0.5 + 0.5 * sin(angle * 2.0 + k * 2.0 + t * 0.22);
    float width = (0.018 + depth * 0.020 + voice * 0.010)
      * (1.0 - success * 0.65 - failure * 0.35 - idle * 0.25);
    float u = d / width;
    float veil = exp(-u * u * 1.4);
    float phase = u * 14.0 + angle * 6.0 - t * 1.1 + k * 2.1;
    float strandDistance = abs(fract(phase / 6.283185 + 0.5) - 0.5) * 6.283185 * width / 14.0;
    float strandWidth = aa * 0.72;
    float fibers = exp(-strandDistance * strandDistance / (strandWidth * strandWidth));
    float edgeDistance = d - width * 0.75;
    float edge = exp(-edgeDistance * edgeDistance / (aa * aa * 1.4));
    float wake = exp(-abs(d) / (width * 1.4));
    float current = pow(0.5 + 0.5 * cos(angle - t * 0.6
      + k * 2.1), 10.0);
    float front = 0.24 + depth * 0.76;
    float glow = veil * (0.18 + fibers * 0.55) * front
      + edge * (0.10 + current * 0.8) + wake * 0.055;
    float gaps = smoothstep(0.10, 0.35, abs(sin(angle * 1.5 + k * 0.18)));
    glow *= mix(1.0, gaps, failure) * (1.0 - idle * 0.35);
    float3 hue = mix(base, accent, 0.5 + 0.5 * sin(angle + k * 1.3 - t * 0.22));
    float3 ink = mix(hue, inkColor, 0.28);
    float3 color = mix(ink, hue, dark * 0.78 + depth * 0.16);
    color = mix(color, highlight, current * depth * 0.65);
    light += color * glow;
    density += glow;
  }

  // A continuous inner glow supports the filaments. No discrete dust: small
  // moving dots and overly dense lines shimmer on compact phone displays.
  float core = exp(-r * r / 0.023) * (0.07 + voice * 0.08) * (1.0 - failure * 0.8);
  light += base * core * mix(0.48, 0.9, dark);
  density += core;

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

export type VoiceVisualState = 'idle' | 'recording' | 'processing' | 'success' | 'error';

function activityFor(state: VoiceVisualState) {
  return [
    state === 'recording' ? 1 : 0,
    state === 'processing' ? 1 : 0,
    state === 'success' ? 1 : 0,
    state === 'error' ? 1 : 0,
  ];
}

export function VoiceRecordingVisual({
  level,
  state,
}: {
  level: SharedValue<number>;
  state: VoiceVisualState;
}) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const clock = useSharedValue(0);
  const reveal = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    reveal.set(reduced ? 1 : withTiming(1, timing('medium')));
  }, [reveal, reduced]);
  const phase = useSharedValue(activityFor(state));
  useEffect(() => {
    phase.set(reduced ? activityFor(state) : withTiming(activityFor(state), timing('medium')));
  }, [phase, state, reduced]);
  const frameCallback = useFrameCallback((frame) => {
    const weights = phase.get();
    const speed = 0.22 + weights[0] * 0.78 + weights[1] * 1.48;
    clock.set(clock.get() + (Math.min(frame.timeSincePreviousFrame ?? 0, 64) / 1000) * speed);
  }, false);
  useEffect(() => {
    frameCallback.setActive(!reduced && state !== 'error');
    return () => frameCallback.setActive(false);
  }, [frameCallback, reduced, state]);
  const background = Skia.Color(theme.colors.background);
  const dark = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722 < 0.5;
  const primaryColor = Array.from(Skia.Color(theme.colors.primary)).slice(0, 3);
  const mutedColor = Array.from(Skia.Color(theme.colors.textMuted)).slice(0, 3);
  const accentColor = primaryColor.map(
    (channel, index) => channel * 0.75 + mutedColor[index] * 0.25
  );
  const successColor = Array.from(Skia.Color(theme.colors.success)).slice(0, 3);
  const dangerColor = Array.from(Skia.Color(theme.colors.danger)).slice(0, 3);
  const inkColor = Array.from(Skia.Color(theme.colors.text)).slice(0, 3);
  const lightColor = Array.from(Skia.Color(dark ? theme.colors.text : theme.colors.surface)).slice(
    0,
    3
  );
  const uniforms = useDerivedValue(() => ({
    size: [WIDTH, HEIGHT],
    visualScale: VISUAL_SCALE,
    time: reduced ? 0 : clock.get(),
    level: reduced ? 0 : level.get(),
    activity: phase.get(),
    primaryColor,
    accentColor,
    successColor,
    dangerColor,
    inkColor,
    lightColor,
    reveal: reveal.get(),
    motion: reduced ? 0 : 1,
    dark: dark ? 1 : 0,
  }));
  return (
    <Animated.View testID={`voice-visual-${state}`} exiting={departure} pointerEvents="none">
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
            <Group origin={CENTER} transform={FALLBACK_TRANSFORM}>
              <Path
                path={fallback}
                style="stroke"
                strokeWidth={2}
                strokeCap="round"
                strokeJoin="round"
                color={
                  state === 'error'
                    ? theme.colors.danger
                    : state === 'success'
                      ? theme.colors.success
                      : theme.colors.primary
                }
              />
            </Group>
          )
        )}
      </Canvas>
    </Animated.View>
  );
}
