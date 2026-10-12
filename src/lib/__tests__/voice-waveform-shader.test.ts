import { afterAll, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import CanvasKitInit from 'canvaskit-wasm';
import { VOICE_METER_SAMPLES } from '../voice-meter-history';
import { VOICE_WAVEFORM_SKSL } from '../voice-waveform-shader';

// Compile and rasterize the actual SkSL with the installed Skia WASM backend.
// Device Graphite validation remains separate; this catches syntax/uniform and
// alpha/meter defects without a screenshot-only source-string assertion.
const nodeRequire = createRequire(import.meta.url);
const kit = await CanvasKitInit({
  locateFile: (file) => join(dirname(nodeRequire.resolve('canvaskit-wasm')), file),
});
const diagnostics: string[] = [];
const effect = kit.RuntimeEffect.Make(VOICE_WAVEFORM_SKSL, (message) => diagnostics.push(message));
afterAll(() => effect?.delete());

function render(
  samples: number[],
  time = 0,
  motion = 1,
  tint = [0.1, 0.4, 0.8],
  processing = 0,
  height = 56,
  tintOpacity = 1
) {
  if (!effect) throw new Error(diagnostics.join('\n'));
  const surface = kit.MakeSurface(240, height)!;
  const shader = effect.makeShader([
    240,
    height,
    time,
    motion,
    processing,
    ...samples,
    ...tint,
    ...tint.map((x) => x * 0.65 + 0.35),
    tintOpacity,
  ]);
  const paint = new kit.Paint();
  try {
    paint.setShader(shader);
    surface.getCanvas().clear(kit.TRANSPARENT);
    surface.getCanvas().drawPaint(paint);
    const pixels = surface.getCanvas().readPixels(0, 0, {
      width: 240,
      height,
      colorType: kit.ColorType.RGBA_8888,
      alphaType: kit.AlphaType.Premul,
      colorSpace: kit.ColorSpace.SRGB,
    });
    if (!pixels) throw new Error('Skia failed to render the recording waveform');
    return Uint8Array.from(pixels);
  } finally {
    paint.delete();
    shader.delete();
    surface.delete();
  }
}

const silent = Array<number>(VOICE_METER_SAMPLES).fill(0);
const speech = silent.map((_, index) => (index === 12 ? 1 : 0));
const pixel = (pixels: Uint8Array, x: number, y: number) =>
  pixels.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 4);

test('the real Skia compiler accepts every declared waveform uniform', () => {
  expect(diagnostics).toEqual([]);
  expect(effect).not.toBeNull();
  expect(effect!.getUniformFloatCount()).toBe(36);
  expect(
    Array.from({ length: effect!.getUniformCount() }, (_, index) => effect!.getUniformName(index))
  ).toEqual([
    'size',
    'time',
    'motion',
    'processing',
    'amplitudes',
    'tint',
    'highlight',
    'tintOpacity',
  ]);
});

test('theme primary opacity scales every premultiplied channel, including zero', () => {
  for (const processing of [0, 1]) {
    const opaque = render(speech, 1, 1, undefined, processing);
    const translucent = render(speech, 1, 1, undefined, processing, 56, 0.3);
    const transparent = render(speech, 1, 1, undefined, processing, 56, 0);
    expect(transparent.every((channel) => channel === 0)).toBe(true);
    for (let offset = 0; offset < opaque.length; offset++) {
      expect(Math.abs(translucent[offset]! - opaque[offset]! * 0.3)).toBeLessThanOrEqual(1);
    }
  }
});

function verticalEnergy(pixels: Uint8Array, height = 56) {
  let energy = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < 240; x++)
      energy += pixel(pixels, x, y)[3]! * Math.abs(y + 0.5 - height / 2);
  return energy;
}

test('silence breathes gently and measured speech creates larger continuous waves', () => {
  const quiet = render(silent, 0);
  expect(quiet).not.toEqual(render(silent, 0.7));
  const loud = render(
    silent.map(() => 1),
    0
  );
  expect(verticalEnergy(loud)).toBeGreaterThan(verticalEnergy(quiet) * 3);
  for (let x = 8; x < 232; x++) {
    let visible = false;
    for (let y = 24; y <= 32; y++) visible ||= pixel(quiet, x, y)[3]! > 5;
    expect(visible).toBe(true);
  }
});

