import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, Monitor, Plus } from 'lucide-react-native';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import type { SessionChoice } from '@/lib/session-switcher';

export type MachineChoice = {
  id: string;
  label: string;
  sessions?: SessionChoice[];
  error?: string;
};

/**
 * Where to work: the machines this phone is paired with, and the sessions on
 * each one.
 *
 * Machine headings own their sessions: identical session IDs never share
 * selection. On `sheet-scene.tsx` like every other sheet -- the machine is a
 * group heading and its sessions are rows under it, with the left rule on the
 * one you are in.
 */
export function MachineSwitcherSheet({
  machines,
  serverId,
  sessionId,
  pendingId,
  onConnect,
  onChoose,
  onAdd,
  onManage,
  onClose: _onClose,
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
  const insets = useSafeAreaInsets();
  const current = machines.find((machine) => machine.id === serverId);

  return (
    <SheetScene
      testID="machine-switcher-sheet"
      title={t`Machines and sessions`}
      caption={current?.label}>
      <ScrollView
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        showsVerticalScrollIndicator={false}>
        {machines.map((machine, index) => (
          <View key={machine.id}>
            {index > 0 ? <SheetSceneGroupRule /> : null}
            <SheetSceneGroupHeading title={machine.label} first={index === 0} />
            <SheetSceneRow
              testID={`machine-option-${machine.id}`}
              title={machine.label}
              caption={
                machine.id === serverId
                  ? t`Current machine`
                  : machine.sessions
                    ? t`Connected`
                    : t`Tap to connect`
              }
              leading={<Monitor size={17} color={theme.colors.textSubtle} />}
              accessibilityLabel={t`Connect to ${machine.label}`}
              disabled={pendingId !== null || Boolean(machine.sessions?.length)}
              onPress={() => onConnect(machine.id)}
              meta={
                pendingId === machine.id ? (
                  <ActivityIndicator />
                ) : !machine.sessions ? (
                  <ChevronRight size={16} color={theme.colors.textMuted} />
                ) : null
              }
            />
            {machine.error ? (
              <Text
                selectable
                variant="caption"
                color={theme.colors.textMuted}
                style={styles.error}>
                {machine.error}
              </Text>
            ) : null}
            {machine.sessions?.map((session) => (
              <SheetSceneRow
                key={session.id}
                testID={`session-option-${machine.id}-${session.id}`}
                title={session.label}
                caption={session.kind}
                selected={machine.id === serverId && session.id === sessionId}
                style={styles.session}
                accessibilityLabel={t`${machine.label}, session ${session.label}`}
                disabled={pendingId !== null}
                onPress={() => onChoose(machine.id, session.id)}
              />
            ))}
          </View>
        ))}

        <SheetSceneGroupRule />
        <SheetSceneRow
          title={t`Add machine`}
          leading={<Plus size={17} color={theme.colors.primary} />}
          accessibilityLabel={t`Add machine`}
          disabled={pendingId !== null}
          onPress={onAdd}
        />
        <PressableScale
          accessibilityRole="button"
          onPress={onManage}
          disabled={pendingId !== null}
          style={styles.manage}>
          <Text variant="caption" color={theme.colors.textMuted}>{t`Manage machines`}</Text>
        </PressableScale>
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}

const styles = StyleSheet.create({
  // Sessions belong to the machine above them, so they start one step in.
  session: { paddingLeft: SHEET_LADDER.section },
  error: { paddingBottom: SHEET_LADDER.snug, lineHeight: 17 },
  manage: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
