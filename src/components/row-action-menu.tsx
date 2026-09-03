import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Pencil, Trash2, X } from 'lucide-react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { fadeIn, fadeOut, listLayout, timing } from '@/lib/motion';

/**
 * The one action menu used everywhere a row can be renamed or removed — home
 * server cards, workspaces, tabs, panes. Rename is an inline field the caller
 * opens; delete arms first (turns into a red "Delete") so the destructive tap
 * always takes two taps. Keeping it in one place means every row's actions in
 * the app look and behave identically.
 *
 * Arming is a widening, not a replacement (card #618). It used to be two
 * separate buttons swapped on one frame: a 36pt square became a labelled pill
 * instantly, and the Cancel button beside it teleported sideways to make room.
 * A destructive control that appears fully formed under a finger already on its
 * way down is the exact case where a beat of travel is worth having -- the
 * movement is what says "this is not the button you just pressed".
 *
 * So there is now one button throughout, and three things change about it
 * together on `short`:
 *
 *  * its width, via `layout` on the wrapper -- Reanimated animates the bounds
 *    change the new content causes, and the same builder on the row carries
 *    Cancel along with it instead of jumping it;
 *  * its fill, as an opacity ramp on a `danger` layer laid over the resting
 *    `dangerSubtle`;
 *  * its glyph, as two cross-faded copies.
 *
 * The last two are copies rather than an animated colour because neither a
 * Lucide icon's `color` prop nor the design system's `Text` leaves anything on
 * the UI thread to drive -- both resolve before a style ever reaches React
 * Native. `interpolateColor` is not an option for the fill either: the resting
 * layer would have to start from `transparent`, which Reanimated reads as
 * transparent *black*, and the midpoint of the ramp picks up a dark cast.
 */
export function RowActionMenu({
  label,
  onRename,
  onDelete,
  onCancel,
  deleteLabel,
  leading,
}: {
  label: string;
  onRename: () => void;
  onDelete: () => void;
  onCancel: () => void;
  deleteLabel?: string;
  /**
   * An action only some rows have, before the two every row has.
   *
   * A slot rather than another pair of props, because what belongs here is the
   * caller's own button with its own reason to exist or not -- the home card's
   * New Task, which is absent entirely for a gateway that cannot start one.
   * The menu does not have to know any of that; it only has to leave room.
   */
  leading?: ReactNode;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [armed, setArmed] = useState(false);
  // The default lives here rather than in the parameter list so the word is
  // in the active locale, not in the source one.
  const removeLabel = deleteLabel ?? t`Delete`;

  const armedValue = useSharedValue(0);
  useEffect(() => {
    armedValue.value = withTiming(armed ? 1 : 0, timing('short'));
  }, [armed, armedValue]);

  const armedFillStyle = useAnimatedStyle(() => ({ opacity: armedValue.value }));
  const restingGlyphStyle = useAnimatedStyle(() => ({ opacity: 1 - armedValue.value }));
  const armedGlyphStyle = useAnimatedStyle(() => ({ opacity: armedValue.value }));

  return (
    <Animated.View style={styles.menu} layout={listLayout('short')}>
      {/* Before rename, and furthest from the delete it must never be confused
          with. Rename and delete are about the row; this is about what the row
          points at, which is why it leads rather than joins the pair. */}
      {leading}
      <PressableScale
        accessibilityLabel={t`Rename ${label}`}
        onPress={onRename}
        style={[styles.button, styles.square, { backgroundColor: theme.colors.surfaceRaised }]}>
        <Pencil size={16} color={theme.colors.text} strokeWidth={2} />
      </PressableScale>
      {/* The wrapper, not the button, carries `layout`: `PressableScale` takes
          `PressableProps`, which has no room for a layout animation, and the
          bounds that need to travel are the ones the caller sees anyway. */}
      <Animated.View layout={listLayout('short')}>
        <PressableScale
          // No `toLowerCase()` composition: case is a language's business, and
          // the caller's word arrives already translated.
          accessibilityLabel={
            armed ? t`Confirm: ${removeLabel} ${label}` : t`${removeLabel}: ${label}`
          }
          feedback="selection"
          onPress={armed ? onDelete : () => setArmed(true)}
          style={[
            styles.button,
            armed ? styles.armed : styles.square,
            { backgroundColor: theme.colors.dangerSubtle },
          ]}>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              armedFillStyle,
              { backgroundColor: theme.colors.danger },
            ]}
          />
          <Animated.View style={styles.glyph}>
            <Animated.View style={[styles.glyphLayer, restingGlyphStyle]}>
              <Trash2 size={16} color={theme.colors.danger} strokeWidth={2} />
            </Animated.View>
            <Animated.View style={[styles.glyphLayer, armedGlyphStyle]}>
              <Trash2 size={16} color={theme.colors.onPrimary} strokeWidth={2} />
            </Animated.View>
          </Animated.View>
          {/* The word arrives and leaves inside a button already on its way to
              the width that holds it, so `overflow: hidden` above is what stops
              it spilling out of the shrinking pill on the way back. */}
          {armed ? (
            <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')}>
              <Text variant="caption" color={theme.colors.onPrimary} style={styles.confirmText}>
                {removeLabel}
              </Text>
            </Animated.View>
          ) : null}
        </PressableScale>
      </Animated.View>
      <PressableScale
        accessibilityLabel={t`Cancel`}
        onPress={onCancel}
        style={[styles.button, styles.square, { backgroundColor: theme.colors.surfaceRaised }]}>
        <X size={16} color={theme.colors.textMuted} strokeWidth={2} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  menu: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  button: {
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  square: {
    width: 36,
  },
  armed: {
    paddingHorizontal: 12,
    gap: 5,
  },
  glyph: {
    width: 16,
    height: 16,
  },
  glyphLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    fontWeight: '700',
  },
});
