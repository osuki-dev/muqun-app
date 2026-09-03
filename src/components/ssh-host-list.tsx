import { Trans, useLingui } from '@lingui/react/macro';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { ChevronRight, Fingerprint, KeyRound, Pencil, Plus, SquareTerminal } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { ScreenHeader } from '@/components/screen-header';
import { SshHostForm } from '@/components/ssh-host-form';
import { appChrome } from '@/constants/appearance';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { isDemoRecord } from '@/lib/demo-gateway';
import { demoSshHost } from '@/lib/demo-ssh';
import { sshHostAddress, type SshHostRecord } from '@/lib/ssh-hosts';
import { useSshHostsStore } from '@/stores/ssh-hosts';

/**
 * Every SSH host this device knows, and the way to add one.
 *
 * A separate list from the paired gateways on purpose. A gateway is a machine
 * that runs herdr and hands the app a whole workspace; an SSH host is any
 * machine with port 22 open, and the two are added, trusted and torn down in
 * different ways. Mixing them into one card list would put "unpair" and
 * "forget this key" side by side and make each look like the other.
 *
 * One bundled host sits at the top while the demo is on, and also whenever
 * the list is otherwise empty -- see `demo-ssh.ts`. The second rule is there
 * because a phone tears the demo down on the way back to the home screen
 * (the server header's back button hangs it up), so by the time the SSH
 * entry is reachable "the demo is on" is never true; and an empty list is
 * exactly when a reviewer with no server, or the offline end-to-end gate,
 * needs something to open.
 */
export function SshHostList() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { record: gateway } = useGatewayRecord();

  const hosts = useSshHostsStore((state) => state.hosts);
  const loading = useSshHostsStore((state) => state.loading);
  const hydrate = useSshHostsStore((state) => state.hydrate);
  useEffect(() => {
    if (loading) void hydrate();
  }, [hydrate, loading]);

  /** `null` is the list; `'new'` the blank form; a record the edit form. */
  const [editing, setEditing] = useState<SshHostRecord | 'new' | null>(null);

  const demoHost = isDemoRecord(gateway) || (!loading && hosts.length === 0) ? demoSshHost() : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title={editing === 'new' ? t`New SSH host` : editing ? t`Edit SSH host` : t`SSH`}
        onBack={editing ? () => setEditing(null) : undefined}
        right={
          editing ? undefined : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Add an SSH host`}
              onPress={() => setEditing('new')}
              style={styles.headerButton}>
              <Plus size={21} color={theme.colors.text} strokeWidth={2} />
            </PressableScale>
          )
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {editing ? (
          <SshHostForm
            record={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : loading ? (
          <View style={styles.empty}>
            <Spinner />
          </View>
        ) : (
          <View style={styles.list}>
            {demoHost ? (
              <HostRow
                record={demoHost}
                onOpen={() => router.push(`/ssh/${demoHost.id}`)}
              />
            ) : null}
            {hosts.map((record) => (
              <HostRow
                key={record.id}
                record={record}
                onOpen={() => router.push(`/ssh/${record.id}`)}
                onEdit={() => setEditing(record)}
              />
            ))}
            {hosts.length === 0 ? (
              <View style={styles.empty}>
                <SquareTerminal size={40} color={theme.colors.textMuted} strokeWidth={1.5} />
                <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyText}>
                  <Trans>No SSH hosts yet. Add one to open a shell on any machine you can reach.</Trans>
                </Text>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t`Add an SSH host`}
                  onPress={() => setEditing('new')}
                  style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]}>
                  <Text variant="caption" color={theme.colors.onPrimary}>
                    <Trans>Add a host</Trans>
                  </Text>
                </PressableScale>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function HostRow({
  record,
  onOpen,
  onEdit,
}: {
  record: SshHostRecord;
  onOpen: () => void;
  /** Absent for the demo host, which is not saved and cannot be changed. */
  onEdit?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const address = sshHostAddress(record);
  return (
    <View style={[styles.row, { backgroundColor: theme.colors.surface }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Open ${record.label}`}
        accessibilityHint={address}
        onPress={onOpen}
        style={styles.rowMain}>
        <View style={[styles.rowIcon, { backgroundColor: theme.colors.surfaceRaised }]}>
          {record.auth.type === 'privateKey' ? (
            <KeyRound size={18} color={theme.colors.primary} strokeWidth={2} />
          ) : record.auth.type === 'keyboardInteractive' ? (
            <Fingerprint size={18} color={theme.colors.primary} strokeWidth={2} />
          ) : (
            <SquareTerminal size={18} color={theme.colors.primary} strokeWidth={2} />
          )}
        </View>
        <View style={styles.rowCopy}>
          <Text variant="bodySmall" numberOfLines={1}>
            {record.label}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {address}
          </Text>
        </View>
        {onEdit ? null : <ChevronRight size={18} color={theme.colors.textSubtle} />}
      </PressableScale>
      {onEdit ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Edit ${record.label}`}
          onPress={onEdit}
          hitSlop={6}
          style={[styles.rowAction, { backgroundColor: theme.colors.surfaceRaised }]}>
          <Pencil size={16} color={theme.colors.text} strokeWidth={2} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  headerButton: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: appChrome.radius.noticeCard,
    borderCurve: 'continuous',
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyText: {
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 40,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
