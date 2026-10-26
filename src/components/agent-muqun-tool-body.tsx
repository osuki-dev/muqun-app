import { View, StyleSheet } from 'react-native';
import { InlineFileLink } from '@/components/inline-file-link';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { StatusDot } from '@/components/status-dot';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { capLines } from '@/lib/agent-tool-output';
import { formatToolDuration } from '@/lib/tool-call-detail';
import type {
  MuqunOperation,
  MuqunToolPresentation,
  MuqunToolStatus,
} from '@/lib/muqun-tool-presentation';

export const muqunOperationWord: Record<MuqunOperation, ReturnType<typeof msg>> = {
  'exec.run': msg`Run command`,
  'files.present': msg`Preview file`,
  'tasks.delegate': msg`Start task`,
  'tasks.wait': msg`Wait for task`,
  'tasks.read': msg`Read task`,
  'tasks.cancel': msg`Cancel task`,
  'tasks.complete': msg`Complete task`,
  'fleet.list': msg`Computers`,
  'fleet.describe': msg`Computer details`,
};
export const muqunStatusWord: Record<MuqunToolStatus, ReturnType<typeof msg>> = {
  calling: msg`Running`,
  started: msg`Started`,
  working: msg`Running when checked`,
  queued: msg`Queued when checked`,
  waiting: msg`Waiting when checked`,
  unconfirmed: msg`Completion unconfirmed`,
  done: msg`Completed`,
  failed: msg`Failed`,
  cancelled: msg`Cancelled`,
  returned: msg`Received`,
  unassigned: msg`No assigned task`,
  unknown: msg`Unknown`,
};

export function MuqunToolState({ status }: { status: MuqunToolStatus }) {
  const { i18n } = useLingui();
  const theme = useThemeTokens();
  const color =
    status === 'failed'
      ? theme.colors.danger
      : status === 'done'
        ? theme.colors.success
        : theme.colors.textMuted;
  return (
    <View style={styles.state}>
      <StatusDot color={color} size={6} filled pulse={status === 'calling'} />
      <Text testID="agent-muqun-status" variant="caption" color={color} style={styles.stateText}>
        {i18n._(muqunStatusWord[status])}
      </Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useThemeTokens();
  return (
    <View style={styles.fact}>
      <Text variant="caption" color={theme.colors.textSubtle}>
        {label}
      </Text>
      <Text variant="caption" selectable style={styles.factValue}>
        {value}
      </Text>
    </View>
  );
}

/** Static result snapshot. Live task ownership needs a source-scoped task store. */
export function AgentMuqunToolBody({
  presentation,
  durationMs,
}: {
  presentation: MuqunToolPresentation;
  durationMs?: number;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const mono = useMonoFontFamily();
  const command = presentation.command ? capLines(presentation.command, 6) : undefined;
  const output = presentation.output ? capLines(presentation.output, 16) : undefined;
  const goal = presentation.goal ? capLines(presentation.goal, 4) : undefined;
  const omitted = Boolean(command?.hidden || output?.hidden || goal?.hidden);
  return (
    <View testID="agent-muqun-body" style={styles.body}>
      {presentation.files.map((file) => (
        <InlineFileLink
          key={file.id}
          file={{ uri: file.path, name: file.name }}
          asid=""
          remoteFile={file}
        />
      ))}
      {presentation.cwd ? <Fact label={t`Working directory`} value={presentation.cwd} /> : null}
      {durationMs !== undefined ? (
        <Fact label={t`Call duration`} value={formatToolDuration(durationMs)} />
      ) : null}
      {command ? (
        <Text
          testID="agent-muqun-command"
          numberOfLines={6}
          selectable
          style={[styles.code, { fontFamily: mono, color: theme.colors.text }]}>
          {command.text}
        </Text>
      ) : null}
      {goal ? (
        <Text selectable numberOfLines={4} variant="caption">
          {goal.text}
        </Text>
      ) : null}
      {presentation.error ? (
        <Text selectable numberOfLines={4} variant="caption" color={theme.colors.danger}>
          {presentation.error}
        </Text>
      ) : null}
      {output ? (
        <View style={styles.output}>
          <Text variant="caption" color={theme.colors.textSubtle}>{t`Output`}</Text>
          <Text
            testID="agent-muqun-output"
            numberOfLines={16}
            selectable
            style={[styles.code, { fontFamily: mono, color: theme.colors.textMuted }]}>
            {output.text}
          </Text>
        </View>
      ) : null}
      {presentation.note ? (
        <Text variant="caption" numberOfLines={4} selectable>
          {presentation.note}
        </Text>
      ) : null}
      {presentation.timelineCount !== undefined ? (
        <Fact label={t`Timeline entries`} value={String(presentation.timelineCount)} />
      ) : null}
      {presentation.gatewayVersion ? (
        <Fact label="Gateway" value={presentation.gatewayVersion} />
      ) : null}
      {presentation.agents ? <Fact label={t`Agents`} value={presentation.agents} /> : null}
      {presentation.toolchains ? (
        <Fact label={t`Toolchains`} value={presentation.toolchains} />
      ) : null}
      {presentation.exitCode !== undefined ? (
        <Fact label={t`Exit code`} value={String(presentation.exitCode)} />
      ) : null}
      {presentation.machines.map((machine) => (
        <View key={machine.id} style={styles.fact}>
          <Text variant="caption" style={styles.factValue}>
            {machine.label}
          </Text>
          <Text variant="caption" color={theme.colors.textSubtle}>
            {machine.os}
          </Text>
          {presentation.operation === 'fleet.list' ? (
            <Text variant="caption" color={theme.colors.textMuted}>
              {machine.unauthorized
                ? t`Permission required`
                : machine.online === true
                  ? t`Online`
                  : machine.online === false
                    ? t`Offline`
                    : t`Unknown`}
            </Text>
          ) : null}
        </View>
      ))}
      {omitted ? (
        <Text variant="caption" color={theme.colors.textSubtle}>{t`Full content in Details`}</Text>
      ) : null}
      {!command &&
      !goal &&
      !output &&
      !presentation.error &&
      !presentation.note &&
      presentation.files.length === 0 &&
      presentation.timelineCount === undefined &&
      presentation.machines.length === 0 &&
      presentation.status !== 'calling' ? (
        <Text
          variant="caption"
          color={theme.colors.textSubtle}>{t`Result available in Details`}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, alignSelf: 'stretch' },
  state: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  stateText: { flexShrink: 1, fontSize: 11 },
  fact: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  factValue: { flexShrink: 1 },
  code: { fontSize: 12, lineHeight: 18 },
  output: { gap: 5 },
});
