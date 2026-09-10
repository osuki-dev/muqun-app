import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Check, ChevronRight, Monitor, Plus } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { SettingsCard } from '@/components/settings-chrome';
import { SettingsSheet } from '@/components/settings-sheet';
import type { SessionChoice } from '@/lib/session-switcher';

export type MachineChoice = {
  id: string;
  label: string;
  sessions?: SessionChoice[];
  error?: string;
};

/** Machine headings own their sessions: identical session IDs never share selection. */
export function MachineSwitcherSheet({
  machines,
  serverId,
  sessionId,
  pendingId,
  onConnect,
  onChoose,
  onAdd,
  onManage,
  onClose,
}: {
  machines: MachineChoice[];
  serverId: string;
  sessionId: string;
  pendingId: string | null;
  onConnect: (serverId: string) => void;
  onChoose: (serverId: string, sessionId: string) => void;
  onAdd: () => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <SettingsSheet
      title={t`Machines and sessions`}
      caption={t`Choose where to work`}
      closeLabel={t`Close session picker`}
      onClose={onClose}>
      {machines.map((machine) => (
        <SettingsCard key={machine.id}>
          <PressableScale
            testID={`machine-option-${machine.id}`}
            accessibilityRole="button"
            accessibilityLabel={t`Connect to ${machine.label}`}
            accessibilityState={{ busy: pendingId === machine.id }}
            disabled={pendingId !== null || Boolean(machine.sessions?.length)}
            onPress={() => onConnect(machine.id)}
            style={styles.row}>
            <Monitor size={18} color={theme.colors.textMuted} />
            <View style={styles.copy}>
              <Text variant="bodySmall" numberOfLines={1}>
                {machine.label}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {machine.id === serverId
                  ? t`Current machine`
                  : machine.sessions
                    ? t`Connected`
                    : t`Tap to connect`}
              </Text>
            </View>
            {pendingId === machine.id ? (
              <ActivityIndicator />
            ) : !machine.sessions ? (
              <ChevronRight size={16} color={theme.colors.textMuted} />
            ) : null}
          </PressableScale>
          {machine.error ? (
            <Text selectable variant="caption" style={styles.error} color={theme.colors.textMuted}>
              {machine.error}
            </Text>
          ) : null}
          {machine.sessions?.map((session) => {
            const selected = machine.id === serverId && session.id === sessionId;
            return (
              <PressableScale
                key={session.id}
                testID={`session-option-${machine.id}-${session.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t`${machine.label}, session ${session.label}`}
                disabled={pendingId !== null}
                onPress={() => onChoose(machine.id, session.id)}
                style={[styles.row, styles.session]}>
                <View style={styles.copy}>
                  <Text variant="bodySmall" numberOfLines={1}>
                    {session.label}
                  </Text>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    {session.kind}
                  </Text>
                </View>
                {selected ? <Check size={18} color={theme.colors.primary} /> : null}
              </PressableScale>
            );
          })}
        </SettingsCard>
      ))}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Add machine`}
        onPress={onAdd}
        disabled={pendingId !== null}
        style={styles.row}>
        <Plus size={18} color={theme.colors.primary} />
        <Text variant="bodySmall" color={theme.colors.primary}>{t`Add machine`}</Text>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        onPress={onManage}
        disabled={pendingId !== null}
        style={styles.manage}>
        <Text variant="caption" color={theme.colors.textMuted}>{t`Manage machines`}</Text>
      </PressableScale>
    </SettingsSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  session: { paddingLeft: 46 },
  error: { paddingHorizontal: 16, paddingBottom: 12 },
  manage: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
