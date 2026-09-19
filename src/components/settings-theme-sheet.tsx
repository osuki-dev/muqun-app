/**
 * The theme picker, on the one sheet every other picker in this app is on.
 *
 * It was a full-screen frame holding a measured grid of tiles, two to four
 * across, each tile a `surfaceRaised` card with the pack's name over both
 * halves of it. Two things were wrong with that. The frame had no way out --
 * the X circle went when the sheets were unified and a full-screen route has no
 * grabber to inherit instead, which is the defect the owner reported. And a
 * grid of cards is the card kit the sheet system exists to have stopped: four
 * radii, a second surface inside the sheet, and comparison by scrolling anyway
 * once the reader is past the first eight.
 *
 * So it is a form sheet of scene rows. A theme pack is a *pair* -- Latte and
 * Mocha, Dawn and Main, Day and Moon -- and the mode control on the settings
 * page decides which half the app is wearing, so both halves stay on every row:
 * the artwork keeps its own component (`ThemePreview`), right-aligned as the
 * row's meta, and the name is the row. Which one is on is the scene's left
 * rule, the same mark the agent timeline puts beside the reader's own messages.
 *
 * Each half is reduced to its canvas and three colour dots -- accent, link,
 * warning -- which is enough to tell two packs apart at a glance and comes from
 * `themeSwatch`, so a preview can never drift from the theme it advertises.
 */
import { useLingui } from '@lingui/react/macro';
import { useThemeMode } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import {
  THEME_PACKS,
  resolveThemePack,
  themeSwatch,
  themeVariant,
  type ThemePack,
  type ThemePackId,
} from '@/constants/theme-packs';
import { useRenderTally } from '@/lib/render-tally';
import { THEME_PICKER_MAX_CONTENT_WIDTH } from '@/lib/theme-picker-layout';
import { CustomThemeLibrary } from '@/components/custom-theme-library';
import { useThemeLibrary } from '@/stores/theme-library';
import { useThemePack } from '@/hooks/use-theme-pack';
import { useOpenThemeEditor } from '@/hooks/use-open-theme-editor';
import { useReskinTransition } from '@/components/reskin-transition';

/** The focused field's clearance above the keyboard: the import link's input. */
const KEYBOARD_BOTTOM_OFFSET = 88;

export function SettingsThemeSheet({ onClose }: { onClose: () => void }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- see the
  // note at the top of the settings screen for why.
  const { t } = useLingui();
  const openEditor = useOpenThemeEditor();
  const insets = useSafeAreaInsets();
  useRenderTally('SettingsThemeSheet');

  const themePack = useThemePack();
  const { resolvedMode } = useThemeMode();
  const reskin = useReskinTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Apply, then leave.
   *
   * The write goes in before the dismissal rather than after it, so the rule
   * has somewhere to travel to while the sheet is on its way out and the app
   * behind it is already repainted when it lands. Tapping the pack that is
   * already chosen writes nothing and still closes: in a sheet that is a
   * confirmation, not a no-op.
   */
  function choose(id: ThemePackId) {
    // The new pack's primary is resolved before it is applied -- the packs are
    // pure data, so a theme can be asked its colours without wearing them --
    // and it is what the wash's front is lit in. That light is the one moment
    // in the transition that tells the reader in colour what they just chose.
    void reskin.run({
      kind: 'theme',
      accent: themeVariant(resolveThemePack(id), resolvedMode).colors.primary,
      apply: () => {
        try {
          useThemeLibrary.getState().apply({ kind: 'builtin', id });
          onClose();
        } catch {
          setError(t`Could not save theme`);
        }
      },
    });
  }

  return (
    <SheetScene
      testID="settings-theme-sheet"
      title={t`Theme`}
      caption={t`Terminal colours follow the theme.`}>
      {/*
        Keyboard-aware because the library's link import puts a field inside
        this scroller, and `SheetSceneFooter` adds the keyboard's own height at
        the end so the last pack stays reachable while it is up.
      */}
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}>
        <View style={styles.column}>
          {/* `tabs`, and with it no caption of its own: the segmented control
              names the collection now, and a heading under the tab that repeats
              the word is the same word twice. */}
          <CustomThemeLibrary tabs onOpenCandidate={openEditor}>
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            <View testID="theme-picker-grid">
              {THEME_PACKS.map((pack) => (
                <ThemePackRow
                  key={pack.id}
                  pack={pack}
                  selected={pack.id === themePack.id}
                  onSelect={() => choose(pack.id)}
                />
              ))}
            </View>
          </CustomThemeLibrary>
        </View>
        <SheetSceneFooter bottomInset={insets.bottom} />
      </KeyboardAwareScrollView>
    </SheetScene>
  );
}

/**
 * One pack: its name, the rule that says it is on, and both halves of it.
 *
 * `accessibilityLabel` is the pack's own name and nothing else -- the two
 * swatches are decoration. The id carries the selection state because the
 * flows that drive this list match on it: a row's *role* reads differently on
 * the two runtimes, and a flow that names either one passes on one platform
 * and fails on the other.
 */
function ThemePackRow({
  pack,
  selected,
  onSelect,
}: {
  pack: ThemePack;
  selected: boolean;
  onSelect: () => void;
}) {
  useRenderTally('ThemePackRow');
  return (
    <SheetSceneRow
      title={pack.label}
      selected={selected}
      onPress={onSelect}
      accessibilityLabel={pack.label}
      testID={`settings-selection:${selected ? 'on' : 'off'}:theme-${pack.id}`}
      meta={
        <View style={styles.previews}>
          <ThemePreview pack={pack} mode="light" />
          <ThemePreview pack={pack} mode="dark" />
        </View>
      }
    />
  );
}

/**
 * Half a pack, drawn in itself: a fill-only window onto its theme, with the
 * three dots that separate two packs at a glance.
 */
const SWATCH_DOT_ROLES = ['primary', 'info', 'warning'] as const;

function ThemePreview({ pack, mode }: { pack: ThemePack; mode: 'light' | 'dark' }) {
  const swatch = themeSwatch(pack, mode);
  return (
    <View style={[styles.preview, { backgroundColor: swatch[0] }]}>
      <View style={styles.previewDots}>
        {swatch.slice(1).map((color, dotIndex) => (
          <View
            key={`${mode}-${SWATCH_DOT_ROLES[dotIndex] ?? dotIndex}`}
            style={[styles.previewDot, { backgroundColor: color }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The picker is the widest sheet in the app on a Pad, and rows that ran the
  // whole width of one would be a name at the left and a swatch pair a canvas
  // away from it.
  column: { width: '100%', maxWidth: THEME_PICKER_MAX_CONTENT_WIDTH, alignSelf: 'center' },
  previews: { flexDirection: 'row', gap: SHEET_LADDER.tight },
  preview: {
    width: 38,
    height: 24,
    borderRadius: 6,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewDots: { flexDirection: 'row', gap: 3 },
  previewDot: { width: 6, height: 6, borderRadius: 3 },
});
