import { Card } from '@/components/themed-card';
import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { useLingui } from '@lingui/react/macro';
import { PressableCard, Stack, Text, useThemeTokens } from '@osuki-dev/ui';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { ComposerPopupRow } from '@/lib/composer-popup';
import { fadeIn, fadeInDown, fadeOut, fadeOutDown, listLayout } from '@/lib/motion';

/**
 * The list the composer raises when a trigger character opens one: the pane's
 * slash commands today, its workspace files once `@` mentions land.
 *
 * Purely presentational, the way `ApprovalBanner` is. It holds no state, knows
 * nothing about drafts or carets, and takes rows already filtered and ranked by
 * `composer-popup.ts` -- so the same panel serves both triggers and neither one
 * can drift from the other's behaviour.
 *
 * Two details are load-bearing rather than cosmetic:
 *
 *  * `keyboardShouldPersistTaps="always"`. A pick happens mid-sentence with the
 *    keyboard up; without this the first tap only dismisses the keyboard, the
 *    panel closes under it because the draft never changed, and the command is
 *    never inserted.
 *  * The height cap. The panel floats over the terminal, so it is bounded to
 *    about five rows and scrolls past that. An agent has thirty-odd commands
 *    and a list tall enough for all of them would cover the conversation it is
 *    being used to continue.
 */

/** Rows drawn before the list starts scrolling. */
export const COMPOSER_POPUP_VISIBLE_ROWS = 5;
/**
 * One row: a name line, a description line, the row card's padding and the
 * gap under it. Measured against the real catalog rather than guessed -- an
 * under-estimate leaves a half row peeking out of the bottom of the panel.
 */
const ROW_HEIGHT = 54;
/** `Stack gap="xs"` between rows, which the cap has to count too. */
const ROW_GAP = 4;
/** The card's own padding above and below the scroller. */
const CARD_PADDING = 16;

export interface ComposerPopupProps {
  /**
   * Whose commands a `workspace` badge names: the terminal's come from its
   * Herdr workspace, OpenCode's from its project. One badge, each screen's word.
   */
  scope?: 'workspace' | 'project';
  rows: readonly ComposerPopupRow[];
  onPick: (row: ComposerPopupRow) => void;
  /**
   * The most room the panel has above the dock, when the screen it is on knows.
   *
   * Without one the panel took its five rows wherever they landed, which with
   * the keyboard up meant growing through the header and off the top of the
   * screen -- and the row that ran out of screen was cut in half, which reads
   * as a list that has been truncated rather than one that scrolls.
   */
  maxHeight?: number;
  /** Prefix for row test IDs, so two triggers can be told apart in a flow. */
  testIDPrefix?: string;
}

