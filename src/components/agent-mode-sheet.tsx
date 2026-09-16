import { memo, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, ActivityIndicator, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Check, Sparkles, X } from 'lucide-react-native';
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

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    getAgentCatalog()
      .then((cat) => {
        if (active && cat?.agents) setAgents(cat.agents);
      })
      .catch((err) => {
        console.warn('Failed to load agent catalog:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
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
              <PressableScale onPress={onClose} style={styles.closeBtn}>
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
                  {agents.map((ag) => {
                    const isSelected = selectedAgent === ag.id;
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
                            <Sparkles
                              size={16}
                              color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                            />
                            <Text
                              variant="bodySmall"
                              color={isSelected ? theme.colors.primary : theme.colors.text}
                              style={styles.agentName}>
                              {ag.name || ag.id}
                            </Text>
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
    borderRadius: 20,
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
    borderRadius: 14,
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
  },
  agentName: {
    fontWeight: '700',
    fontSize: 14,
  },
  agentDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
});
