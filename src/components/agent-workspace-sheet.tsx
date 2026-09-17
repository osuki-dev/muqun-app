import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, Pressable, TextInput } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { Check, Folder, FolderGit2, Search, X } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  getAgentDirectories,
  getAgentProjects,
  type AgentProject,
  type DirectoryItem,
} from '@/lib/agent-session';

export interface AgentWorkspaceSheetProps {
  visible: boolean;
  activeDirectory?: string;
  sessionId?: string;
  onSelectWorkspace: (directory: string, project?: AgentProject) => void;
  onClose: () => void;
}

export const AgentWorkspaceSheet = memo(function AgentWorkspaceSheet({
  visible,
  activeDirectory,
  sessionId,
  onSelectWorkspace,
  onClose,
}: AgentWorkspaceSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DirectoryItem[]>([]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getAgentProjects(sessionId);
      setProjects(list);
    } catch {
      // quiet fail
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

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
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.startsWith('/')) return projects;
    return projects.filter(
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
          style={[styles.sheetGround, { backgroundColor: theme.colors.surface }]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.headerIconBox,
                  { backgroundColor: `${theme.colors.primary}18` },
                ]}>
                <FolderGit2 size={18} color={theme.colors.primary} />
              </View>
              <View>
                <Text variant="heading" style={styles.headerTitle}>
                  <Trans>Workspaces & Projects</Trans>
                </Text>
                <Text variant="caption" color={theme.colors.textMuted}>
                  <Trans>Select or enter working repository</Trans>
                </Text>
              </View>
            </View>

            <PressableScale
              testID="agent-workspace-close"
              onPress={onClose}
              accessibilityLabel={t`Close`}
              style={[
                styles.closeBtn,
                { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              ]}>
              <X size={16} color={theme.colors.text} />
            </PressableScale>
          </View>

          {/* Search / Path Input Bar */}
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                borderColor: theme.colors.border,
              },
            ]}>
            <Search size={15} color={theme.colors.textMuted} />
            <TextInput
              testID="agent-workspace-search-input"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t`Filter projects or type path (e.g. /home/...)`}
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.searchInput, { color: theme.colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <X size={14} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={styles.scrollList}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {/* Custom Path Quick Pick */}
            {searchQuery.trim().startsWith('/') ? (
              <View style={styles.section}>
                <Text variant="caption" weight="semibold" color={theme.colors.textMuted} style={styles.sectionTitle}>
                  <Trans>Custom Directory</Trans>
                </Text>
                <PressableScale
                  testID="agent-workspace-custom-apply"
                  onPress={() => handleSelect(searchQuery.trim())}
                  style={[
                    styles.projectCard,
                    {
                      backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                      borderColor: theme.colors.primary,
                    },
                  ]}>
                  <Folder size={18} color={theme.colors.primary} />
                  <View style={styles.projectInfo}>
                    <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
                      {t`Use path:`} {searchQuery.trim()}
                    </Text>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      <Trans>Set as working directory for new sessions</Trans>
                    </Text>
                  </View>
                </PressableScale>

                {/* Subdirectory Suggestions */}
                {suggestions.length > 0 ? (
                  <View style={styles.suggestionsContainer}>
                    <Text variant="caption" color={theme.colors.textMuted} style={styles.suggestionTitle}>
                      <Trans>Matching subdirectories:</Trans>
                    </Text>
                    {suggestions.slice(0, 8).map((dir) => (
                      <PressableScale
                        key={dir.path}
                        onPress={() => setSearchQuery(dir.path)}
                        style={[
                          styles.suggestionRow,
                          { borderBottomColor: theme.colors.border },
                        ]}>
                        <Folder size={13} color={theme.colors.textMuted} />
                        <Text
                          variant="caption"
                          color={theme.colors.text}
                          numberOfLines={1}
                          style={styles.suggestionText}>
                          {dir.path}
                        </Text>
                      </PressableScale>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Known Projects */}
            <View style={styles.section}>
              <Text variant="caption" weight="semibold" color={theme.colors.textMuted} style={styles.sectionTitle}>
                <Trans>Known Projects ({filteredProjects.length})</Trans>
              </Text>

              {filteredProjects.map((project) => {
                const isSelected = activeDirectory === project.canonical;
                return (
                  <PressableScale
                    key={project.id}
                    testID={`agent-workspace-item-${project.name}`}
                    onPress={() => handleSelect(project.canonical, project)}
                    style={[
                      styles.projectCard,
                      {
                        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                        borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                        borderWidth: isSelected ? 1.5 : 1,
                      },
                    ]}>
                    <View
                      style={[
                        styles.projectIconBox,
                        {
                          backgroundColor: isSelected
                            ? `${theme.colors.primary}18`
                            : `${theme.colors.textMuted}14`,
                        },
                      ]}>
                      {project.vcs === 'git' ? (
                        <FolderGit2
                          size={18}
                          color={isSelected ? theme.colors.primary : theme.colors.text}
                        />
                      ) : (
                        <Folder
                          size={18}
                          color={isSelected ? theme.colors.primary : theme.colors.text}
                        />
                      )}
                    </View>

                    <View style={styles.projectInfo}>
                      <View style={styles.projectNameRow}>
                        <Text variant="bodySmall" weight="bold" color={theme.colors.text}>
                          {project.name}
                        </Text>
                        {project.vcs ? (
                          <View
                            style={[
                              styles.vcsBadge,
                              { backgroundColor: `${theme.colors.primary}14` },
                            ]}>
                            <Text variant="caption" weight="semibold" color={theme.colors.primary} style={styles.vcsText}>
                              {project.vcs.toUpperCase()}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        variant="caption"
                        color={theme.colors.textMuted}
                        numberOfLines={1}
                        style={styles.projectPath}>
                        {project.canonical}
                      </Text>
                    </View>

                    {isSelected ? (
                      <View
                        style={[
                          styles.checkCircle,
                          { backgroundColor: theme.colors.primary },
                        ]}>
                        <Check size={12} color="#fff" />
                      </View>
                    ) : null}
                  </PressableScale>
                );
              })}

              {!loading && filteredProjects.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    <Trans>No matching projects found</Trans>
                  </Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
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
  sheetGround: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    maxHeight: '85%',
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBox: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    letterSpacing: -0.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: 1,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  scrollList: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingBottom: 20,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4,
    marginBottom: 2,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    gap: 12,
  },
  projectIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectInfo: {
    flex: 1,
    gap: 2,
  },
  projectNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vcsBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  vcsText: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
  projectPath: {
    fontSize: 11,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionsContainer: {
    marginTop: 6,
    paddingHorizontal: 6,
  },
  suggestionTitle: {
    fontSize: 11,
    marginBottom: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: {
    flex: 1,
    fontSize: 12,
  },
  emptyBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
