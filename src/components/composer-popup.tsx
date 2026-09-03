import { useLingui } from '@lingui/react/macro';
import { Card, PressableCard, Stack, Tag, Text, useThemeTokens } from '@osuki-dev/ui';
import { ScrollView, View } from 'react-native';
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

export interface ComposerPopupProps {
  rows: readonly ComposerPopupRow[];
  onPick: (row: ComposerPopupRow) => void;
  /** Prefix for row test IDs, so two triggers can be told apart in a flow. */
  testIDPrefix?: string;
}

export function ComposerPopup({
  rows,
  onPick,
  testIDPrefix = 'composer-popup',
}: ComposerPopupProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  if (rows.length === 0) return null;

  const visibleRows = Math.min(rows.length, COMPOSER_POPUP_VISIBLE_ROWS);

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
          style={{ maxHeight: visibleRows * ROW_HEIGHT }}>
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
                exiting={fadeOut('micro')}>
                <PressableCard
                  variant="flat"
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
                    {row.badge ? <Tag variant="pill">{row.badge}</Tag> : null}
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
