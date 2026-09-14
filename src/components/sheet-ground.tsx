/**
 * The ground a form sheet stands on: the shell's own wallpaper, under a sheet.
 *
 * Every form sheet in this app is presented over a transparent route
 * (`contentStyle: { backgroundColor: 'transparent' }` in `src/app/_layout.tsx`,
 * so the native sheet keeps its corners), which means a sheet has to paint its
 * own floor or it is a window onto whatever route it was opened from. Three
 * layers, and the order is the whole point:
 *
 * 1. **The floor.** `colors.background`, opaque, always. A sheet is a new
 *    scene, and the reader's opacity slider is about the theme's own surfaces,
 *    not about dissolving the sheet into the screen behind it.
 * 2. **The tint.** `surfaceBackground(...)` -- the one layer that reads the
 *    slider, so lowering it reveals the theme's background colour rather than
 *    the previous route.
 * 3. **The wallpaper**, `shell.background`, at the strength the pack asked for.
 *
 * The bug this component exists to end is that 2 and 3 were the other way
 * round. `settings-sheet.tsx` and the two sheets that copied it painted the
 * picture first and the tint over it, and `surfaceBackgroundFill` returns the
 * colour unchanged at alpha 1 -- which is the default and what every reader who
 * has never touched the slider has. So the sheets mounted a full-screen
 * `ThemeArtwork`, decoded the pack's wallpaper, and drew an opaque rectangle on
 * top of it. The picture was only ever visible to a reader who had turned the
 * slider down, and the maintainer who reported "sheets have no artwork" was
 * looking at the default.
 *
 * Note what this deliberately does *not* use. `ThemedSurfaceArtwork` clamps
 * artwork to `safeArtworkOpacity`, which asks "at what alpha does every one of
 * this theme's inks still clear 4.5:1 over this surface" -- and for real
 * palettes the answer is ~0 (measured: tokyo-night 0.000, github light 0.000,
 * gruvbox 0.038), because `textSubtle` and `primary` are already near their
 * floor against a bare surface. That clamp is right for a button or a tab
 * strip, where the pack opted a small chrome surface into a picture. It is not
 * how the shell draws its wallpaper, and a sheet that used it would show
 * nothing, which is the defect rather than the fix. The shell's answer -- the
 * one `SettingsSection` and the SSH status line already use -- is the picture
 * at full strength plus a plate under any text that would otherwise sit on it.
 * That is `useSheetGroundPlate` below.
 */
import { useThemeTokens } from '@osuki-dev/ui';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemeArtwork, useHasThemeArtwork } from '@/components/theme-artwork';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

/**
 * Which token the sheet's tint is mixed from.
 *
 * `surface` for a sheet whose content sits on cards and rows -- the sheet reads
 * as a raised surface. `background` for a sheet whose blocks each draw their
 * own panel (the commands sheet), where a second surface under those panels is
 * one surface too many.
 */
export type SheetGroundTint = 'surface' | 'background';

export function SheetGround({
  testID,
  tint = 'surface',
}: {
  /** Kept so existing flows can still find the scene they already anchor on. */
  testID?: string;
  tint?: SheetGroundTint;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]} />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: surfaceBackground(sheetGroundTintColor(theme.colors, tint)) },
        ]}
      />
      <ThemeArtwork slot="shell.background" />
    </View>
  );
}

/**
 * Exactly the six properties a plate sets, and no wider.
 *
 * Neither `ViewStyle` nor `TextStyle` would do: React Native's two style types
 * disagree on `cursor` and `userSelect`, so neither is assignable to the other
 * and a plate typed as one needs a cast at every call site that is the other.
 * A plate goes on a `View` (a header column) and on a `Text` (a day heading),
 * so it is typed as what it actually is.
 */
export type SheetGroundPlate = {
  alignSelf?: 'flex-start';
  backgroundColor?: string;
  borderRadius?: number;
  borderCurve?: 'continuous';
  paddingHorizontal?: number;
  paddingVertical?: number;
};

/**
 * The frame every form sheet is built in: the ground, then the sheet's content.
 *
 * Two children and no more, which is the arrangement react-native-screens lays
 * a form sheet out in -- it warns "FormSheet with ScrollView expects at most 2
 * subviews" and then renders the sheet empty. The ground is one of them and
 * costs no layout, because it is absolutely positioned: the scroller is still
 * the only thing the sheet measures, which is what `fitToContents` needs.
 *
 * Sheets differ in where that pair sits. A sheet whose root is the scroller
 * itself (`SettingsSheet`, the two keyboard forms) puts the frame *inside* the
 * scroll view, over a content container with no padding of its own, so the
 * ground reaches the sheet's edges rather than stopping at the form's gutter. A
 * sheet with a pinned header (the catalogue, the files list, the patch) puts
 * the frame at its root and its header and list inside one column. Both shapes
 * are already shipping; what they now share is this component, so the ground is
 * changed in one place for all of them.
 */
export function SheetFrame({
  testID,
  tint,
  children,
}: {
  testID?: string;
  tint?: SheetGroundTint;
  children: ReactNode;
}) {
  return (
    <>
      <SheetGround testID={testID} tint={tint} />
      {children}
    </>
  );
}

/** Frozen and shared, so a plateless render commits the same object every time. */
const EMPTY_PLATE: SheetGroundPlate = Object.freeze({});

/** Split out so the tint a sheet paints and the plate its labels get agree. */
function sheetGroundTintColor(
  colors: { surface: string; background: string },
  tint: SheetGroundTint
): string {
  return tint === 'background' ? colors.background : colors.surface;
}

/**
 * The plate for text drawn straight onto the ground, or nothing where there is
 * no picture to protect it from.
 *
 *
 * Same idea, same shape and the same reason as `SettingsSection`'s label on the
 * settings page: `textMuted` is proven against the theme's surfaces and never
 * against an author's photograph, so a caption over a wallpaper needs a surface
 * of its own. An empty object rather than a transparent fill or a null, which
 * is what `SettingsSection` returns for the same question: a theme with no
 * `shell.background` keeps exactly the padding and spacing it has today, and
 * the result drops straight into a `Text`'s style array, whose members the kit
 * types as styles rather than as styles-or-nothing.
 */
export function useSheetGroundPlate(tint: SheetGroundTint = 'surface'): SheetGroundPlate {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const hasShell = useHasThemeArtwork('shell.background');
  if (!hasShell) return EMPTY_PLATE;
  return {
    // Shrink-to-fit on the cross axis, so a plate beside a 44pt close button is
    // as tall as its own two lines rather than as tall as the button.
    alignSelf: 'flex-start',
    backgroundColor: surfaceBackground(sheetGroundTintColor(theme.colors, tint)),
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
    paddingVertical: 6,
  };
}
