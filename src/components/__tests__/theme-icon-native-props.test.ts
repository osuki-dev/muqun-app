import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { themeIconRotation } from '../../theme/icon-direction';
import { isRenderableThemeAsset } from '../../theme/renderable-asset';
import type { ThemeIconDirection } from '../../theme/schema';

const require = createRequire(import.meta.url);

/** Load the installed native prop processors without starting React Native. */
function load(filename: string, mocks: Record<string, unknown> = {}): Record<string, unknown> {
  const exports = {};
  const code = require('@babel/core').transformSync(readFileSync(filename, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }).code;
  runInNewContext(code, {
    exports,
    __DEV__: true,
    require: (name: string) =>
      mocks[name] ??
      (name.startsWith('.') ? load(join(dirname(filename), `${name}.js`)) : require(name)),
  });
  return exports;
}

const nativeRoot = dirname(require.resolve('react-native/package.json'));
const processTransform = load(join(nativeRoot, 'Libraries/StyleSheet/processTransform.js'))
  .default as (value: unknown) => unknown;
const payload = load(
  join(nativeRoot, 'Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload.js')
) as { diff: (before: object, after: object, attributes: object) => Record<string, unknown> };

type IconElement = { type: unknown; props: { style: object } };
function icon(source: ThemeIconDirection | undefined, target?: ThemeIconDirection): IconElement {
  const component = load('src/components/theme-icon.tsx', {
    react: { useState: () => [null, () => {}] },
    'expo-image': { Image: 'ExpoImage' },
    '@/components/theme-candidate': {
      useEffectiveCustomTheme: () => ({
        theme: {
          manifest: {
            icons: { 'home.arrow': { asset: 'arrow', render: 'template' } },
            iconDirections: { 'home.arrow': source },
          },
        },
        assets: { arrow: 'file:///theme/arrow.png' },
      }),
    },
    '@/theme/icon-direction': { themeIconRotation },
    '@/theme/renderable-asset': { isRenderableThemeAsset },
  }).ThemeIcon as (props: object) => IconElement;
  return component({
    name: 'home.arrow',
    fallback: 'Fallback',
    size: 16,
    color: '#123456',
    direction: target,
  });
}

test('rotated theme icons reset to identity through the native image prop diff without null transforms', () => {
  const before = icon('up-right', 'down');
  const after = icon('up-right', 'up-right');
  expect(before.type).toBe('ExpoImage');
  expect(after.type).toBe('ExpoImage');
  // ExpoImage forwards flattened style both as top-level props and as style.
  const nativeProps = (element: IconElement) => ({
    ...element.props.style,
    style: element.props.style,
  });
  const update = payload.diff(nativeProps(before), nativeProps(after), {
    transform: { process: (value: unknown) => value },
    style: { width: true, height: true, transform: { process: processTransform } },
  });
  expect(update.transform).toEqual([{ rotate: '0deg' }]);
  expect(processTransform(update.transform)).toEqual([{ rotate: '0deg' }]);
});

test('unoriented images use identity while unknown directions keep the native glyph fallback', () => {
  expect(icon(undefined).props.style).toMatchObject({ transform: [{ rotate: '0deg' }] });
  expect(icon(undefined, 'down').type).toBe('Fallback');
});
