import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Folder, FolderGit2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneRow,
  SheetSceneSearch,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { fadeIn, listLayout, riseIn, STAGGER } from '@/lib/motion';
import {
  buildAgentCacheKey,
  getAgentDirectories,
  getAgentProjects,
  getCachedAgentProjectsSync,
  type AgentProject,
  type DirectoryItem,
} from '@/lib/agent-session';

const STAGGERED_ROWS = 8;

/**
 * Switch workspace, as a native form sheet route.
 *
 * `sheet-scene.tsx`'s shape: one ground, no cards, the left rule on the
 * repository the session is in. The filter doubles as a path field -- type a
 * `/` and the first group becomes the directory you typed.
 */
export interface AgentWorkspaceSheetProps {
  activeDirectory?: string;
  sessionId?: string;
  initialProjects?: readonly AgentProject[];
  onSelectWorkspace: (directory: string, project?: AgentProject) => void;
  onClose: () => void;
}

function withoutGlobalRoot(projects: readonly AgentProject[]): AgentProject[] {
  return projects.filter((project) => project.id !== 'global' && project.canonical !== '/');
}

export const AgentWorkspaceSheet = memo(function AgentWorkspaceSheet({
  activeDirectory,
  sessionId,
  initialProjects,
  onSelectWorkspace,
  onClose,
}: AgentWorkspaceSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();

  const [projects, setProjects] = useState<AgentProject[]>(() => {
    if (initialProjects && initialProjects.length > 0) return withoutGlobalRoot(initialProjects);
    const cached = getCachedAgentProjectsSync(buildAgentCacheKey('projects', null, sessionId));
    return cached ? withoutGlobalRoot(cached) : [];
  });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DirectoryItem[]>([]);

  // A route mounts when it opens and unmounts when it is dismissed, so search
  // state starts clean and the project list is fetched once per opening.
  const loadedOnceRef = useRef(false);
  const loadProjects = useCallback(async () => {
    if (!loadedOnceRef.current) setLoading(true);
    try {
      const list = await getAgentProjects(sessionId);
      setProjects(withoutGlobalRoot(list ?? []));
      loadedOnceRef.current = true;
    } catch {
      // Quiet: the cached list, or the empty state, is still the right answer.
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadProjects().catch(() => {});
  }, [loadProjects]);

  useEffect(() => {
    if (!searchQuery.trim().startsWith('/')) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      getAgentDirectories(searchQuery.trim(), undefined, sessionId)
        .then((hits) => {
          if (active) setSuggestions(hits);
        })
        .catch(() => {
          if (active) setSuggestions([]);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, sessionId]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.startsWith('/')) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(q) ||
        project.canonical.toLowerCase().includes(q) ||
        project.id.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  const choose = (directory: string, project?: AgentProject) => {
    onSelectWorkspace(directory, project);
    onClose();
  };

  const typedPath = searchQuery.trim();
  const showTypedPath =
    typedPath.length > 0 && (typedPath.startsWith('/') || typedPath.startsWith('~'));
  let rowIndex = 0;

  return (
    <SheetScene
      testID="agent-workspace-sheet"
      title={t`Switch workspace`}
      caption={activeDirectory}
      header={
        <SheetSceneSearch
          testID="agent-workspace-search-input"
          accessibilityLabel={t`Filter projects or type a path`}
          placeholder={t`Filter projects, or type a path`}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      }>
      {loading ? (
        <View style={styles.loading}>
          <Spinner size="lg" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {showTypedPath ? (
            <Animated.View layout={listLayout('short')}>
              <SheetSceneGroupHeading title={t`Open this path`} first />
              <SheetSceneRow
                testID="agent-workspace-custom-path-btn"
                title={typedPath}
                caption={t`Open as a project workspace`}
                leading={<FolderGit2 size={17} color={theme.colors.primary} />}
                onPress={() => choose(typedPath)}
              />
            </Animated.View>
          ) : null}

          {suggestions.length > 0 ? (
            <Animated.View layout={listLayout('short')}>
              <SheetSceneGroupRule />
              <SheetSceneGroupHeading title={t`Directories`} />
              {suggestions.map((item) => (
                <SheetSceneRow
                  key={item.path}
                  title={item.name || item.path}
                  caption={item.path}
                  leading={<Folder size={16} color={theme.colors.textSubtle} />}
                  onPress={() => choose(item.path)}
                />
              ))}
            </Animated.View>
          ) : null}

          <Animated.View layout={listLayout('short')}>
            {showTypedPath || suggestions.length > 0 ? <SheetSceneGroupRule /> : null}
            <SheetSceneGroupHeading
              title={t`Known repositories`}
              first={!showTypedPath && suggestions.length === 0}
            />
            {filtered.length === 0 ? (
              <View style={styles.empty}>
                <Text variant="caption" color={theme.colors.textMuted} style={styles.emptyText}>
                  {t`No projects here yet. Type a path above to open one.`}
                </Text>
              </View>
            ) : (
              filtered.map((project) => {
                const index = rowIndex++;
                return (
                  <Animated.View
                    key={project.id}
                    entering={
                      index < STAGGERED_ROWS ? riseIn(index * STAGGER.row) : fadeIn('short')
                    }
                    layout={listLayout('short')}>
                    <SheetSceneRow
                      title={project.name || project.id}
                      caption={project.canonical}
                      selected={activeDirectory === project.canonical}
                      leading={
                        <FolderGit2
                          size={17}
                          color={
                            activeDirectory === project.canonical
                              ? theme.colors.primary
                              : theme.colors.textSubtle
                          }
                        />
                      }
                      onPress={() => choose(project.canonical, project)}
                    />
                  </Animated.View>
                );
              })
            )}
          </Animated.View>
          <SheetSceneFooter bottomInset={insets.bottom} />
        </ScrollView>
      )}
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  loading: { padding: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: 32, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', maxWidth: 260, lineHeight: 18 },
});
