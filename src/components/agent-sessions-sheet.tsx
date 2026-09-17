import { memo, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, TextInput, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Bot, Check, GitFork, Plus, Search, X, Clock, Folder } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { AgentProject, AgentSessionInfo } from '@/lib/agent-session';

export interface AgentSessionsSheetProps {
  visible: boolean;
  sessions: AgentSessionInfo[];
  activeAsid?: string;
  knownProjects?: AgentProject[];
  activeDirectory?: string;
  onSelectSession: (asid: string) => void;
  onCreateNewSession?: () => void;
  onClose: () => void;
}

export const AgentSessionsSheet = memo(function AgentSessionsSheet({
  visible,
  sessions,
  activeAsid,
  knownProjects,
  activeDirectory,
  onSelectSession,
  onCreateNewSession,
  onClose,
}: AgentSessionsSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

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

  // Derive unique projects list from knownProjects + sessions
  const projectsList = useMemo(() => {
    const map = new Map<string, { id: string; name: string; canonical?: string }>();
    if (knownProjects) {
      for (const p of knownProjects) {
        map.set(p.id, { id: p.id, name: p.name || p.canonical, canonical: p.canonical });
      }
    }
    // Also include any project_id or directory from sessions if not in knownProjects
    for (const s of sessions) {
      if (s.project_id && !map.has(s.project_id)) {
        const name = s.directory
          ? s.directory.split('/').filter(Boolean).pop() || s.project_id
          : s.project_id;
        map.set(s.project_id, {
          id: s.project_id,
          name,
          canonical: s.directory,
        });
      } else if (s.directory && !s.project_id) {
        const alreadyMatched = Array.from(map.values()).some(
          (p) =>
            p.canonical === s.directory ||
            (p.canonical && s.directory?.startsWith(p.canonical))
        );
        if (!alreadyMatched) {
          const dirName = s.directory.split('/').filter(Boolean).pop() || s.directory;
          map.set(s.directory, { id: s.directory, name: dirName, canonical: s.directory });
        }
      }
    }
    return Array.from(map.values());
  }, [knownProjects, sessions]);

  // Helper to get display project name for a session
  const getSessionProjectName = (session: AgentSessionInfo): string | undefined => {
    if (session.project_id) {
      const match = projectsList.find((p) => p.id === session.project_id);
      if (match) return match.name;
    }
    if (session.directory) {
      const match = projectsList.find(
        (p) =>
          p.canonical === session.directory ||
          (p.canonical && session.directory?.startsWith(p.canonical))
      );
      if (match) return match.name;
      return session.directory.split('/').filter(Boolean).pop() || session.directory;
    }
    return undefined;
  };

  // Filtered roots based on project filter & search query
  const filteredRoots = useMemo(() => {
    let list = rootSessions;
    if (selectedProjectId) {
      const targetProj = projectsList.find((p) => p.id === selectedProjectId);
      list = list.filter((root) => {
        if (root.project_id && root.project_id === selectedProjectId) return true;
        if (targetProj?.canonical && root.directory) {
          return (
            root.directory === targetProj.canonical ||
            root.directory.startsWith(targetProj.canonical)
          );
        }
        if (root.directory && root.directory === selectedProjectId) return true;
        return false;
      });
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((root) => {
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
  }, [rootSessions, subagentMap, searchQuery, selectedProjectId, projectsList]);

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

          {/* Project Filter Strip */}
          {projectsList.length > 0 ? (
            <View style={styles.projectFilterContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.projectFilterRow}>
                <PressableScale
                  onPress={() => setSelectedProjectId(null)}
                  style={[
                    styles.projectFilterPill,
                    {
                      borderColor: !selectedProjectId ? theme.colors.primary : theme.colors.border,
                      backgroundColor: !selectedProjectId
                        ? theme.colors.primary
                        : surfaceBackground(theme.colors.surfaceRaised),
                    },
                  ]}>
                  <Text
                    variant="caption"
                    color={!selectedProjectId ? '#fff' : theme.colors.textMuted}
                    style={styles.projectFilterText}>
                    {t`All Projects`}
                  </Text>
                </PressableScale>

                {projectsList.map((p) => {
                  const isSelected = selectedProjectId === p.id;
                  return (
                    <PressableScale
                      key={p.id}
                      onPress={() => setSelectedProjectId(isSelected ? null : p.id)}
                      style={[
                        styles.projectFilterPill,
                        {
                          borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                          backgroundColor: isSelected
                            ? theme.colors.primary
                            : surfaceBackground(theme.colors.surfaceRaised),
                        },
                      ]}>
                      <Folder
                        size={11}
                        color={isSelected ? '#fff' : theme.colors.textMuted}
                      />
                      <Text
                        variant="caption"
                        color={isSelected ? '#fff' : theme.colors.text}
                        numberOfLines={1}
                        style={styles.projectFilterText}>
                        {p.name}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

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
                const projectName = getSessionProjectName(root);

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

                          {projectName ? (
                            <View
                              style={[
                                styles.projectBadge,
                                { backgroundColor: surfaceBackground(theme.colors.surface) },
                              ]}>
                              <Folder size={10} color={theme.colors.textMuted} />
                              <Text
                                variant="caption"
                                color={theme.colors.textMuted}
                                numberOfLines={1}
                                style={styles.projectBadgeText}>
                                {projectName}
                              </Text>
                            </View>
                          ) : null}

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
    borderRadius: 999,
    borderCurve: 'continuous',
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
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  projectFilterContainer: {
    marginBottom: 8,
  },
  projectFilterRow: {
    paddingHorizontal: 16,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  projectFilterText: {
    fontSize: 11,
    fontWeight: '500',
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
    borderRadius: 16,
    borderCurve: 'continuous',
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
    flexWrap: 'wrap',
    flex: 1,
  },
  agentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  agentBadgeText: {
    fontWeight: '600',
    fontSize: 11,
  },
  modelBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  modelBadgeText: {
    fontSize: 10,
  },
  projectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
    maxWidth: 120,
  },
  projectBadgeText: {
    fontSize: 10,
  },
  subCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
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
    borderRadius: 12,
    borderCurve: 'continuous',
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
    borderRadius: 999,
    borderCurve: 'continuous',
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
