import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Bot, Plus, X } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { sameTarget, type AssignmentTarget } from '@/hooks/use-composer-assignment';
import { canAssignToAgent } from '@/lib/agent-collaboration';
import { appChrome } from '@/constants/appearance';
import { fadeInDown, fadeOutDown } from '@/lib/motion';

export type AssignmentCandidate = {
  paneId: string;
  instanceId: string;
  name: string;
  status: string;
  cwd: string;
  sameWorkspace: boolean;
};

/**
 * Who the next message goes to, as a row above the composer.
 *
 * Assigning a task used to be a screen with its own text field, its own image
 * strip and its own Send -- all three of which already existed in the composer,
 * with previews, per-item retry and the upload-before-send wait that page never
 * had. The one thing the composer could not say was *which assistant*, so that
 * is the only thing this adds. Everything below it keeps working exactly as it
 * does for an ordinary message.
 *
 * A horizontal strip rather than a dropdown: the choice is between a handful of
 * named things whose status matters, and a menu that has to be opened hides both
 * the names and the statuses behind a tap. Here they are all on screen, the
 * status travels with the name, and choosing is one tap from the field.
 *
 * Nothing is selected by default. The strip being open does not make the
 * composer send somewhere else -- an open strip with nothing chosen is an
 * ordinary composer, so opening it can never hijack a message in progress.
 */
export function AgentAssignmentBar({
  candidates,
  kinds,
  target,
  onChoose,
  onClose,
  disabled,
  commandName,
}: {
  candidates: readonly AssignmentCandidate[];
  /** Agent kinds this gateway will start, from its catalog. */
  kinds: readonly { kind: string; available: boolean }[];
  target: AssignmentTarget | null;
  onChoose: (target: AssignmentTarget) => void;
  onClose: () => void;
  disabled?: boolean;
  /** A bundled instruction set riding with the task, named so the reader knows. */
  commandName?: string;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();

  const chipStyle = (selected: boolean) => [
    styles.chip,
    {
      backgroundColor: surfaceBackground(
        selected ? theme.colors.primarySubtle : theme.colors.surfaceRaised
      ),
      borderColor: selected ? theme.colors.primary : 'transparent',
    },
  ];

  return (
    <Animated.View
      entering={fadeInDown('dropdown')}
      exiting={fadeOutDown('micro')}
      style={styles.bar}>
      <View style={styles.header}>
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          numberOfLines={1}
          style={styles.title}>
          {commandName
            ? target
              ? t`${commandName} · sending to`
              : commandName
            : target
              ? t`Sending to`
              : t`Choose an assistant`}
        </Text>
        <PressableScale
          testID="assignment-bar-close"
          accessibilityRole="button"
          accessibilityLabel={t`Stop assigning a task`}
          onPress={onClose}
          style={styles.close}>
          <X size={15} color={theme.colors.textMuted} />
        </PressableScale>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.row}>
        {candidates.map((candidate) => {
          const selected = Boolean(target && sameTarget(target, { type: 'agent', ...candidate }));
          const ready = canAssignToAgent(candidate.status);
          return (
            <PressableScale
              key={candidate.paneId}
              testID={`assignment-agent-${candidate.paneId}`}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              // A busy assistant is still shown, and still chosen: it is the
              // send that refuses, with a sentence about why. Hiding it would
              // make a terminal the reader can see disappear from this row for
              // reasons the row never explains.
              disabled={disabled}
              onPress={() =>
                onChoose({
                  type: 'agent',
                  paneId: candidate.paneId,
                  instanceId: candidate.instanceId,
                  name: candidate.name,
                })
              }
              style={chipStyle(selected)}>
              {/* Filled when the assistant can take the task now, a ring when
                  it cannot -- the same two states this dot means everywhere
                  else, so a busy assistant reads as "not now" rather than as a
                  different colour nobody has a key for. */}
              <StatusDot
                color={ready ? theme.colors.success : theme.colors.textMuted}
                filled={ready}
              />
              <Text variant="bodySmall" numberOfLines={1} style={styles.chipLabel}>
                {candidate.name}
              </Text>
            </PressableScale>
          );
        })}
        {kinds.map((profile) => {
          const selected = Boolean(
            target && sameTarget(target, { type: 'new', kind: profile.kind })
          );
          return (
            <PressableScale
              key={`new:${profile.kind}`}
              testID={`assignment-new-${profile.kind}`}
              accessibilityRole="button"
              accessibilityLabel={t`Start a new ${profile.kind}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChoose({ type: 'new', kind: profile.kind })}
              style={chipStyle(selected)}>
              <Plus size={14} color={theme.colors.primary} />
              <Text variant="bodySmall" numberOfLines={1} style={styles.chipLabel}>
                {profile.kind}
              </Text>
            </PressableScale>
          );
        })}
        {candidates.length === 0 && kinds.length === 0 ? (
          <View style={styles.empty}>
            <Bot size={15} color={theme.colors.textMuted} />
            <Text variant="caption" color={theme.colors.textMuted}>
              {t`No other assistants in this session yet.`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { padding: 4 },
  title: { flexShrink: 1 },
  row: { flexDirection: 'row', gap: 8, paddingRight: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    // Room for a name without letting one long agent title take the whole row.
    maxWidth: 220,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: appChrome.radius.roundControl,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  chipLabel: { flexShrink: 1 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34 },
});
