import * as Font from 'expo-font';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import {
  UIManager,
  type ColorValue,
  type ViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { createNanoIconSet } from 'react-native-nano-icons';

import glyphMap from '../../assets/glyphs-generated/muqun.glyphmap.json';
import { iconFont } from './font.generated';
import { flattenStyle } from '@/lib/flatten-style';

type WithoutVariant<T> = T extends `${infer Name}--${string}` ? Name : never;
export type AppIconName = WithoutVariant<keyof typeof glyphMap.i>;
export interface AppIconProps extends Pick<
  ViewProps,
  | 'accessible'
  | 'accessibilityLabel'
  | 'accessibilityRole'
  | 'accessibilityElementsHidden'
  | 'importantForAccessibility'
  | 'testID'
> {
  size?: number;
  color?: ColorValue;
  strokeWidth?: number;
  fill?: ColorValue;
  style?: StyleProp<ViewStyle>;
}
export type AppIconComponent = ComponentType<AppIconProps>;

const nativeNanoAvailable = UIManager.hasViewManagerConfig('NanoIconView');
// Existing binaries use Nano's explicit-font Text fallback. Newly built binaries
// register the same OTA asset through Nano's native loader and use NanoIconView.
const NanoIcon = nativeNanoAvailable
  ? createNanoIconSet(glyphMap, iconFont)
  : createNanoIconSet({ ...glyphMap, m: { ...glyphMap.m, l: 's' } });
let registration: Promise<Error | null> | undefined;
function loadIconFont() {
  if (registration) return registration;
  // Nano's auto-load coalesces callers onto a promise which absorbs errors.
  // Once it settles, an explicit idempotent registration reports failure to
  // our startup gate instead of exposing blank native glyphs.
  const work = nativeNanoAvailable
    ? NanoIcon.loadFont().then(() => NanoIcon.loadFont())
    : Font.loadAsync({ [glyphMap.m.f]: iconFont });
  registration = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Icon font registration timed out.')), 10000);
    void work.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (reason: unknown) => {
        clearTimeout(timeout);
        reject(reason);
      }
    );
  }).then(
    () => null,
    (reason: unknown) => {
      registration = undefined;
      return reason instanceof Error ? reason : new Error(String(reason));
    }
  );
  return registration;
}
// Start early, with rejection handled immediately, before React mounts the gate.
void loadIconFont();

function useAppIconsReady() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    void loadIconFont().then((problem) => {
      if (!active) return;
      if (problem) setError(problem);
      else setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  if (error) throw error;
  return ready;
}

export function AppIconsReady({ children }: { children: ReactNode }) {
  return useAppIconsReady() ? children : null;
}

export const APP_ICON_STROKE_WIDTH = 1;

/** App-owned icon boundary; font family/weight never inherit UI typography. */
export function AppIcon({
  name,
  size = 24,
  color = '#000000',
  strokeWidth = APP_ICON_STROKE_WIDTH,
  fill,
  style,
  accessible = false,
  accessibilityLabel,
  accessibilityElementsHidden = !accessible,
  importantForAccessibility = accessible ? 'auto' : 'no-hide-descendants',
  ...accessibility
}: AppIconProps & { name: AppIconName }) {
  const filled =
    (name === 'stop' || name === 'shift') &&
    fill != null &&
    fill !== 'none' &&
    fill !== 'transparent';
  const widths = [0.5, 1, 1.5, 1.8, 2, 2.2, 2.4, 2.5, 2.6, 3];
  const requestedWidth = Number.isFinite(strokeWidth) ? strokeWidth : APP_ICON_STROKE_WIDTH;
  const width = widths.reduce(
    (nearest, candidate) =>
      Math.abs(candidate - requestedWidth) < Math.abs(nearest - requestedWidth)
        ? candidate
        : nearest,
    2
  );
  const variant = filled ? 'filled' : String(width).replace('.', '_');
  const glyphName = `${name}--${variant}`;
  if (!(glyphName in glyphMap.i)) throw new Error(`Unbuilt Muqun icon variant: ${glyphName}`);
  return (
    <NanoIcon
      // Nano 1.0.1's custom memo comparator omits accessibility props. Remount
      // only when these semantics change, so assistive technology stays fresh.
      key={JSON.stringify([
        accessible,
        accessibilityLabel,
        accessibilityElementsHidden,
        importantForAccessibility,
        accessibility,
      ])}
      name={glyphName as keyof typeof glyphMap.i}
      size={size}
      color={filled ? fill : color}
      allowFontScaling={false}
      accessible={accessible}
      // Upstream otherwise defaults the label to its internal variant name,
      // which Android may merge into an ancestor even for a hidden glyph.
      accessibilityLabel={accessible ? accessibilityLabel : ''}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility={importantForAccessibility}
      style={flattenStyle(style)}
      {...accessibility}
    />
  );
}
