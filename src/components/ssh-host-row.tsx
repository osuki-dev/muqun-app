import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import {
  ChevronRight,
  Fingerprint,
  KeyRound,
  Lock,
  Pencil,
  ShieldCheck,
} from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { type SshHomeAge, sshHomeAge, sshHomeSubtitle } from '@/lib/ssh-home';
import type { SshHostRecord } from '@/lib/ssh-hosts';

/**
 * "Last connected 5m ago", in the active locale.
 *
 * One message per unit rather than a template with a unit letter in a hole,
 * for the reason `server-agent-rows.tsx` gives: "5m ago" is English's
 * abbreviation, and a translator needs the whole sentence. The messages are
 * the ones Settings > SERVERS already says about a gateway, so a host and a
 * server describe their age in the same words. A hook rather than a helper
 * because the macro only expands a `t` it can trace to `useLingui()`.
 */
export function useSshHostAgeLabel(age: SshHomeAge): string {
  const { t } = useLingui();
  switch (age.unit) {
    case 'never':
      return t`Never connected`;
    case 'now':
      return t`Last connected just now`;
    case 'minute': {
      const minutes = age.value;
      return t`Last connected ${minutes}m ago`;
    }
    case 'hour': {
      const hours = age.value;
      return t`Last connected ${hours}h ago`;
    }
    case 'day': {
      const days = age.value;
      return t`Last connected ${days}d ago`;
    }
  }
}

/**
 * One saved SSH host, as a row.
 *
 * Shared by the host list (`/ssh`) and the home screen, so a host looks the
 * same wherever a reader meets it: the glyph says how it logs in (a key, a
 * fingerprint for keyboard-interactive, a lock for a password), the shield
 * beside the name says its host key has been accepted, and the two captions
 * under it say where it is and when it was last opened. The list adds an edit
 * control on the trailing edge; the home screen, which only opens hosts,
 * leaves that slot to a chevron.
 */
export function SshHostRow({
  record,
  onOpen,
  onEdit,
  nowMs,
  testID,
}: {
  record: SshHostRecord;
  onOpen: () => void;
  /** Absent for the demo host, which is not saved and cannot be changed, and on the home screen. */
  onEdit?: () => void;
  /** Read at the caller's render, so a screen of rows ages against one clock. */
  nowMs: number;
  testID?: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const address = sshHomeSubtitle(record);
  const trusted = Boolean(record.trustedHostKey);

  const lastConnected = useSshHostAgeLabel(sshHomeAge(record, nowMs));

  // The hint carries what the glyphs say, so a screen reader hears the
  // address, the age and the trust in one breath after the name.
  const hint = trusted
    ? `${address} · ${lastConnected} · ${t`Host key trusted`}`
    : `${address} · ${lastConnected}`;

  return (
    <View testID={testID} style={[styles.row, { backgroundColor: theme.colors.surface }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Open SSH host ${record.label}`}
        accessibilityHint={hint}
        onPress={onOpen}
        style={styles.rowMain}>
        <View style={[styles.rowIcon, { backgroundColor: theme.colors.surfaceRaised }]}>
          {record.auth.type === 'privateKey' ? (
            <KeyRound size={18} color={theme.colors.primary} strokeWidth={2} />
          ) : record.auth.type === 'keyboardInteractive' ? (
            <Fingerprint size={18} color={theme.colors.primary} strokeWidth={2} />
          ) : (
            <Lock size={18} color={theme.colors.primary} strokeWidth={2} />
          )}
        </View>
        <View style={styles.rowCopy}>
          <View style={styles.rowHeadline}>
            <Text variant="bodySmall" numberOfLines={1} style={styles.rowLabel}>
              {record.label}
            </Text>
            {trusted ? (
              // Spoken through the hint above; the glyph itself is decoration.
              <View importantForAccessibility="no" accessibilityElementsHidden>
                <ShieldCheck size={14} color={theme.colors.success} strokeWidth={2.2} />
              </View>
            ) : null}
          </View>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {address}
          </Text>
          <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
            {lastConnected}
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
    minWidth: 0,
    gap: 2,
  },
  rowHeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowLabel: {
    flexShrink: 1,
  },
  rowAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
