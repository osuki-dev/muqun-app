import { memo, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Check, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import {
  DEFAULT_PERMISSION_DECISIONS,
  type PermissionDecision,
  type PermissionOption,
  type PermissionRequest,
} from '@/lib/agent-session';

export interface AgentPermissionCardProps {
  request: PermissionRequest;
  onDecision: (decision: PermissionDecision) => Promise<void>;
  /** Attached under the tool row it belongs to, rather than in the footer. */
  attached?: boolean;
}

const DECISION_ICON = {
  allow: Check,
  allow_always: ShieldCheck,
  deny: XCircle,
} as const;

/**
 * What the agent is asking to do, and the answers it offered.
 *
 * The three buttons used to be hard-coded. OpenCode sends `options[]` -- an
 * index, a label and a decision each -- and a permission with a menu of its own
 * lost it here. It also sends `save[]`: the glob patterns an "always" would
 * whitelist project-wide, which is exactly the thing a reader should see before
 * pressing it, and which was dropped too.
 *
 * An empty `options[]` is not a request with no answers; it is a payload that
 * did not list the three every permission has, and those three are drawn from
 * `DEFAULT_PERMISSION_DECISIONS` with wording from the macro rather than from
 * the wire -- a label the gateway sent in English would otherwise be English in
 * all eight languages.
 */
export const AgentPermissionCard = memo(function AgentPermissionCard({
  request,
  onDecision,
  attached = false,
}: AgentPermissionCardProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [submitting, setSubmitting] = useState<PermissionDecision | null>(null);

  // Not memoised: the fallback labels come from the macro, whose binding the
  // React Compiler cannot follow into a `useMemo` -- and building three
  // objects is cheaper than the hook that would have skipped it anyway.
  const defaultLabels: Record<PermissionDecision, string> = {
    allow: t`Allow Once`,
    allow_always: t`Always Allow`,
    deny: t`Reject`,
  };
  const options: readonly PermissionOption[] =
    request.options.length > 0
      ? request.options
      : DEFAULT_PERMISSION_DECISIONS.map((decision, index) => ({
          index,
          label: defaultLabels[decision],
          decision,
        }));

  const handleDecision = async (decision: PermissionDecision) => {
    if (submitting) return;
    setSubmitting(decision);
    try {
      await onDecision(decision);
    } finally {
      setSubmitting(null);
    }
  };

  const tone = (decision: PermissionDecision) =>
    decision === 'deny' ? theme.colors.danger : theme.colors.primary;

  return (
    <View
      testID={`agent-permission-${request.id}`}
      style={[
        styles.container,
        attached ? styles.attached : null,
        {
          backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
          borderColor: theme.colors.warning,
        },
      ]}>
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: withAlpha(theme.colors.warning, 0.13) }]}>
          <ShieldAlert size={16} color={theme.colors.warning} />
        </View>
        <View style={styles.headerText}>
          <Text variant="bodySmall" color={theme.colors.text} style={styles.title}>
            {t`Permission Required`}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} style={styles.action}>
            {request.tool ? `${request.action} · ${request.tool}` : request.action}
          </Text>
        </View>
      </View>

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
        {/* The engine's own note about why it is asking. */}
        {request.message ? (
          <Text variant="caption" color={theme.colors.textMuted} style={styles.message}>
            {request.message}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {options.map((option) => {
          const Icon = DECISION_ICON[option.decision];
          const color = tone(option.decision);
          const primary = option.decision === 'allow';
          return (
            <View key={`${option.index}:${option.label}`} style={styles.optionColumn}>
              <PressableScale
                testID={`agent-permission-option-${option.decision}`}
                disabled={submitting !== null}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                onPress={() => handleDecision(option.decision)}
                style={[
                  styles.btn,
                  primary
                    ? { backgroundColor: theme.colors.primary }
                    : { backgroundColor: withAlpha(color, 0.09), borderColor: color },
                ]}>
                {submitting === option.decision ? (
                  <ActivityIndicator
                    size="small"
                    color={primary ? theme.colors.onPrimary : color}
                  />
                ) : (
                  <>
                    <Icon size={14} color={primary ? theme.colors.onPrimary : color} />
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      color={primary ? theme.colors.onPrimary : color}
                      style={styles.btnText}>
                      {option.label}
                    </Text>
                  </>
                )}
              </PressableScale>
              {/* What an "always" actually whitelists, said before it is
                  pressed rather than discovered afterwards. */}
              {option.decision === 'allow_always' && request.save.length > 0 ? (
                <Text
                  variant="caption"
                  numberOfLines={2}
                  color={theme.colors.textSubtle}
                  style={styles.saveText}>
                  {request.save.join('  ')}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    overflow: 'hidden',
    marginVertical: 6,
    padding: 10,
  },
  attached: {
    marginLeft: 12,
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
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
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
    borderCurve: 'continuous',
    marginBottom: 10,
  },
  prompt: {
    fontSize: 12,
    lineHeight: 16,
  },
  message: {
    fontSize: 11,
    marginTop: 4,
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
    alignItems: 'flex-start',
    gap: 8,
  },
  optionColumn: {
    flex: 1,
    gap: 3,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderCurve: 'continuous',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  btnText: {
    fontWeight: '600',
    fontSize: 11.5,
    flexShrink: 1,
  },
  saveText: {
    fontFamily: 'monospace',
    fontSize: 9.5,
    textAlign: 'center',
  },
});
