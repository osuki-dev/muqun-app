import { memo, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Check, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react-native';

import { PressableScale } from '@/components/pressable-scale';
import { permissionActionPhrase, permissionDecisionLabel } from '@/i18n/labels';
import { permissionSubject } from '@/lib/agent-engine-text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import {
  DEFAULT_PERMISSION_DECISIONS,
  type PermissionDecision,
  type PermissionOption,
  type PermissionRequest,
} from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';

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

/** A decision with nothing but its own order, for a payload that listed none. */
function asOption(decision: PermissionDecision, index: number): PermissionOption {
  return { index, label: decision, decision };
}

/** `external_directory` as "External directory": the key, at least readable. */
function spellOutAction(action: string): string {
  const words = action.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}

/**
 * What the agent is asking to do, and the answers it offered.
 *
 * OpenCode sends `options[]` -- an index, a label and a decision each -- so a
 * permission with a menu of its own keeps its order here. The *wording* is not
 * taken from the wire: a label the gateway sent in English would be English in
 * all twelve languages, and the three answers are one vocabulary across this
 * card, the push notification and the tray. An empty `options[]` is not a
 * request with no answers; it is a payload that did not list the three every
 * permission has, which come from `DEFAULT_PERMISSION_DECISIONS`.
 *
 * The request is stated once. It used to be stated three times over: the wire
 * key (`external_directory`) on the header's second line, the prompt, a bullet
 * list of `resources`, and then `save[]` under "Always allow" -- which on a
 * read of `/etc/hosts` meant `/etc/*` three times on one card. The action is a
 * phrase, the thing it acts on is one line under it, and the glob an "always"
 * would whitelist stays where it belongs: beside the button that whitelists it.
 */
export const AgentPermissionCard = memo(function AgentPermissionCard({
  request,
  onDecision,
  attached = false,
}: AgentPermissionCardProps) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [submitting, setSubmitting] = useState<PermissionDecision | null>(null);

  const options: readonly PermissionOption[] = (
    request.options.length > 0 ? request.options : DEFAULT_PERMISSION_DECISIONS.map(asOption)
  ).map((option) => ({ ...option, label: _(permissionDecisionLabel[option.decision]) }));

  /** The rule the engine tripped, as a phrase; the key spelled out when it has none. */
  const phrase = request.action ? permissionActionPhrase[request.action] : undefined;
  const actionPhrase = phrase
    ? _(phrase)
    : request.action
      ? spellOutAction(request.action)
      : t`Permission required`;

  /**
   * The one thing this permission is about.
   *
   * The prompt is the engine's own statement and the most specific -- the file,
   * the command -- so it leads; `resources[0]` answers for a payload that sent
   * no prompt. Either way the rule key is taken off the front of it
   * (`agent-engine-text.ts`): the header's second line already says what the
   * rule means, and `external_directory: /etc/*` spent the most legible line
   * on the wire word. Anything else in `resources` that is neither that nor a
   * glob already shown beside "Always allow" is additional, and only then is
   * it worth a line of its own.
   */
  const subject = permissionSubject(request);
  const extraResources = request.resources.filter(
    (resource) => resource !== subject && !request.save.includes(resource)
  );

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
            {t`Permission required`}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            {actionPhrase}
          </Text>
        </View>
      </View>

      <View style={[styles.body, { backgroundColor: withAlpha(theme.colors.surface, 0.6) }]}>
        {subject ? (
          <Text selectable style={[styles.subject, { color: theme.colors.text }]}>
            {subject}
          </Text>
        ) : null}
        {extraResources.length > 0 ? (
          <View style={styles.resourcesBox}>
            {extraResources.map((res) => (
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
                  numberOfLines={3}
                  color={theme.colors.textSubtle}
                  style={styles.saveText}>
                  {t`Also allow ${request.save.join(' · ')} from now on`}
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
    fontSize: AGENT_TYPE.meta.size,
  },
  subject: {
    fontFamily: 'monospace',
    fontSize: AGENT_TYPE.meta.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
  body: {
    padding: 8,
    borderRadius: 6,
    borderCurve: 'continuous',
    marginBottom: 10,
  },
  message: {
    fontSize: AGENT_TYPE.micro.size,
    marginTop: 4,
  },
  resourcesBox: {
    marginTop: 4,
  },
  resourceText: {
    fontFamily: 'monospace',
    fontSize: AGENT_TYPE.micro.size,
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
    fontSize: AGENT_TYPE.meta.size,
    flexShrink: 1,
  },
  saveText: {
    fontSize: AGENT_TYPE.micro.size,
    textAlign: 'center',
  },
});
