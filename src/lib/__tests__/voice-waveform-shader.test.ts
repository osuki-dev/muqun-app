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

function render(samples: number[], time = 0, motion = 1, tint = [0.1, 0.4, 0.8]) {
  if (!effect) throw new Error(diagnostics.join('\n'));
  const surface = kit.MakeSurface(240, 20)!;
  const shader = effect.makeShader([
    240,
    20,
    time,
    motion,
    ...samples,
    ...tint,
    ...tint.map((x) => x * 0.65 + 0.35),
  ]);
  const paint = new kit.Paint();
  try {
    paint.setShader(shader);
    surface.getCanvas().clear(kit.TRANSPARENT);
    surface.getCanvas().drawPaint(paint);
    const pixels = surface.getCanvas().readPixels(0, 0, {
      width: 240,
      height: 20,
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
  expect(effect!.getUniformFloatCount()).toBe(34);
  expect(
    Array.from({ length: effect!.getUniformCount() }, (_, index) => effect!.getUniformName(index))
  ).toEqual(['size', 'time', 'motion', 'amplitudes', 'tint', 'highlight']);
});

test('only measured speech increases bar height; silence glints without tall peaks', () => {
  const quiet = render(silent, 2);
  const loud = render(speech, 2);
  expect(pixel(loud, 125, 3)[3]).toBeGreaterThan(pixel(quiet, 125, 3)[3]! + 50);
  expect(pixel(quiet, 125, 3)[3]).toBeLessThan(10);
  expect(pixel(quiet, 125, 10)[3]).toBeGreaterThan(pixel(render(silent), 125, 10)[3]!);
});

test('reduced motion freezes the light sweep even if clock time changes', () => {
  expect(render(speech, 0, 0)).toEqual(render(speech, 2, 0));
  expect(pixel(render(speech, 2, 0), 125, 3)[3]).toBeLessThan(10);
});

test('bloom preserves themed color and bounded premultiplied transparency', () => {
  const red = pixel(render(speech, 2, 1, [0.8, 0.1, 0.2]), 125, 10);
  const blue = pixel(render(speech, 2, 1, [0.1, 0.2, 0.8]), 125, 10);
  expect(red[0]).toBeGreaterThan(red[2]!);
  expect(blue[2]).toBeGreaterThan(blue[0]!);
  const pixels = render(speech, 2);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    expect(pixels[offset]).toBeLessThanOrEqual(pixels[offset + 3]!);
    expect(pixels[offset + 1]).toBeLessThanOrEqual(pixels[offset + 3]!);
    expect(pixels[offset + 2]).toBeLessThanOrEqual(pixels[offset + 3]!);
  }
  expect(pixel(pixels, 125, 0)[3]).toBeLessThan(10);
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
            cleanups.push(effect());
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
