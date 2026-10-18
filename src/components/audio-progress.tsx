import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Canvas, Fill, Shader, Skia } from 'react-native-skia';
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { timing } from '@/lib/motion';

const source = `
uniform float2 size;
uniform float progress;
uniform float time;
uniform float playing;
uniform float waveform;
uniform float amplitudes[40];
uniform float3 tint;
uniform float3 muted;
half4 main(float2 coord) {
  float lane = size.x / 40.0;
  int index = int(clamp(floor(coord.x / lane), 0.0, 39.0));
  float barX = (float(index) + 0.5) * lane;
  float amplitude = 0.0;
  ${Array.from({ length: 40 }, (_, index) => `if (index == ${index}) amplitude = amplitudes[${index}];`).join('\n')}
  float height = 1.5 + amplitude * 13.0;
  float2 q = float2(abs(coord.x - barX), max(abs(coord.y - size.y * 0.5) - height, 0.0));
  float bars = 1.0 - smoothstep(max(1.0, lane * 0.22), max(1.0, lane * 0.22) + 0.7, length(q));
  float line = 1.0 - smoothstep(1.4, 2.1, abs(coord.y - size.y * 0.5));
  float mask = mix(line, bars, waveform);
  float cursor = progress * size.x;
  float filled = 1.0 - smoothstep(cursor - 1.0, cursor + 1.0, coord.x);
  float glow = exp(-pow((coord.x - cursor) / 12.0, 2.0)) * playing * (0.10 + 0.04 * sin(time * 2.0));
  float3 color = mix(muted, tint, filled);
  color = mix(color, tint, glow);
  float alpha = mask * (0.42 + filled * 0.58);
  return half4(color * alpha, alpha);
}`;

function compileEffect() {
  try {
    return Skia.RuntimeEffect.Make(source);
  } catch {
    // A decorative effect must never prevent the app from opening.
    return null;
  }
}
const effect = compileEffect();

/** The waveform is sampled audio; the moving highlight follows real playback. */
export function AudioProgress({
  value,
  peaks,
  playing,
  disabled,
  label,
  onChange,
  onCommit,
}: {
  value: number;
  peaks: number[] | null;
  playing: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: number | null) => void;
  onCommit: (value: number) => void;
}) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(1);
  const fraction = useSharedValue(value);
  const clock = useSharedValue(0);
  useEffect(() => {
    fraction.set(reduced ? value : withTiming(value, timing('micro')));
  }, [fraction, reduced, value]);
  useFrameCallback((frame) => {
    if (playing && !reduced) clock.set((frame.timeSinceFirstFrame ?? 0) / 1000);
  });
  const tint = Array.from(Skia.Color(theme.colors.primary)).slice(0, 3);
  const muted = Array.from(Skia.Color(theme.colors.textMuted)).slice(0, 3);
  const amplitudes = peaks ?? Array.from({ length: 40 }, () => 0);
  const uniforms = useDerivedValue(() => ({
    size: [width, 48],
    progress: fraction.get(),
    time: clock.get(),
    playing: playing ? 1 : 0,
    waveform: peaks ? 1 : 0,
    amplitudes,
    tint,
    muted,
  }));
  const gesture = useMemo(() => {
    const position = (x: number) => Math.max(0, Math.min(1, x / width));
    const pan = Gesture.Pan()
      .enabled(!disabled)
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-10, 10])
      .onUpdate((event) => onChange(position(event.x)))
      .onEnd((event) => onCommit(position(event.x)))
      .onFinalize(() => onChange(null));
    const tap = Gesture.Tap()
      .enabled(!disabled)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (success) onCommit(position(event.x));
      });
    return Gesture.Exclusive(pan, tap);
  }, [disabled, onChange, onCommit, width]);
  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="audio-playback-position"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={({ nativeEvent: { actionName } }) => {
          if (disabled || !['increment', 'decrement'].includes(actionName)) return;
          onCommit(Math.max(0, Math.min(1, value + (actionName === 'increment' ? 0.05 : -0.05))));
        }}
        onLayout={({ nativeEvent }) => setWidth(Math.max(1, nativeEvent.layout.width))}
        style={{ height: 48, width: '100%' }}>
        {effect ? (
          <Canvas style={{ flex: 1 }} pointerEvents="none">
            <Fill>
              <Shader source={effect} uniforms={uniforms} />
            </Fill>
          </Canvas>
        ) : (
          <View style={{ height: 4, marginTop: 22, backgroundColor: theme.colors.border }}>
            <View
              style={{ height: 4, width: `${value * 100}%`, backgroundColor: theme.colors.primary }}
            />
          </View>
        )}
      </View>
    </GestureDetector>
  );
}
