import { memo, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Check, Sparkles, X, Bot, Compass, FileText } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { LADDER, SettingsCard } from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import { getAgentCatalog, type AgentInfo } from '@/lib/agent-session';

/**
 * The agent-mode picker, as a native form sheet route. Presentational: the
 * route above it reads the selection and the handler out of the sheet bridge.
 */
export interface AgentModeSheetProps {
  /** The gateway session whose catalog is listed. */
  sessionId?: string;
  selectedAgent?: string;
  onSelectAgent: (agent: string) => void;
  onClose: () => void;
}

export const AgentModeSheet = memo(function AgentModeSheet({
  sessionId,
  selectedAgent,
  onSelectAgent,
  onClose,
}: AgentModeSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const builtinAgents = useMemo<AgentInfo[]>(
    () => [
      {
        id: 'build',
        name: t`Build`,
        description: t`Autonomous software engineering, editing files, running terminal commands, and testing.`,
        mode: 'primary',
      },
      {
        id: 'plan',
        name: t`Plan`,
        description: t`High-level architectural planning, design proposals, and step-by-step implementation roadmaps.`,
        mode: 'primary',
      },
      {
        id: 'explore',
        name: t`Explore`,
        description: t`Fast read-only codebase exploration, symbol search, file discovery, and dependency tracing.`,
        mode: 'subagent',
      },
      {
        id: 'general',
        name: t`General`,
        description: t`Conversational coding assistance, general programming advice, and open-ended workspace questions.`,
        mode: 'primary',
      },
    ],
    [t]
  );

  // A route mounts when it opens and unmounts when it is dismissed, so the
  // catalog is fetched once per opening without a `visible` flag to watch.
  useEffect(() => {
    let active = true;
    setLoading(true);
    getAgentCatalog(sessionId)
      .then((cat) => {
        if (active && cat?.agents && cat.agents.length > 0) {
          setAgents(cat.agents);
        } else if (active) {
          setAgents(builtinAgents);
        }
      })
      .catch((err) => {
        console.warn('Failed to load agent catalog:', err);
        if (active) setAgents(builtinAgents);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId, builtinAgents]);

  const displayAgents = agents.length > 0 ? agents : builtinAgents;

  const getAgentIcon = (id: string, color: string) => {
    switch (id) {
      case 'build':
        return <Bot size={18} color={color} />;
      case 'explore':
        return <Compass size={18} color={color} />;
      case 'plan':
        return <FileText size={18} color={color} />;
      default:
        return <Sparkles size={18} color={color} />;
    }
  };

  const getAgentModeMeta = (ag: AgentInfo) => {
    const isBuiltin = ['build', 'plan', 'explore', 'general'].includes(ag.id);
    const mode = ag.mode?.toLowerCase();

    if (mode === 'subagent' || ag.id === 'explore') {
      return {
        label: t`Subagent`,
        bg: withAlpha(theme.colors.textMuted, 0.15),
        textColor: theme.colors.textMuted,
      };
    }
    if (mode === 'primary' || isBuiltin) {
      return {
        label: t`Primary`,
        bg: withAlpha(theme.colors.primary, 0.09),
        textColor: theme.colors.primary,
      };
    }
    return {
      label: t`Custom`,
      bg: withAlpha(theme.colors.warning, 0.15),
      textColor: theme.colors.warning,
    };
  };

  return (
    // One ground and one layout column: the two subviews a native form sheet
    // lays itself out around. See `sheet-ground.tsx`.
    <SheetFrame testID="agent-mode-sheet" tint="background">
      <View collapsable={false} style={styles.sheetLayout}>
        {/* Pinned Top Navigation Bar */}
        <View style={styles.fixedTop}>
          <SheetHandle />

          <View style={styles.header}>
            <View style={[styles.headerCopy, plate]}>
              <Text variant="subheading" style={styles.headerTitle}>
                {t`Agent Mode`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`Choose the specialized agent for this task`}
              </Text>
            </View>

            <GlassChrome face="sheet" style={styles.headerButton}>
              <PressableScale
                testID="agent-mode-close"
                accessibilityRole="button"
                accessibilityLabel={t`Close`}
                onPress={onClose}
                style={styles.headerButtonHit}>
                <X size={19} color={theme.colors.text} strokeWidth={2} />
              </PressableScale>
            </GlassChrome>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <Spinner size="lg" color={theme.colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.scrollViewport}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: LADDER.section + insets.bottom },
            ]}>
            <SettingsCard>
              {displayAgents.map((ag: AgentInfo) => {
                const isSelected = selectedAgent === ag.id;
                const meta = getAgentModeMeta(ag);
                const accentColor =
                  ag.color || (isSelected ? theme.colors.primary : theme.colors.text);

                return (
                  <PressableScale
                    key={ag.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => onSelectAgent(ag.id)}
                    style={[
                      styles.agentRow,
                      isSelected && {
                        backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                      },
                    ]}>
                    <View style={styles.agentRowTop}>
                      <View style={styles.agentTitleRow}>
                        {getAgentIcon(ag.id, accentColor)}
                        <Text
                          variant="bodySmall"
                          weight="semibold"
                          color={isSelected ? theme.colors.primary : theme.colors.text}
                          style={styles.agentName}>
                          {ag.name || ag.id}
                        </Text>
                        <View style={[styles.modeBadge, { backgroundColor: meta.bg }]}>
                          <Text
                            variant="caption"
                            color={meta.textColor}
                            style={styles.modeBadgeText}>
                            {meta.label}
                          </Text>
                        </View>
                      </View>
                      {isSelected ? <Check size={18} color={theme.colors.primary} /> : null}
                    </View>
                    {ag.description ? (
                      <Text
                        variant="caption"
                        color={theme.colors.textMuted}
                        style={styles.agentDesc}>
                        {ag.description}
                      </Text>
                    ) : null}
                  </PressableScale>
                );
              })}
            </SettingsCard>
          </ScrollView>
        )}
      </View>
    </SheetFrame>
  );
});

const styles = StyleSheet.create({
  // The stack renders form sheets over a transparent background so the native
  // sheet keeps its own corners; without filling the height, that transparency
  // shows as a strip under the content.
  sheetLayout: {
    flex: 1,
  },
  fixedTop: {
    flexShrink: 0,
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap * 1.5,
    paddingBottom: LADDER.gap,
    gap: LADDER.snug,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerTitle: {
    includeFontPadding: false,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  headerButtonHit: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollViewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
  },
  agentRow: {
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
    gap: 6,
  },
  agentRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  agentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  agentName: {
    includeFontPadding: false,
  },
  modeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  agentDesc: {
    lineHeight: 17,
  },
});
