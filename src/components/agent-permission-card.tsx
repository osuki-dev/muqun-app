import { memo, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans } from '@lingui/react/macro';
import { ShieldAlert, Check, ShieldCheck, XCircle } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import type { PermissionRequest, PermissionDecision } from '@/lib/agent-session';

export interface AgentPermissionCardProps {
  request: PermissionRequest;
  onDecision: (decision: PermissionDecision) => Promise<void>;
}

export const AgentPermissionCard = memo(function AgentPermissionCard({
  request,
  onDecision,
}: AgentPermissionCardProps) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [submitting, setSubmitting] = useState<PermissionDecision | null>(null);

  const handleDecision = async (decision: PermissionDecision) => {
    if (submitting) return;
    setSubmitting(decision);
    try {
      await onDecision(decision);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
          borderColor: theme.colors.warning,
        },
      ]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: withAlpha(theme.colors.warning, 0.13) }]}>
          <ShieldAlert size={16} color={theme.colors.warning} />
        </View>
        <View style={styles.headerText}>
          <Text variant="bodySmall" color={theme.colors.text} style={styles.title}>
            <Trans>Permission Required</Trans>
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} style={styles.action}>
            {request.action}
          </Text>
        </View>
      </View>

      {/* Description / Resources */}
      <View style={[styles.body, { backgroundColor: withAlpha(theme.colors.surface, 0.6) }]}>
        <Text variant="caption" color={theme.colors.text} style={styles.prompt}>
          {request.prompt}
        </Text>
        {request.resources.length > 0 ? (
          <View style={styles.resourcesBox}>
            {request.resources.map((res) => (
              <Text
                key={res}
                selectable
                style={[styles.resourceText, { color: theme.colors.textMuted }]}>
                • {res}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {/* Decision Buttons */}
      <View style={styles.actions}>
        <PressableScale
          disabled={!!submitting}
          onPress={() => handleDecision('allow')}
          style={[styles.btn, styles.allowOnceBtn, { backgroundColor: theme.colors.primary }]}>
          {submitting === 'allow' ? (
            <ActivityIndicator size="small" color={theme.colors.onPrimary} />
          ) : (
            <>
              <Check size={14} color={theme.colors.onPrimary} />
              <Text variant="caption" color={theme.colors.onPrimary} style={styles.btnText}>
                <Trans>Allow Once</Trans>
              </Text>
            </>
          )}
        </PressableScale>

        <PressableScale
          disabled={!!submitting}
          onPress={() => handleDecision('allow_always')}
          style={[
            styles.btn,
            styles.allowAlwaysBtn,
            {
              backgroundColor: withAlpha(theme.colors.primary, 0.09),
              borderColor: theme.colors.primary,
            },
          ]}>
          {submitting === 'allow_always' ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <>
              <ShieldCheck size={14} color={theme.colors.primary} />
              <Text variant="caption" color={theme.colors.primary} style={styles.btnText}>
                <Trans>Always</Trans>
              </Text>
            </>
          )}
        </PressableScale>

        <PressableScale
          disabled={!!submitting}
          onPress={() => handleDecision('deny')}
          style={[
            styles.btn,
            styles.denyBtn,
            {
              backgroundColor: withAlpha(theme.colors.danger, 0.08),
              borderColor: theme.colors.danger,
            },
          ]}>
          {submitting === 'deny' ? (
            <ActivityIndicator size="small" color={theme.colors.danger} />
          ) : (
            <>
              <XCircle size={14} color={theme.colors.danger} />
              <Text variant="caption" color={theme.colors.danger} style={styles.btnText}>
                <Trans>Reject</Trans>
              </Text>
            </>
          )}
        </PressableScale>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1.5,
    overflow: 'hidden',
    marginVertical: 6,
    padding: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontWeight: '700',
    fontSize: 13,
  },
  action: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  body: {
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  prompt: {
    fontSize: 12,
    lineHeight: 16,
  },
  resourcesBox: {
    marginTop: 4,
  },
  resourceText: {
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 6,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  allowOnceBtn: {},
  allowAlwaysBtn: {},
  denyBtn: {},
  btnText: {
    fontWeight: '600',
    fontSize: 11.5,
  },
});
