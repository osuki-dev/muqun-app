import { useLingui } from '@lingui/react/macro';
import {
  Alert,
  Card,
  Icon,
  PressableCard,
  Spinner,
  Stack,
  Tag,
  Text,
  useThemeTokens,
  type IconName,
} from '@osuki-dev/ui';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { fadeIn, fadeInDown, fadeOut, fadeOutDown, listLayout, timing } from '@/lib/motion';
import type { ApprovalDecision, ApprovalOption, PaneApproval } from '@/lib/pane-approval';

/**
 * The banner the terminal screen raises when its pane is blocked on a
 * permission menu.
 *
 * It is the agent's own menu, redrawn: the question the agent asked, the lines
 * it drew around the request, and its answers *verbatim* -- because "don't ask
 * again for: npm install *" is a materially different promise from "allow", and
 * paraphrasing it would be the app deciding on the user's behalf. Only the
 * decision glyph is the app's reading, and it is decoration.
 *
 * Purely presentational: it holds no state, makes no request, and knows nothing
 * about fingerprints. What a tap means is `usePaneApproval`'s business.
 *
 * While it is up it is also the *only* thing in the composer dock -- the key
 * row, the pane strip, the attachments and the input all stand aside for it, on
 * the rule in `dockPresentation`. That is why it carries an `esc` of its own:
 * with the dock cleared, the row that normally offers one is not there, and a
 * question with no way past it is a trap.
 */
export interface ApprovalBannerProps {
  approval: PaneApproval | null;
  /** The option whose answer is in flight, if any. Locks the whole menu. */
  answeringIndex: number | null;
  error: string | null;
  onAnswer: (option: ApprovalOption) => void;
  onDismissError: () => void;
  /**
   * Send `esc` to the pane, dismissing the agent's menu without answering it.
   *
   * The screen clears the whole dock while a menu is standing, so this is the
   * only control left that is not one of the agent's own answers -- the way out
   * of a question the user does not want to answer either way. Whether it is
   * passed at all is `dockPresentation`'s call, not this component's: absent, a
   * key row with its own `esc` is on screen and two would be one too many.
   */
  onEscape?: () => void;
  /** The pane cannot take keys right now: disconnected, or one is in flight. */
  escapeDisabled?: boolean;
  /** The `esc` this banner sent is the key currently in flight. */
  escapeSending?: boolean;
}

const DECISION_ICONS: Record<ApprovalDecision, IconName> = {
  allow: 'Check',
  allow_always: 'CheckCheck',
  deny: 'X',
  other: 'CircleDot',
};

