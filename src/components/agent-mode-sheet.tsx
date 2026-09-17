import { memo, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, ActivityIndicator, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Check, Sparkles, X, Bot, Compass, FileText } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { SheetHeading } from '@/components/sheet-heading';
import { SheetFrame } from '@/components/sheet-ground';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { getAgentCatalog, type AgentInfo } from '@/lib/agent-session';

export interface AgentModeSheetProps {
  visible: boolean;
  selectedAgent?: string;
  onSelectAgent: (agent: string) => void;
  onClose: () => void;
}

export const AgentModeSheet = memo(function AgentModeSheet({
  visible,
  selectedAgent,
  onSelectAgent,
  onClose,
}: AgentModeSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
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

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    getAgentCatalog()
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
  }, [visible, builtinAgents]);

  const displayAgents = agents.length > 0 ? agents : builtinAgents;

  const getAgentIcon = (id: string, color: string) => {
    switch (id) {
      case 'build':
        return <Bot size={16} color={color} />;
      case 'explore':
        return <Compass size={16} color={color} />;
      case 'plan':
        return <FileText size={16} color={color} />;
      default:
        return <Sparkles size={16} color={color} />;
    }
  };

  const getAgentModeMeta = (ag: AgentInfo) => {
    const isBuiltin = ['build', 'plan', 'explore', 'general'].includes(ag.id);
    const mode = ag.mode?.toLowerCase();

    if (mode === 'subagent' || ag.id === 'explore') {
      return {
        label: t`Subagent`,
        bg: 'rgba(150, 150, 150, 0.15)',
        textColor: theme.colors.textMuted,
      };
    }
    if (mode === 'primary' || isBuiltin) {
      return {
        label: t`Primary`,
        bg: `${theme.colors.primary}18`,
        textColor: theme.colors.primary,
      };
    }
    return {
      label: t`Custom`,
      bg: 'rgba(234, 179, 8, 0.15)',
      textColor: '#eab308',
    };
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          testID="agent-mode-sheet"
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.sheetGround,
            { backgroundColor: surfaceBackground(theme.colors.surface) },
          ]}>
          <SheetFrame>
            <View style={styles.header}>
              <SheetHeading
                title={t`Agent Mode`}
                caption={t`Choose the specialized agent for this task`}
              />
              <PressableScale
                testID="agent-mode-close"
                onPress={onClose}
                style={styles.closeBtn}
                accessibilityLabel={t`Close`}>
                <X size={18} color={theme.colors.textMuted} />
              </PressableScale>
            </View>

            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
              </View>
            ) : (
              <ScrollView style={styles.scrollList} contentContainerStyle={styles.scrollContent}>
                <View style={styles.agentList}>
                  {displayAgents.map((ag: AgentInfo) => {
                    const isSelected = selectedAgent === ag.id;
                    const meta = getAgentModeMeta(ag);
                    const accentColor = ag.color || (isSelected ? theme.colors.primary : theme.colors.textMuted);

                    return (
                      <PressableScale
                        key={ag.id}
                        onPress={() => onSelectAgent(ag.id)}
                        style={[
                          styles.agentCard,
                          {
                            borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                            backgroundColor: isSelected
                              ? `${theme.colors.primary}12`
                              : surfaceBackground(theme.colors.surfaceRaised),
                          },
                        ]}>
                        <View style={styles.agentCardHeader}>
                          <View style={styles.agentTitleRow}>
                            {getAgentIcon(ag.id, accentColor)}
                            <Text
                              variant="bodySmall"
                              weight="bold"
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
                          {isSelected ? <Check size={16} color={theme.colors.primary} /> : null}
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
                </View>
              </ScrollView>
            )}
          </SheetFrame>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetGround: {
    maxHeight: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(150,150,150,0.2)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 999,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollList: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  agentList: {
    gap: 10,
    paddingTop: 4,
  },
  agentCard: {
    padding: 14,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    gap: 6,
  },
  agentCardHeader: {
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
    fontSize: 14,
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
    fontSize: 12,
    lineHeight: 17,
  },
});
