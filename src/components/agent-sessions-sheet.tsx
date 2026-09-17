import { Fragment, memo, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, FlatList } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Check, GitFork, Plus, X, Folder } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { Input } from '@/components/themed-input';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { ThemedSurface } from '@/components/themed-surface';
import { LADDER, SettingsSeparator } from '@/components/settings-chrome';
import { appChrome } from '@/constants/appearance';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import type { AgentProject, AgentSessionInfo } from '@/lib/agent-session';

/**
 * Every agent session on this workspace, as a native form sheet route.
 *
 * Presentational: the route above it reads the list and the handlers out of
 * `stores/agent-sheet-bridge.ts` and hands them down, so this file still tests
 * and reads as a component rather than as a screen.
 */
export interface AgentSessionsSheetProps {
  sessions: readonly AgentSessionInfo[];
  activeAsid?: string;
  knownProjects?: readonly AgentProject[];
  activeDirectory?: string;
  onSelectSession: (asid: string) => void;
  onCreateNewSession?: () => void;
  onClose: () => void;
}

export const AgentSessionsSheet = memo(function AgentSessionsSheet({
  sessions,
  activeAsid,
  knownProjects,
  onSelectSession,
  onCreateNewSession,
  onClose,
}: AgentSessionsSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();
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
            p.canonical === s.directory || (p.canonical && s.directory?.startsWith(p.canonical))
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
      return session.directory.split('/').filter(Boolean).pop();
    }
    return undefined;
  };

  // Filter root sessions by project and search query
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
    // One ground and one layout column: the two subviews a native form sheet
    // lays itself out around. See `sheet-ground.tsx`.
    <SheetFrame testID="agent-sessions-sheet" tint="background">
      <View collapsable={false} style={styles.sheetLayout}>
        {/* Pinned Top Navigation Bar */}
        <View style={styles.fixedTop}>
          <SheetHandle />

          <View style={styles.header}>
            <View style={[styles.headerCopy, plate]}>
              <Text variant="subheading" style={styles.headerTitle}>
                {t`All Sessions`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {`${sessions.length} ${sessions.length === 1 ? t`session` : t`sessions`}`}
              </Text>
            </View>

            {onCreateNewSession ? (
              <GlassChrome face="sheet" style={styles.headerButton}>
                <PressableScale
                  accessibilityLabel={t`New session`}
                  accessibilityRole="button"
                  onPress={() => {
                    onClose();
                    onCreateNewSession();
                  }}
                  style={styles.headerButtonHit}>
                  <Plus size={19} color={theme.colors.text} strokeWidth={2} />
                </PressableScale>
              </GlassChrome>
            ) : null}

            <GlassChrome face="sheet" style={styles.headerButton}>
              <PressableScale
                testID="agent-sessions-close"
                accessibilityLabel={t`Close`}
                accessibilityRole="button"
                onPress={onClose}
                style={styles.headerButtonHit}>
                <X size={19} color={theme.colors.text} strokeWidth={2} />
              </PressableScale>
            </GlassChrome>
          </View>

          {/* Unified Search Input */}
          <Input
            accessibilityLabel={t`Search sessions`}
            placeholder={t`Search sessions...`}
            value={searchQuery}
            onChangeText={setSearchQuery}
            variant="outline"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Project Filter Pills */}
          {projectsList.length > 0 ? (
            <View style={styles.projectFilterContainer}>
              <ThemedSurface
                slot="tabs.background"
                baseColor={theme.colors.surface}
                style={styles.projectFilterStrip}>
                <FlatList
                  horizontal
                  data={projectsList}
                  keyExtractor={(p) => p.id}
                  extraData={selectedProjectId}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.projectFilterRow}
                  ListHeaderComponent={
                    <PressableScale
                      onPress={() => setSelectedProjectId(null)}
                      style={[
                        styles.projectFilterPill,
                        !selectedProjectId && {
                          backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                        },
                      ]}>
                      <Text
                        variant="caption"
                        color={!selectedProjectId ? theme.colors.primary : theme.colors.textMuted}
                        style={styles.projectFilterText}>
                        {t`All Projects`}
                      </Text>
                    </PressableScale>
                  }
                  renderItem={({ item: p }) => {
                    const isSelected = selectedProjectId === p.id;
                    return (
                      <PressableScale
                        onPress={() => setSelectedProjectId(isSelected ? null : p.id)}
                        style={[
                          styles.projectFilterPill,
                          isSelected && {
                            backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                          },
                        ]}>
                        <Folder
                          size={12}
                          color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                        />
                        <Text
                          variant="caption"
                          color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                          numberOfLines={1}
                          style={styles.projectFilterText}>
                          {p.name}
                        </Text>
                      </PressableScale>
                    );
                  }}
                />
              </ThemedSurface>
            </View>
          ) : null}
        </View>

        {/* Scrollable Sessions List */}
        <ScrollView
          style={styles.scrollViewport}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: LADDER.section + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled">
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
                <ThemedSurface
                  key={root.asid}
                  slot="cards.decoration"
                  baseColor={theme.colors.surface}
                  style={[
                    styles.sessionCard,
                    isRootActive && {
                      borderColor: theme.colors.primary,
                      borderWidth: 1.5,
                    },
                  ]}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityState={{ selected: isRootActive }}
                    onPress={() => {
                      onSelectSession(root.asid);
                      onClose();
                    }}
                    style={styles.rootPressable}>
                    <View style={styles.cardHeader}>
                      <View style={styles.badgeRow}>
                        <View
                          style={[
                            styles.agentBadge,
                            { backgroundColor: withAlpha(theme.colors.primary, 0.09) },
                          ]}>
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
                            {
                              backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                            },
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
                              {
                                backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                              },
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
                              {
                                backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                              },
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
                          <Text
                            variant="caption"
                            color={theme.colors.textMuted}
                            style={styles.timeText}>
                            {formatTime(root.updated_ms)}
                          </Text>
                        ) : null}

                        {isRootActive ? <Check size={16} color={theme.colors.primary} /> : null}
                      </View>
                    </View>

                    <Text
                      variant="bodySmall"
                      weight="semibold"
                      color={isRootActive ? theme.colors.primary : theme.colors.text}
                      numberOfLines={2}
                      style={styles.sessionTitle}>
                      {root.title || root.asid}
                    </Text>
                  </PressableScale>

                  {/* Subagents, on the recessed fill token rather than the
                      2%-black wash this used to be: black at 2% is invisible on
                      a dark theme, which is where this list spends most of its
                      life. */}
                  {subs.length > 0 ? (
                    <View
                      style={{ backgroundColor: surfaceBackground(theme.colors.surfaceRaised) }}>
                      {subs.map((sub, idx) => {
                        const isSubActive = sub.asid === activeAsid;
                        return (
                          <Fragment key={sub.asid}>
                            <SettingsSeparator />
                            <PressableScale
                              accessibilityRole="button"
                              accessibilityState={{ selected: isSubActive }}
                              onPress={() => {
                                onSelectSession(sub.asid);
                                onClose();
                              }}
                              style={[
                                styles.subagentRow,
                                isSubActive && {
                                  backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                                },
                              ]}>
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
                                    { backgroundColor: withAlpha(theme.colors.primary, 0.08) },
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
                            </PressableScale>
                          </Fragment>
                        );
                      })}
                    </View>
                  ) : null}
                </ThemedSurface>
              );
            })
          )}
        </ScrollView>
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
  projectFilterContainer: {
    marginTop: 2,
  },
  projectFilterStrip: {
    padding: 4,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  projectFilterRow: {
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    minHeight: 32,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  projectFilterText: {
    fontSize: 12,
    fontWeight: '500',
  },
  scrollViewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
    gap: LADDER.snug,
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionCard: {
    borderRadius: appChrome.radius.popover,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  rootPressable: {
    padding: 14,
    gap: 8,
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
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  agentBadgeText: {
    fontWeight: '600',
    fontSize: 11,
  },
  modelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  modelBadgeText: {
    fontSize: 11,
  },
  projectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
    maxWidth: 140,
  },
  projectBadgeText: {
    fontSize: 11,
  },
  subCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  subCountText: {
    fontSize: 11,
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
    lineHeight: 19,
    includeFontPadding: false,
  },
  dirText: {
    fontSize: 11,
  },
  subagentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  subLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  subagentBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
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