test('reduced motion freezes both recording and processing when time changes', () => {
  for (const processing of [0, 0.5, 1])
    expect(render(speech, 0, 0, undefined, processing)).toEqual(
      render(speech, 2, 0, undefined, processing)
    );
});

test('processing contracts into a centered transparent orbit at both supported heights', () => {
  for (const height of [24, 56]) {
    const pixels = render(speech, 0.7, 1, undefined, 1, height);
    let left = 240,
      right = 0,
      top = height,
      bottom = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < 240; x++) {
        if (pixel(pixels, x, y)[3]! < 5) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    expect(Math.abs((left + right + 1) / 2 - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs((top + bottom + 1) / 2 - height / 2)).toBeLessThanOrEqual(1);
    expect(right - left).toBeLessThan(30);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(height - 1);
    expect(pixel(pixels, 120, Math.floor(height / 2))[3]).toBe(0);
    expect(pixels).not.toEqual(render(speech, 1.4, 1, undefined, 1, height));
  }
});

test('theme color and premultiplied transparency remain intact through the morph', () => {
  for (const processing of [0, 0.5, 1]) {
    const pixels = render(
      silent.map(() => 1),
      2,
      1,
      [0.8, 0.1, 0.2],
      processing
    );
    let colored = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3]!;
      expect(pixels[offset]).toBeLessThanOrEqual(alpha);
      expect(pixels[offset + 1]).toBeLessThanOrEqual(alpha);
      expect(pixels[offset + 2]).toBeLessThanOrEqual(alpha);
      if (alpha > 20) {
        expect(pixels[offset]).toBeGreaterThan(pixels[offset + 2]!);
        colored++;
      }
    }
    expect(colored).toBeGreaterThan(10);
    expect(pixel(pixels, 120, 0)[3]).toBe(0);
    expect(pixel(pixels, 0, 28)[3]).toBe(0);
  }
});

test('compact and normal waves preserve light and dark theme ink without painting a plate', () => {
  for (const height of [24, 56]) {
    for (const tint of [
      [0.08, 0.3, 0.6],
      [0.65, 0.8, 0.95],
    ]) {
      const pixels = render(
        silent.map(() => 0.8),
        1.4,
        1,
        tint,
        0,
        height
      );
      let painted = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3]! > 30) {
          expect(pixels[offset + 2]).toBeGreaterThan(pixels[offset]!);
          painted++;
        }
      }
      expect(painted).toBeGreaterThan(200);
      expect(painted).toBeLessThan((240 * height) / 2);
      for (let x = 0; x < 240; x++) {
        expect(pixel(pixels, x, 0)[3]).toBe(0);
        expect(pixel(pixels, x, height - 1)[3]).toBe(0);
      }
    }
  }
});

