import { SheetHandle } from '@/components/sheet-route-frame';
import { SheetHeading } from '@/components/sheet-heading';
/**
 * The frame the two Appearance pickers share.
 *
 * Card #683 took the theme pack and the language off the settings page. Both
 * are decided once per install, both need more room than a row, and both were
 * paying for that room on every visit to a page that is otherwise switches --
 * so they became rows that name the current answer, and this is the surface the
 * question moved to.
 *
 * The chrome is the panels sheet's, deliberately: a form sheet with a title, a
 * line saying what the choice means, and one `sheet`-faced glass button to
 * close it. There are two sheets in this app already and a third that looked
 * like neither would read as a different app's screen.
 *
 * `ScrollScreen` is the root with nothing wrapped around it, which is not a
 * style choice: react-native-screens lays a form sheet out specially when its
 * content is a scroll view and warns "FormSheet with ScrollView expects at most
 * 2 subviews" the moment anything shares the container -- after which the sheet
 * renders empty.
 */
import { ScrollScreen, useThemeTokens } from '@osuki-dev/ui';
import { X } from 'lucide-react-native';
import { createElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { FullscreenSettingsSheet } from '@/components/fullscreen-settings-sheet';

import { GlassChrome } from '@/components/glass-chrome';
import { SheetFrame, useSheetGroundProvided } from '@/components/sheet-ground';
import { PressableScale } from '@/components/pressable-scale';
import { LADDER } from '@/components/settings-chrome';
import { useRenderTally } from '@/lib/render-tally';

/** Keeps sheet choices scannable when Android presents the route full-screen. */
const SETTINGS_SHEET_CONTENT_MAX_WIDTH = 640;

export function SettingsSheet({
  title,
  caption,
  closeLabel,
  onClose,
  contentMaxWidth = SETTINGS_SHEET_CONTENT_MAX_WIDTH,
  children,
}: {
  title: string;
  /** What the choice means -- the same sentence the page's row carries. */
  caption: string;
  closeLabel: string;
  onClose: () => void;
  /** Lets dense grids use the Pad canvas while list-based sheets stay narrow. */
  contentMaxWidth?: number;
  children: ReactNode;
}) {
  const theme = useThemeTokens();
  const groundProvided = useSheetGroundProvided();
  // Explicit: this is the component that renders the frame, so it sits above
  // its own tint provider. Everything *inside* the sheet reads the tint from
  // the frame and calls this with no argument.
  useRenderTally('SettingsSheet');
  const header = (
    <View style={styles.header}>
      {/* The title and the line under it are the only text on this sheet
              that is not already on a card, so over a wallpaper they take the
              plate the settings page gives its section labels. */}
      <SheetHeading title={title} caption={caption} />
      <GlassChrome face="sheet" style={styles.closeButton}>
        <PressableScale accessibilityLabel={closeLabel} onPress={onClose} style={styles.closeHit}>
          <X size={18} color={theme.colors.text} />
        </PressableScale>
      </GlassChrome>
    </View>
  );
  if (groundProvided) {
    // FullscreenSheetFrame owns the safe edges. Keep the close control outside
    // the scroll viewport so bounce and automatic insets cannot move it into
    // the status bar, or let content pass over it.
    return createElement(
      FullscreenSettingsSheet,
      {
        header,
        contentStyle: [styles.content, { maxWidth: contentMaxWidth }],
      },
      children
    );
  }
  return (
    <ScrollScreen
      variant="surface"
      safeArea="bottom"
      style={[
        styles.sheet,
        { backgroundColor: theme.colors.background },
        groundProvided && { backgroundColor: 'transparent' },
      ]}
      contentContainerStyle={styles.canvas}>
      {/* A sheet is a new scene, not a transparent window onto the previous
          route's labels. The native scroll root keeps its opaque floor; the
          ground above it carries the shell's wallpaper, and the tint under
          that wallpaper is the one layer the opacity slider moves. */}
      <SheetFrame testID="settings-sheet-scene">
        <View collapsable={false} style={[styles.content, { maxWidth: contentMaxWidth }]}>
          {/* iOS draws the grabber itself; Android's form sheet does not, and a
          sheet with no handle reads as a screen that arrived from the wrong
          direction. The panels sheet carries the same two lines. */}
          <SheetHandle style={styles.handle} />

          {header}

          {children}
        </View>
      </SheetFrame>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  // `flex: 1`, not `height: '100%'`: inside a native form sheet the container's
  // height is not resolved when a percentage is measured and the sheet renders
  // empty. Every other sheet in this app fills the same way.
  sheet: { flex: 1 },
  canvas: { flexGrow: 1, width: '100%' },
  content: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap,
    // One gutter, not the page's `section + gutter`. `safeArea="bottom"` adds
    // the home indicator's own inset underneath this, and the sheet is sized to
    // its contents -- so anything more here is dead height the sheet then grows
    // to include.
    paddingBottom: LADDER.gutter,
    gap: LADDER.gutter,
  },
  handle: {
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: LADDER.tight / 2 },
  // The panels sheet's title size, so the two sheets agree on how a sheet
  // announces itself.
  title: { fontSize: 20, lineHeight: 25, includeFontPadding: false },
  // The shape only; the fill is the glass chrome's.
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
