import { memo, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, TextInput, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Bot, Check, GitFork, Plus, Search, X, Clock } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { AgentSessionInfo } from '@/lib/agent-session';

export interface AgentSessionsSheetProps {
  visible: boolean;
  sessions: AgentSessionInfo[];
  activeAsid?: string;
  onSelectSession: (asid: string) => void;
  onCreateNewSession?: () => void;
  onClose: () => void;
}

export const AgentSessionsSheet = memo(function AgentSessionsSheet({
  visible,
  sessions,
  activeAsid,
  onSelectSession,
  onCreateNewSession,
  onClose,
}: AgentSessionsSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [searchQuery, setSearchQuery] = useState('');

  // Group sessions: roots and their subagents
  const { rootSessions, subagentMap } = useMemo(() => {
    const roots: AgentSessionInfo[] = [];
    const subMap = new Map<string, AgentSessionInfo[]>();

    for (const s of sessions) {
      if (s.parent_id) {
        const existing = subMap.get(s.parent_id) || [];
        existing.push(s);
        subMap.set(s.parent_id, existing);
      } else {
        roots.push(s);
      }
    }

    // Sort roots by updated_ms descending
    roots.sort((a, b) => (b.updated_ms || 0) - (a.updated_ms || 0));

    return { rootSessions: roots, subagentMap: subMap };
  }, [sessions]);

  // Filtered roots based on search query
  const filteredRoots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rootSessions;
    return rootSessions.filter((root) => {
      const matchRoot =
        (root.title && root.title.toLowerCase().includes(q)) ||
        (root.agent && root.agent.toLowerCase().includes(q)) ||
        (root.directory && root.directory.toLowerCase().includes(q)) ||
        root.asid.toLowerCase().includes(q);
      if (matchRoot) return true;
      const subs = subagentMap.get(root.asid) || [];
      return subs.some(
        (sub) =>
          (sub.title && sub.title.toLowerCase().includes(q)) ||
          (sub.agent && sub.agent.toLowerCase().includes(q)) ||
          sub.asid.toLowerCase().includes(q)
      );
    });
  }, [rootSessions, subagentMap, searchQuery]);

  const [nowMs] = useState(() => Date.now());

  const formatTime = (ms: number) => {
    if (!ms) return '';
    const diffMin = Math.round((nowMs - ms) / 60000);
    if (diffMin < 1) return t`just now`;
    if (diffMin < 60) return `${diffMin}m`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d`;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          testID="agent-sessions-sheet"
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheetGround, { backgroundColor: theme.colors.surface }]}>
          {/* Top handle pill */}
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerTitleArea}>
              <Text variant="heading" style={styles.headerTitle}>
                {t`All Sessions`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted} style={styles.headerSubtitle}>
                {`${sessions.length} ${sessions.length === 1 ? t`session` : t`sessions`}`}
              </Text>
            </View>

            <View style={styles.headerActions}>
              {onCreateNewSession ? (
                <PressableScale
                  onPress={() => {
                    onClose();
                    onCreateNewSession();
                  }}
                  style={[styles.newBtn, { backgroundColor: theme.colors.primary }]}>
                  <Plus size={14} color="#fff" strokeWidth={2.5} />
                  <Text variant="caption" color="#fff" style={styles.newBtnText}>
                    {t`New`}
                  </Text>
                </PressableScale>
              ) : null}

              <PressableScale
                testID="agent-sessions-close"
                onPress={onClose}
                style={styles.closeBtn}
                accessibilityLabel={t`Close`}>
                <X size={18} color={theme.colors.textMuted} />
              </PressableScale>
            </View>
          </View>

          {/* Search Input */}
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                borderColor: theme.colors.border,
              },
            ]}>
            <Search size={14} color={theme.colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t`Search sessions...`}
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.searchInput, { color: theme.colors.text }]}
              clearButtonMode="while-editing"
            />
          </View>

          <ScrollView style={styles.scrollList} contentContainerStyle={styles.scrollContent}>
            {filteredRoots.length === 0 ? (
              <View style={styles.emptyState}>
                <Text variant="caption" color={theme.colors.textMuted}>
                  {searchQuery ? t`No sessions found` : t`No sessions yet`}
                </Text>
              </View>
            ) : (
              filteredRoots.map((root) => {
                const subs = subagentMap.get(root.asid) || [];
                const isRootActive = root.asid === activeAsid;

                return (
                  <View key={root.asid} style={styles.sessionGroup}>
                    {/* Main Root Session Card */}
                    <PressableScale
                      onPress={() => {
                        onSelectSession(root.asid);
                        onClose();
                      }}
                      style={[
                        styles.rootCard,
                        {
                          borderColor: isRootActive ? theme.colors.primary : theme.colors.border,
                          backgroundColor: isRootActive
                            ? `${theme.colors.primary}12`
                            : surfaceBackground(theme.colors.surfaceRaised),
                        },
                      ]}>
                      <View style={styles.cardHeader}>
                        <View style={styles.badgeRow}>
                          <View
                            style={[
                              styles.agentBadge,
                              { backgroundColor: `${theme.colors.primary}18` },
                            ]}>
                            <Bot size={12} color={theme.colors.primary} />
                            <Text
                              variant="caption"
                              color={theme.colors.primary}
                              style={styles.agentBadgeText}>
                              {root.agent || 'build'}
                            </Text>
                          </View>

                          <View
                            style={[
                              styles.modelBadge,
                              { backgroundColor: surfaceBackground(theme.colors.surface) },
                            ]}>
                            <Text
                              variant="caption"
                              color={theme.colors.textMuted}
                              style={styles.modelBadgeText}>
                              {root.model?.model_id || 'big-pickle'}
                            </Text>
                          </View>

                          {subs.length > 0 ? (
                            <View
                              style={[
                                styles.subCountBadge,
                                { backgroundColor: surfaceBackground(theme.colors.surface) },
                              ]}>
                              <GitFork size={10} color={theme.colors.textMuted} />
                              <Text
                                variant="caption"
                                color={theme.colors.textMuted}
                                style={styles.subCountText}>
                                {subs.length}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.headerRight}>
                          {root.updated_ms ? (
                            <View style={styles.timeRow}>
                              <Clock size={11} color={theme.colors.textMuted} />
                              <Text
                                variant="caption"
                                color={theme.colors.textMuted}
                                style={styles.timeText}>
                                {formatTime(root.updated_ms)}
                              </Text>
                            </View>
                          ) : null}

                          {isRootActive ? <Check size={16} color={theme.colors.primary} /> : null}
                        </View>
                      </View>

                      <Text
                        variant="bodySmall"
                        color={isRootActive ? theme.colors.primary : theme.colors.text}
                        numberOfLines={2}
                        style={styles.sessionTitle}>
                        {root.title || root.asid}
                      </Text>

                      {root.directory ? (
                        <Text
                          variant="caption"
                          color={theme.colors.textMuted}
                          numberOfLines={1}
                          style={styles.dirText}>
                          {root.directory}
                        </Text>
                      ) : null}
                    </PressableScale>

                    {/* Subagents nested list */}
                    {subs.length > 0 ? (
                      <View style={styles.subsContainer}>
                        {subs.map((sub) => {
                          const isSubActive = sub.asid === activeAsid;
                          return (
                            <PressableScale
                              key={sub.asid}
                              onPress={() => {
                                onSelectSession(sub.asid);
                                onClose();
                              }}
                              style={[
                                styles.subCard,
                                {
                                  borderColor: isSubActive
                                    ? theme.colors.primary
                                    : theme.colors.border,
                                  backgroundColor: isSubActive
                                    ? `${theme.colors.primary}12`
                                    : surfaceBackground(theme.colors.surfaceRaised),
                                },
                              ]}>
                              <View style={styles.subRow}>
                                <View style={styles.subLeft}>
                                  <GitFork
                                    size={13}
                                    color={
                                      isSubActive ? theme.colors.primary : theme.colors.textMuted
                                    }
                                  />
                                  <View
                                    style={[
                                      styles.subagentBadge,
                                      { backgroundColor: `${theme.colors.primary}14` },
                                    ]}>
                                    <Text
                                      variant="caption"
                                      color={theme.colors.primary}
                                      style={styles.subagentBadgeText}>
                                      {sub.agent || 'subagent'}
                                    </Text>
                                  </View>
                                  <Text
                                    variant="caption"
                                    color={isSubActive ? theme.colors.primary : theme.colors.text}
                                    numberOfLines={1}
                                    style={styles.subTitle}>
                                    {sub.title || sub.asid}
                                  </Text>
                                </View>

                                {isSubActive ? (
                                  <Check size={14} color={theme.colors.primary} />
                                ) : null}
                              </View>
                            </PressableScale>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
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
    maxHeight: '85%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(150,150,150,0.2)',
    overflow: 'hidden',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.35)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTitleArea: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  newBtnText: {
    fontWeight: '600',
    fontSize: 12,
  },
  closeBtn: {
    padding: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  scrollList: {
    maxHeight: 480,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  sessionGroup: {
    gap: 6,
  },
  rootCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  agentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  agentBadgeText: {
    fontWeight: '600',
    fontSize: 11,
  },
  modelBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modelBadgeText: {
    fontSize: 10,
  },
  subCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  subCountText: {
    fontSize: 10,
    fontWeight: '500',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  timeText: {
    fontSize: 11,
  },
  sessionTitle: {
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 19,
  },
  dirText: {
    fontSize: 11,
  },
  subsContainer: {
    paddingLeft: 18,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(150,150,150,0.2)',
    marginLeft: 12,
    gap: 4,
  },
  subCard: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  subagentBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  subagentBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  subTitle: {
    fontSize: 12,
    flex: 1,
  },
});