// Execute the production component's effect with isolated native/hook boundaries.
// This verifies subscription and frame ownership without globally mocking RN.
function mountWaveform(reduced: boolean, compiled: boolean) {
  const cleanups: (() => void)[] = [];
  const activity: boolean[] = [];
  let listener: ((state: string) => void) | undefined;
  let removed = false;
  let frames = 0;
  let tick:
    | ((frame: { timeSinceFirstFrame: number; timeSincePreviousFrame: number | null }) => void)
    | undefined;
  let readUniforms: (() => { time: number }) | undefined;
  const { transformSync } = nodeRequire('@babel/core') as {
    transformSync: (source: string, options: Record<string, unknown>) => { code: string };
  };
  const source = readFileSync(
    new URL('../../components/voice-recording-waveform.tsx', import.meta.url),
    'utf8'
  );
  const code = transformSync(source, {
    filename: 'voice-recording-waveform.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }).code;
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name.startsWith('@babel/runtime/')) return nodeRequire(name);
      if (name === 'react/jsx-runtime') return nodeRequire(name);
      if (name === 'react')
        return {
          useEffect: (effect: () => () => void) => {
            const cleanup = effect();
            if (cleanup) cleanups.push(cleanup);
          },
        };
      if (name === '@osuki-dev/ui')
        return { useThemeTokens: () => ({ colors: { primary: '#3366cc' } }) };
      if (name === 'react-native')
        return {
          View: 'View',
          StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
          AppState: {
            currentState: 'active',
            addEventListener: (_name: string, callback: (state: string) => void) => {
              listener = callback;
              return {
                remove: () => {
                  removed = true;
                },
              };
            },
          },
        };
      if (name === 'react-native-skia')
        return {
          Canvas: 'Canvas',
          Fill: 'Fill',
          Shader: 'Shader',
          Skia: {
            RuntimeEffect: { Make: () => (compiled ? {} : null) },
            Color: () => new Float32Array([0.1, 0.4, 0.8, 1]),
          },
        };
      if (name === 'react-native-reanimated')
        return {
          __esModule: true,
          default: { View: 'AnimatedView' },
          useReducedMotion: () => reduced,
          withTiming: (value: number) => value,
          useSharedValue: (value: unknown) => ({
            get: () => value,
            set: (next: unknown) => {
              value = next;
            },
          }),
          useDerivedValue: (read: () => { time: number }) => {
            readUniforms = read;
            return { get: read };
          },
          useFrameCallback: (callback: typeof tick) => {
            frames++;
            tick = callback;
            return {
              setActive: (active: boolean) => {
                activity.push(active);
              },
            };
          },
        };
      if (name === '@/lib/voice-meter-history') return { VOICE_METER_SAMPLES };
      if (name === '@/lib/voice-waveform-shader') return { VOICE_WAVEFORM_SKSL };
      throw new Error(`Unexpected waveform dependency: ${name}`);
    },
  });
  const render = exports.VoiceRecordingWaveform as (props: unknown) => {
    props: { children: { type: (props: unknown) => unknown; props: unknown } };
  };
  const child = render({ history: { get: () => silent } }).props.children;
  if (typeof child.type === 'function') child.type(child.props);
  return {
    activity,
    frames,
    change: (state: string) => listener?.(state),
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
    removed: () => removed,
    tick: (elapsed: number, previous: number | null) => {
      if (activity.at(-1))
        tick?.({ timeSinceFirstFrame: elapsed, timeSincePreviousFrame: previous });
    },
    time: () => readUniforms?.().time,
  };
}

test('the production waveform pauses on background and owns no frame after unmount', () => {
  const mounted = mountWaveform(false, true);
  expect(mounted.frames).toBe(1);
  expect(mounted.activity).toEqual([true]);
  mounted.change('background');
  expect(mounted.activity.at(-1)).toBe(false);
  mounted.change('active');
  expect(mounted.activity.at(-1)).toBe(true);
  mounted.unmount();
  expect(mounted.activity.at(-1)).toBe(false);
  expect(mounted.removed()).toBe(true);
});

test('reduced motion never starts a frame; shader failure mounts only native bars', () => {
  const reduced = mountWaveform(true, true);
  reduced.change('background');
  reduced.change('active');
  expect(reduced.activity.every((active) => !active)).toBe(true);
  reduced.unmount();
  const fallback = mountWaveform(false, false);
  expect(fallback.frames).toBe(0);
  expect(fallback.activity).toEqual([]);
  fallback.unmount();
});

test('the production clock resumes immediately when Reanimated resets elapsed frame time', () => {
  const mounted = mountWaveform(false, true);
  mounted.tick(0, null);
  mounted.tick(5000, 16);
  expect(mounted.time()).toBe(5);
  mounted.change('background');
  mounted.change('active');
  // FrameCallbackRegistryUI resets startTime on deactivate and delivers these
  // values on every reactivation, including after reduced motion is disabled.
  mounted.tick(0, null);
  expect(mounted.time()).toBe(0);
  mounted.tick(16, 16);
  expect(mounted.time()).toBe(0); // Still throttles updates to at most 30 fps.
  mounted.tick(100, 16);
  expect(mounted.time()).toBe(0.1);
  mounted.unmount();
});