export function ComposerPopup({
  rows,
  onPick,
  maxHeight,
  testIDPrefix = 'composer-popup',
  scope = 'workspace',
}: ComposerPopupProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const surfaceOpacity = useSurfaceBackgroundOpacity();
  /**
   * A row's real height, measured rather than assumed.
   *
   * `ROW_HEIGHT` is the estimate the cap was built from, and an estimate that
   * is a point or two short leaves a sliver of the next row peeking out of the
   * bottom. The first row that lays out says what a row costs, and the cap is
   * a whole number of those.
   */
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  if (rows.length === 0) return null;

  const step = rowHeight + ROW_GAP;
  const wanted = Math.min(rows.length, COMPOSER_POPUP_VISIBLE_ROWS) * step - ROW_GAP;
  // Whole rows only, so the last one visible is a whole one.
  const room =
    maxHeight === undefined
      ? wanted
      : Math.max(rowHeight, Math.floor((maxHeight - CARD_PADDING) / step) * step - ROW_GAP);
  const listHeight = Math.min(wanted, room);

  return (
    <Animated.View
      entering={fadeInDown('dropdown')}
      exiting={fadeOutDown('micro')}
      testID={testIDPrefix}>
      <Card variant="raised" radius="md" padding="xs">
        <ScrollView
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: listHeight }}>
          <Stack gap="xs">
            {rows.map((row) => (
              // The panel re-ranks under the caret: every character typed drops
              // rows out of the list and moves the survivors up into the space.
              // Without this the whole list teleports on each keystroke, which
              // is the one moment the reader is looking straight at it. `micro`
              // rather than the panel's own `dropdown`, because a re-filter is
              // a list correcting itself mid-word, not a surface arriving --
              // anything slower and the rows are still settling when the next
              // character lands.
              <Animated.View
                key={row.id}
                layout={listLayout('micro')}
                entering={fadeIn('micro')}
                exiting={fadeOut('micro')}
                onLayout={(event) => {
                  const height = event.nativeEvent.layout.height;
                  if (height > 0) setRowHeight((current) => Math.max(current, height));
                }}>
                <PressableCard
                  variant="flat"
                  style={{
                    backgroundColor: surfaceBackground(
                      theme.colors[theme.components.Card.flat.background]
                    ),
                  }}
                  radius="sm"
                  padding="xs"
                  onPress={() => onPick(row)}
                  accessibilityRole="button"
                  // The hint rides in the row's own name, not just beside it:
                  // iOS collapses a labelled pressable's subtree into one
                  // element, so the child text is not in the tree a screen
                  // reader -- or a test -- walks. Android exposes both; saying
                  // it once here is what makes the two platforms agree.
                  accessibilityLabel={
                    row.hint ? t`Insert ${row.label} ${row.hint}` : t`Insert ${row.label}`
                  }
                  testID={`${testIDPrefix}-${row.id}`}>
                  <Stack direction="horizontal" gap="sm" align="center">
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Stack direction="horizontal" gap="xs" align="baseline">
                        <Text variant="bodySmall" weight="bold" colorKey="text" numberOfLines={1}>
                          {row.label}
                        </Text>
                        {/* The hint is what the user still has to type, so it is
                          drawn the way an empty field's placeholder is: present,
                          clearly not content, and never inserted. */}
                        {row.hint ? (
                          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                            {row.hint}
                          </Text>
                        ) : null}
                      </Stack>
                      {row.description ? (
                        <Text variant="caption" colorKey="textMuted" numberOfLines={1}>
                          {row.description}
                        </Text>
                      ) : null}
                    </View>
                    {/* Where a command came from is the one thing its name cannot
                      say: `/review` shipped with the agent and `/review` written
                      into this repo do different work. */}
                    {row.badge ? (
                      // The kit's `Tag` would do this, and it types its label
                      // in capitals -- WORKSPACE beside a sentence-case name
                      // and a sentence-case description, in an app that had
                      // already stopped shouting everywhere else. It is the
                      // same pill written out, in one case.
                      //
                      // The fill is the row card's own: painting an opaque
                      // `surfaceRaised` through the hook instead would put a
                      // second fill at the reader's alpha on top of the card's,
                      // and the badge would show the wallpaper at (1 - a)
                      // squared where the rest of the row shows it at (1 - a)
                      // -- the stacking `themed-tabs.tsx` takes apart. One
                      // layer per pixel, so under a custom theme the badge
                      // gives up its fill and keeps its muted label.
                      <View
                        style={[
                          styles.badge,
                          surfaceOpacity === 1
                            ? { backgroundColor: theme.colors.surfaceRaised }
                            : null,
                        ]}>
                        <Text
                          variant="caption"
                          transform="none"
                          color={theme.colors.textMuted}
                          numberOfLines={1}>
                          {row.badge === 'workspace'
                            ? scope === 'project'
                              ? t`Project`
                              : t`Workspace`
                            : row.badge}
                        </Text>
                      </View>
                    ) : null}
                  </Stack>
                </PressableCard>
              </Animated.View>
            ))}
          </Stack>
        </ScrollView>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
});