export function ApprovalBanner({
  approval,
  answeringIndex,
  error,
  onAnswer,
  onDismissError,
  onEscape,
  escapeDisabled = false,
  escapeSending = false,
}: ApprovalBannerProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();

  // An error with no menu behind it is still worth one line: it is how a user
  // learns that the answer they tapped did not land.
  if (!approval) {
    if (!error) return null;
    return (
      <Animated.View entering={fadeInDown('short')} exiting={fadeOutDown('micro')}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Dismiss the approval error`}
          onPress={onDismissError}
          testID="approval-banner-error"
        >
          <Alert variant="warning" message={error} />
        </Pressable>
      </Animated.View>
    );
  }

  const busy = answeringIndex !== null;
  // The agent's framing of the request -- the command, the file, the diff. One
  // line of it is orientation; the rest is already on the terminal behind this.
  const context = approval.context.filter((line) => line !== approval.prompt).join('  ·  ');

  return (
    <Animated.View
      // The fingerprint is the approval's identity: if one menu replaces the
      // next without the banner unmounting, React must not reuse the instance,
      // or the options hard-swap under the user's finger.
      key={approval.fingerprint}
      entering={fadeInDown('short')}
      exiting={fadeOutDown('micro')}
      // One approval replacing another is not one banner: the key above sees to
      // that. But a *taller* replacement -- one more option, a longer context
      // line -- still resized the card between two frames, and this banner sits
      // inside the composer dock, so that resize pushed the whole dock and the
      // terminal's inset with it.
      layout={listLayout('short')}
      testID="approval-banner"
    >
      <Card variant="raised" radius="md" padding="sm">
        <Stack gap="sm">
          <Stack direction="horizontal" gap="sm" align="flex-start">
            <View style={{ paddingTop: 1 }}>
              <Icon name="ShieldAlert" size={16} color={theme.colors.warning} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="bodySmall" weight="bold" colorKey="text" numberOfLines={2}>
                {approval.prompt}
              </Text>
              {context ? (
                <Text variant="caption" colorKey="textMuted" numberOfLines={2}>
                  {context}
                </Text>
              ) : null}
            </View>
            {approval.tool ? <Tag variant="technical">{approval.tool}</Tag> : null}
          </Stack>

          {error ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t`Dismiss the approval error`}
              onPress={onDismissError}
              testID="approval-banner-error"
            >
              <Alert variant="warning" message={error} />
            </Pressable>
          ) : null}

          <Stack gap="xs">
            {approval.options.map((option) => (
              <ApprovalOptionRow
                key={option.index}
                option={option}
                answering={answeringIndex === option.index}
                busy={busy}
                onAnswer={onAnswer}
              />
            ))}
          </Stack>

          {/* The footer carries the agent's own key hint and, while the key row
              is hidden behind this banner, the escape that row was carrying.
              One line: the hint usually reads "esc to cancel", so the control
              that does it belongs at the end of that sentence rather than
              floating somewhere else in the dock. */}
          {approval.hint || onEscape ? (
            <Stack direction="horizontal" gap="sm" align="center">
              <View style={styles.hint}>
                {approval.hint ? (
                  <Text variant="caption" colorKey="textSubtle" numberOfLines={1}>
                    {approval.hint}
                  </Text>
                ) : null}
              </View>
              {onEscape ? (
                <Animated.View
                  entering={fadeIn('micro')}
                  exiting={fadeOut('micro')}
                  layout={listLayout('short')}>
                  <PressableCard
                    variant="flat"
                    radius="sm"
                    padding="xs"
                    disabled={escapeDisabled}
                    onPress={onEscape}
                    accessibilityRole="button"
                    accessibilityLabel={t`Press Escape to dismiss this request`}
                    testID="approval-escape"
                    style={styles.escape}>
                    {escapeSending ? (
                      <Spinner size="sm" color={theme.colors.textMuted} />
                    ) : (
                      <Text
                        variant="caption"
                        weight="bold"
                        colorKey={escapeDisabled ? 'textDisabled' : 'textMuted'}>
                        Esc
                      </Text>
                    )}
                  </PressableCard>
                </Animated.View>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </Card>
    </Animated.View>
  );
}

/**
 * One answer the agent offered.
 *
 * Answering used to be told entirely in cuts: the tapped option's glyph became
 * a spinner on one frame, and every other option's label became disabled grey
 * on the same one -- so the menu did not so much lock as flicker into a
 * different menu. Both now travel on the micro token, which is short enough
 * that a fast answer still feels immediate and long enough that the eye reads
 * one state becoming another.
 *
 * The glyph and the label are cross-faded pairs rather than single views whose
 * colour animates: `Icon` takes its colour as a prop, and the design system's
 * `Text` resolves its own before the style reaches React Native, so neither
 * leaves the UI thread anything to drive.
 */
function ApprovalOptionRow({
  option,
  answering,
  busy,
  onAnswer,
}: {
  option: ApprovalOption;
  /** This option is the one whose answer is in flight. */
  answering: boolean;
  /** Some option's answer is in flight, so the whole menu is locked. */
  busy: boolean;
  onAnswer: (option: ApprovalOption) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const answeringValue = useSharedValue(answering ? 1 : 0);
  const busyValue = useSharedValue(busy ? 1 : 0);

  useEffect(() => {
    answeringValue.value = withTiming(answering ? 1 : 0, timing('micro'));
  }, [answering, answeringValue]);
  useEffect(() => {
    busyValue.value = withTiming(busy ? 1 : 0, timing('micro'));
  }, [busy, busyValue]);

  const glyphStyle = useAnimatedStyle(() => ({ opacity: 1 - answeringValue.value }));
  const spinnerStyle = useAnimatedStyle(() => ({ opacity: answeringValue.value }));
  const liveLabelStyle = useAnimatedStyle(() => ({ opacity: 1 - busyValue.value }));
  const lockedLabelStyle = useAnimatedStyle(() => ({ opacity: busyValue.value }));

  return (
    <PressableCard
      variant="flat"
      radius="sm"
      padding="xs"
      disabled={busy}
      onPress={() => onAnswer(option)}
      accessibilityRole="button"
      accessibilityLabel={t`Answer: ${option.label}`}
      testID={`approval-option-${option.index}`}
    >
      <Stack direction="horizontal" gap="sm" align="center">
        <View style={styles.decision}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.centred, glyphStyle]}>
            <Icon
              name={DECISION_ICONS[option.decision]}
              size={16}
              color={option.decision === 'deny' ? theme.colors.danger : theme.colors.primary}
            />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.centred, spinnerStyle]}>
            <Spinner size="sm" color={theme.colors.primary} />
          </Animated.View>
        </View>
        {/* The live copy lays the row out; the locked copy is drawn over it. */}
        <View style={styles.label}>
          <Animated.View style={liveLabelStyle}>
            <Text variant="bodySmall" colorKey="text" numberOfLines={2}>
              {option.label}
            </Text>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, lockedLabelStyle]}>
            <Text variant="bodySmall" colorKey="textDisabled" numberOfLines={2}>
              {option.label}
            </Text>
          </Animated.View>
        </View>
        {/* The app's own annotation of which answer is preselected, not the
            agent's wording -- `option.label` beside it comes off the wire and
            is the gateway's to translate, this is ours. Upper case is baked
            into the source the way `reachabilityLabel` bakes it into `ONLINE`:
            a `text-transform` does nothing to 繁體中文 and the wrong thing to
            some scripts, so case is left to each translator. */}
        {/* `t` rather than `<Trans>`: `Tag` types its children as `string`, so
            the element a `<Trans>` renders is a type error there. */}
        {option.selected ? <Tag variant="pill">{t`DEFAULT`}</Tag> : null}
      </Stack>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  // Sized to the glyph, so the spinner laid over it lands on top of it rather
  // than filling the row.
  decision: {
    width: 16,
    height: 16,
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  // Takes the width so the escape sits at the end of the footer whether or not
  // the agent drew a hint to put in front of it.
  hint: {
    flex: 1,
    minWidth: 0,
  },
  // Wide enough that swapping the cap for the spinner does not resize the
  // control mid-press, and centred so neither is off to one side.
  escape: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
