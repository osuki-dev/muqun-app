import { MessagesSquare, SquareTerminal, TextAlignStart } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useLingui } from '@lingui/react';

import { PressableScale } from '@/components/pressable-scale';
import { paneViewModeFallback, switchToViewLabel } from '@/i18n/labels';
import { nextPaneViewMode, type PaneViewMode } from '@/lib/pane-view-mode';

/**
 * The pane header's view control: one button that cycles the readings this pane
 * can show.
 *
 * One button, because the header has room for exactly one -- back, title,
 * accessory and panels already fill the row, and a second circle here pushed
 * the title pill past what it can shrink to. The chat view's own fold control
 * therefore lives inside the chat view, next to what it folds.
 *
 * The glyph names the mode currently on screen, not the one the button leads
 * to. Either convention can be argued for; this one keeps the header honest
 * about what is being looked at, and the label says where the press goes.
 */
export const PaneViewModeControl = memo(function PaneViewModeControl({
  mode,
  available,
  canCycle,
  color,
  warningColor,
  warningBorderColor,
  degraded = false,
  onCycle,
}: {
  mode: PaneViewMode;
  available: readonly PaneViewMode[];
  canCycle: boolean;
  color: string;
  warningColor: string;
  warningBorderColor: string;
  /** The chosen view could not be drawn, and something else is showing. */
  degraded?: boolean;
  onCycle: () => void;
}) {
  // The runtime `_` rather than a plain function returning a string: React
  // Compiler is enabled, and it would memoize a bare `t` call on `mode` alone
  // and never notice the language changed underneath it. `_` comes from the
  // Lingui context, which the compiler can see change.
  const { _ } = useLingui();
  if (!canCycle) return null;
  const ModeIcon = MODE_ICONS[mode];

  return (
    <PressableScale
      accessibilityLabel={_(
        switchToViewLabel[paneViewModeFallback(nextPaneViewMode(mode, available))]
      )}
      onPress={onCycle}
      style={styles.button}>
      <ModeIcon size={18} color={color} strokeWidth={2} />
      {degraded ? (
        // The view the user asked for could not be read, and something else is
        // showing instead. Small, because nothing is broken.
        <View
          style={[
            styles.warning,
            { backgroundColor: warningColor, borderColor: warningBorderColor },
          ]}
        />
      ) : null}
    </PressableScale>
  );
});

const MODE_ICONS: Record<PaneViewMode, typeof SquareTerminal> = {
  chat: MessagesSquare,
  text: TextAlignStart,
  terminal: SquareTerminal,
};

const styles = StyleSheet.create({
  // Fills the header's glass circle, which is what sizes it.
  button: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warning: {
    position: 'absolute',
    top: 11,
    right: 11,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
  },
});
