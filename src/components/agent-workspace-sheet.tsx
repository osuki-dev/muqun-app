import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, Pressable } from 'react-native';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { Check, Folder, FolderGit2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { Input } from '@/components/themed-input';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { LADDER, SectionLabel, SettingsCard } from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  buildAgentCacheKey,
  getAgentDirectories,
  getAgentProjects,
  getCachedAgentProjectsSync,
  type AgentProject,
  type DirectoryItem,
} from '@/lib/agent-session';

export interface AgentWorkspaceSheetProps {
  visible: boolean;
  activeDirectory?: string;
  sessionId?: string;
  initialProjects?: AgentProject[];
  onSelectWorkspace: (directory: string, project?: AgentProject) => void;
  onClose: () => void;
}

export const AgentWorkspaceSheet = memo(function AgentWorkspaceSheet({
  visible,
  activeDirectory,
  sessionId,
  initialProjects,
  onSelectWorkspace,
  onClose,
}: AgentWorkspaceSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();

  const [projects, setProjects] = useState<AgentProject[]>(() => {
    if (initialProjects && initialProjects.length > 0) {
      return initialProjects.filter((p) => p.id !== 'global' && p.canonical !== '/');
    }
    const cached = getCachedAgentProjectsSync(buildAgentCacheKey('projects', null, sessionId));
    if (cached && cached.length > 0) {
      return cached.filter((p) => p.id !== 'global' && p.canonical !== '/');
    }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DirectoryItem[]>([]);

  useEffect(() => {
    if (initialProjects && initialProjects.length > 0) {
      const valid = initialProjects.filter((p) => p.id !== 'global' && p.canonical !== '/');
      setProjects((prev) => (prev.length === 0 ? valid : prev));
    }
  }, [initialProjects]);

  const loadProjects = useCallback(async () => {
    if (projects.length === 0 && (!initialProjects || initialProjects.length === 0)) {
      setLoading(true);
    }
    try {
      const list = await getAgentProjects(sessionId);
      const valid = (list || []).filter((p) => p.id !== 'global' && p.canonical !== '/');
      setProjects(valid);
    } catch {
      // quiet fail
    } finally {
      setLoading(false);
    }
  }, [sessionId, projects.length, initialProjects]);

  useEffect(() => {
    if (visible) {
      loadProjects();
      setSearchQuery('');
      setSuggestions([]);
    }
  }, [visible, loadProjects]);

  // Autocomplete suggestions when typing custom path
  useEffect(() => {
    if (!searchQuery.trim().startsWith('/')) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const fetchDirs = async () => {
      try {
        const hits = await getAgentDirectories(searchQuery.trim(), undefined, sessionId);
        if (active) setSuggestions(hits);
      } catch {
        if (active) setSuggestions([]);
      }
    };
    const timer = setTimeout(fetchDirs, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, sessionId]);

  const filteredProjects = useMemo(() => {
    const valid = projects.filter((p) => p.id !== 'global' && p.canonical !== '/');
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.startsWith('/')) return valid;
    return valid.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.canonical.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  const handleSelect = (directory: string, project?: AgentProject) => {
    onSelectWorkspace(directory, project);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          testID="agent-workspace-sheet"
          onPress={(e) => e.stopPropagation()}
          style={styles.sheetContainer}>
          <SheetFrame tint="background">
            <View collapsable={false} style={styles.sheetLayout}>
              {/* Pinned Top Navigation Bar */}
              <View style={styles.fixedTop}>
                <SheetHandle style={styles.sheetHandle} />

                <View style={styles.header}>
                  <View style={[styles.headerCopy, plate]}>
                    <Text variant="subheading" style={styles.headerTitle}>
                      {t`Workspaces & Projects`}
                    </Text>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      {t`Select or enter working repository`}
                    </Text>
                  </View>

                  <GlassChrome face="sheet" style={styles.headerButton}>
                    <PressableScale
                      testID="agent-workspace-close"
                      accessibilityRole="button"
                      accessibilityLabel={t`Close`}
                      onPress={onClose}
                      style={styles.headerButtonHit}>
                      <X size={19} color={theme.colors.text} strokeWidth={2} />
                    </PressableScale>
                  </GlassChrome>
                </View>

                {/* Unified Search Input */}
                <Input
                  testID="agent-workspace-search-input"
                  accessibilityLabel={t`Filter projects or path`}
                  placeholder={t`Filter projects or path`}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  variant="outline"
                  autoCapitalize="none"
                  autoCorrect={false}
                  numberOfLines={1}
                  multiline={false}
                />
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
                  ]}
                  keyboardShouldPersistTaps="handled">
                  {/* Custom Project Directory / Direct Path Input */}
                  {searchQuery.trim().length > 0 &&
                  (searchQuery.trim().startsWith('/') || searchQuery.trim().startsWith('~')) ? (
                    <View style={styles.sectionBlock}>
                      <SectionLabel
                        title={t`CUSTOM PROJECT DIRECTORY`}
                        color={theme.colors.textMuted}
                      />
                      <SettingsCard>
                        <PressableScale
                          testID="agent-workspace-custom-path-btn"
                          onPress={() => handleSelect(searchQuery.trim())}
                          style={styles.itemRow}>
                          <View style={styles.itemRowLeft}>
                            <FolderGit2 size={18} color={theme.colors.primary} />
                            <View style={styles.itemTextCol}>
                              <Text
                                variant="bodySmall"
                                weight="semibold"
                                color={theme.colors.primary}
                                numberOfLines={1}
                                style={styles.itemTitle}>
                                {t`Open as Project Workspace`}
                              </Text>
                              <Text
                                variant="caption"
                                color={theme.colors.textMuted}
                                numberOfLines={1}
                                style={styles.itemSub}>
                                {searchQuery.trim()}
                              </Text>
                            </View>
                          </View>
                        </PressableScale>
                      </SettingsCard>
                    </View>
                  ) : null}

                  {/* Suggestions for path */}
                  {suggestions.length > 0 ? (
                    <View style={styles.sectionBlock}>
                      <SectionLabel
                        title={t`DIRECTORY AUTOCOMPLETE`}
                        color={theme.colors.textMuted}
                      />
                      <SettingsCard>
                        {suggestions.map((item) => (
                          <PressableScale
                            key={item.path}
                            onPress={() => handleSelect(item.path)}
                            style={styles.itemRow}>
                            <View style={styles.itemRowLeft}>
                              <Folder size={16} color={theme.colors.primary} />
                              <Text
                                variant="bodySmall"
                                color={theme.colors.text}
                                numberOfLines={1}
                                style={styles.itemTitle}>
                                {item.name || item.path}
                              </Text>
                            </View>
                            <Text
                              variant="caption"
                              color={theme.colors.textMuted}
                              numberOfLines={1}
                              style={styles.pathSubtext}>
                              {item.path}
                            </Text>
                          </PressableScale>
                        ))}
                      </SettingsCard>
                    </View>
                  ) : null}

                  {/* Known Projects */}
                  <View style={styles.sectionBlock}>
                    <SectionLabel title={t`KNOWN REPOSITORIES`} color={theme.colors.textMuted} />
                    {filteredProjects.length === 0 ? (
                      <View style={styles.emptyContainer}>
                        <Text variant="caption" color={theme.colors.textMuted}>
                          <Trans>No projects found. Enter a custom path above.</Trans>
                        </Text>
                      </View>
                    ) : (
                      <SettingsCard>
                        {filteredProjects.map((p) => {
                          const isSelected = activeDirectory === p.canonical;

                          return (
                            <PressableScale
                              key={p.id}
                              accessibilityRole="button"
                              accessibilityState={{ selected: Boolean(isSelected) }}
                              onPress={() => handleSelect(p.canonical, p)}
                              style={[
                                styles.itemRow,
                                isSelected && {
                                  backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                                },
                              ]}>
                              <View style={styles.itemRowLeft}>
                                <FolderGit2
                                  size={18}
                                  color={isSelected ? theme.colors.primary : theme.colors.text}
                                />
                                <View style={styles.itemTextCol}>
                                  <Text
                                    variant="bodySmall"
                                    weight={isSelected ? 'semibold' : 'regular'}
                                    color={isSelected ? theme.colors.primary : theme.colors.text}
                                    numberOfLines={1}
                                    style={styles.itemTitle}>
                                    {p.name || p.id}
                                  </Text>
                                  <Text
                                    variant="caption"
                                    color={theme.colors.textMuted}
                                    numberOfLines={1}
                                    style={styles.itemSub}>
                                    {p.canonical}
                                  </Text>
                                </View>
                              </View>

                              {isSelected ? <Check size={18} color={theme.colors.primary} /> : null}
                            </PressableScale>
                          );
                        })}
                      </SettingsCard>
                    )}
                  </View>
                </ScrollView>
              )}
            </View>
          </SheetFrame>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  sheetLayout: {
    flexShrink: 1,
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
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
  scrollViewport: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
    gap: LADDER.section,
  },
  sectionBlock: {
    gap: LADDER.snug,
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
  },
  itemRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  itemTextCol: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    includeFontPadding: false,
  },
  itemSub: {
    fontSize: 11,
  },
  pathSubtext: {
    fontSize: 11,
    maxWidth: 150,
  },
});
