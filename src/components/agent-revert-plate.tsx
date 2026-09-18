import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { Undo2 } from 'lucide-react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { AGENT_TYPE } from '@/constants/agent-type';
import { appChrome } from '@/constants/appearance';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { fadeInDown, fadeOutDown } from '@/lib/motion';
import type { FileDiffItem } from '@/lib/agent-session';

/**
 * What a rollback is about to do, before it does it.
 *
 * `/undo` used to be `POST …/revert`, which stages *and commits* in one call:
 * the reader typed four characters and a turn's worth of work disappeared, with
 * no statement of what had gone and nothing on screen to change their mind
 * with. The gateway's two-step route exists for exactly this -- stage, look,
 * then commit or withdraw -- so this plate is the middle step: how many
 * messages, which files, and the two words that decide it.
 *
 * "Undo" commits the staged rollback. "Keep" clears it and leaves everything
 * where it is, which is what `/redo` was misnamed for: there has never been a
 * redo here, only a staging that can be withdrawn.
 */
export interface AgentRevertPlateProps {
  /** Messages the rollback would take: the boundary, and everything after it. */
  messages: number;
  files: readonly FileDiffItem[];
  onCommit: () => void;
  onKeep: () => void;
  busy?: boolean;
}

/** How many file rows are drawn before the rest become a count. */
const FILE_PREVIEW_LIMIT = 4;

export const AgentRevertPlate = memo(function AgentRevertPlate({
  messages,
  files,
  onCommit,
  onKeep,
  busy = false,
}: AgentRevertPlateProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const diffColors = usePaneChatColors();
  const surfaceBackground = useSurfaceBackground();

  const shown = files.slice(0, FILE_PREVIEW_LIMIT);
  const rest = files.length - shown.length;

  /**
   * The count of messages is worked out from the transcript and can be zero --
   * a boundary above the window the app holds. The files are the gateway's own
   * answer, so they are stated whether or not the messages could be counted.
   */
  const messagesLabel =
    messages > 0 ? t`${plural(messages, { one: '# message', other: '# messages' })}` : '';
  const filesLabel =
    files.length > 0 ? t`${plural(files.length, { one: '# file', other: '# files' })}` : '';
  const summary = [messagesLabel, filesLabel].filter(Boolean).join(' · ');

  return (
    <Animated.View
      testID="agent-revert-plate"
      entering={fadeInDown('dropdown')}
      exiting={fadeOutDown('micro')}
      style={styles.wrap}>
      <View
        style={[
          styles.plate,
          {
            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
            borderColor: theme.colors.border,
          },
        ]}>
        <View style={styles.heading}>
          <Undo2 size={13} color={theme.colors.warning} />
          <Text
            variant="caption"
            weight="bold"
            color={theme.colors.text}
            numberOfLines={2}
            style={styles.headingText}>
            {summary ? t`Rolling back ${summary}` : t`Rolling back to here`}
          </Text>
        </View>

        {shown.length > 0 ? (
          <View style={styles.files}>
            {shown.map((file) => (
              <View key={file.path} style={styles.fileRow}>
                <Text
                  variant="caption"
                  numberOfLines={1}
                  ellipsizeMode="head"
                  color={theme.colors.textMuted}
                  style={styles.filePath}>
                  {file.path}
                </Text>
                {file.additions > 0 ? (
                  <Text variant="caption" weight="semibold" color={diffColors.added}>
                    {`+${file.additions}`}
                  </Text>
                ) : null}
                {file.deletions > 0 ? (
                  <Text variant="caption" weight="semibold" color={diffColors.removed}>
                    {`−${file.deletions}`}
                  </Text>
                ) : null}
              </View>
            ))}
            {rest > 0 ? (
              <Text variant="caption" color={theme.colors.textSubtle}>
                {t`and ${rest} more`}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          {/* Keep first, and quiet: the plate is standing over work that still
              exists, and leaving it alone is the safe half of the question. */}
          <PressableScale
            testID="agent-revert-keep"
            accessibilityRole="button"
            accessibilityLabel={t`Keep everything and drop the staged rollback`}
            disabled={busy}
            onPress={onKeep}
            style={styles.keep}>
            <Text variant="caption" weight="semibold" color={theme.colors.textMuted}>
              {t`Keep`}
            </Text>
          </PressableScale>
          <PressableScale
            testID="agent-revert-commit"
            accessibilityRole="button"
            accessibilityLabel={summary ? t`Undo ${summary}` : t`Undo back to the staged message`}
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={onCommit}
            style={[
              styles.commit,
              { backgroundColor: theme.colors.primary },
              busy ? { opacity: appChrome.opacity.disabled } : null,
            ]}>
            <Text variant="caption" weight="bold" color={theme.colors.onPrimary}>
              {t`Undo`}
            </Text>
          </PressableScale>
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, marginBottom: 6 },
  plate: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: appChrome.radius.popover,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headingText: { flex: 1, minWidth: 0, fontSize: AGENT_TYPE.meta.size },
  files: { gap: 3 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filePath: { flex: 1, minWidth: 0, fontSize: AGENT_TYPE.micro.size },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  keep: {
    minHeight: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commit: {
    minHeight: 32,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderCurve: 'continuous',
  },
});
