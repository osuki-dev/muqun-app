import { afterAll, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import CanvasKitInit from 'canvaskit-wasm';
import { measuredUpdateProgress, UPDATE_PROGRESS_SKSL } from '../update-progress-shader';

const require = createRequire(import.meta.url);
const kit = await CanvasKitInit({
  locateFile: (file) => join(dirname(require.resolve('canvaskit-wasm')), file),
});
const diagnostics: string[] = [];
const effect = kit.RuntimeEffect.Make(UPDATE_PROGRESS_SKSL, (message) => diagnostics.push(message));
afterAll(() => effect?.delete());

function render(progress: number, time: number) {
  if (!effect) throw new Error(diagnostics.join('\n'));
  const surface = kit.MakeSurface(100, 10)!;
  const shader = effect.makeShader([100, 10, progress, time, 0.2, 0.4, 0.8]);
  const paint = new kit.Paint();
  try {
    paint.setShader(shader);
    surface.getCanvas().clear(kit.TRANSPARENT);
    surface.getCanvas().drawPaint(paint);
    return Uint8Array.from(
      surface.getCanvas().readPixels(0, 0, {
        width: 100,
        height: 10,
        colorType: kit.ColorType.RGBA_8888,
        alphaType: kit.AlphaType.Premul,
        colorSpace: kit.ColorSpace.SRGB,
      })!
    );
  } finally {
    paint.delete();
    shader.delete();
    surface.delete();
  }
}

test('shader compiles and time changes light without advancing downloaded pixels', () => {
  expect(diagnostics).toEqual([]);
  expect(effect).not.toBeNull();
  const first = render(0.4, 0);
  const later = render(0.4, 2);
  expect(first).not.toEqual(later);
  for (let y = 0; y < 10; y++) {
    for (let x = 40; x < 100; x++) {
      expect(first[(y * 100 + x) * 4 + 3]).toBe(0);
      expect(later[(y * 100 + x) * 4 + 3]).toBe(0);
    }
  }
  expect(render(0, 2).some((value) => value !== 0)).toBe(false);
  expect(render(1, 2)[(5 * 100 + 99) * 4 + 3]).toBeGreaterThan(0);
});

test('invalid native samples stay zero, and bounds never invent a percentage', () => {
  expect([NaN, Infinity, -1, 0, 0.42, 1, 2].map(measuredUpdateProgress)).toEqual([
    0, 0, 0, 0, 0.42, 1, 1,
  ]);
});

// Evaluate the production component with isolated native/hook boundaries. The
// returned tree reveals whether the GPU-owning child exists at all; its actual
// effect cleanup is then exercised rather than duplicating the lifecycle rule.
function progressFixture(reduced = false, compiled = true) {
  const effects: (() => (() => void) | void)[] = [];
  let active = true;
  let listener: ((state: string) => void) | undefined;
  const frameActivity: boolean[] = [];
  const { transformSync } = require('@babel/core') as {
    transformSync: (source: string, options: object) => { code: string };
  };
  const source = readFileSync(
    new URL('../../components/update-download-progress.tsx', import.meta.url),
    'utf8'
  );
  const code = transformSync(source, {
    filename: 'update-download-progress.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }).code;
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime' || name.startsWith('@babel/runtime/')) return require(name);
      if (name === 'react')
        return {
          useEffect: (effect: () => (() => void) | void) => effects.push(effect),
          useState: () => [
            active,
            (next: boolean) => {
              active = next;
            },
          ],
        };
      if (name === '@osuki-dev/ui')
        return {
          useThemeTokens: () => ({ colors: { primary: '#3366cc', primarySubtle: '#ddddff' } }),
        };
      if (name === 'react-native')
        return {
          View: 'View',
          StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
          AppState: {
            currentState: 'active',
            addEventListener: (_event: string, next: (state: string) => void) => {
              listener = next;
              return {
                remove: () => {
                  listener = undefined;
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
            Color: () => [0.2, 0.4, 0.8, 1],
          },
        };
      if (name === 'react-native-reanimated')
        return {
          useReducedMotion: () => reduced,
          useSharedValue: (initial: unknown) => {
            let value = initial;
            return {
              get: () => value,
              set: (next: unknown) => {
                value = next;
              },
            };
          },
          useDerivedValue: (read: () => unknown) => ({ get: read }),
          useFrameCallback: () => ({ setActive: (next: boolean) => frameActivity.push(next) }),
          withTiming: (value: number) => value,
        };
      if (name === '@/lib/motion') return { timing: () => ({}) };
      if (name === '@/lib/update-progress-shader')
        return { measuredUpdateProgress, UPDATE_PROGRESS_SKSL };
      throw new Error(name);
    },
  });
  type Element = { type: unknown; props: { children?: Element[] } };
  const render = exports.UpdateDownloadProgress as (props: {
    value: number;
    downloading: boolean;
  }) => Element;
  const gpu = (downloading: boolean) => {
    const tree = render({ value: 0.4, downloading });
    return tree.props.children?.find((child) => child && typeof child.type === 'function');
  };
  return {
    gpu,
    frameActivity,
    flush: () => effects.splice(0).map((effect) => effect()),
    background: () => listener?.('background'),
    hasListener: () => listener !== undefined,
  };
}

test('production progress unmounts its GPU child for ready, background and reduced motion', () => {
  const scope = progressFixture();
  const child = scope.gpu(true)!;
  const ownerCleanup = scope.flush();
  expect(child).toBeDefined();
  (child.type as (props: unknown) => unknown)(child.props);
  const gpuCleanup = scope.flush();
  expect(scope.frameActivity).toEqual([true]);
  scope.background();
  expect(scope.gpu(true)).toBeUndefined();
  gpuCleanup.forEach((cleanup) => cleanup?.());
  expect(scope.frameActivity).toEqual([true, false]);
  ownerCleanup.forEach((cleanup) => cleanup?.());
  expect(scope.hasListener()).toBe(false);
  expect(progressFixture().gpu(false)).toBeUndefined();
  expect(progressFixture(true).gpu(true)).toBeUndefined();
  expect(progressFixture(false, false).gpu(true)).toBeUndefined();
});
