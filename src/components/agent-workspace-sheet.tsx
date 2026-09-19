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
  workspaceDisplayName,
  type AgentProject,
  type DirectoryItem,
} from '@/lib/agent-session';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { listableWorkspaces, workspaceProjectMissing } from '@/lib/agent-workspace-missing';
import { AGENT_TYPE } from '@/constants/agent-type';

const STAGGERED_ROWS = 8;

/**
 * Switch workspace, as a native form sheet route.
 *
 * `sheet-scene.tsx`'s shape: one ground, no cards, the left rule on the
 * repository the session is in. The filter doubles as a path field -- type a
 * `/` and the first group becomes the directory you typed.
 */
/**
 * A directory the engine has no named project for, as a row.
 *
 * OpenCode files loose directories under one catch-all project whose canonical
 * is `/`, and this sheet drops that project -- it is not a workspace anyone
 * chose. Which meant the workspace the reader was *in* was frequently missing
 * from the list of workspaces: `/tmp/muqun-showcase` had no row, so there was
 * nothing for the selection rule to mark and nothing for the filter to find.
 */
function directoryAsProject(directory: string): AgentProject {
  return {
    id: `directory:${directory}`,
    canonical: directory,
    name: workspaceDisplayName(undefined, directory, directory),
  };
}

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
  /**
   * True until the host has answered, because the empty state below claims
   * the host has no workspaces and nothing may claim that before it is known.
   * Starting at `false` painted that sentence for one frame on every opening.
   */
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DirectoryItem[]>([]);

  // A route mounts when it opens and unmounts when it is dismissed, so search
  // state starts clean and the project list is fetched once per opening.
  const loadedOnceRef = useRef(false);
  const loadProjects = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      if (!loadedOnceRef.current) setLoading(true);
      try {
        // A retry that reads the cached answer again is not a retry; the first
        // read of an opening is still allowed to be instant.
        const list = await getAgentProjects(
          sessionId,
          undefined,
          options?.forceRefresh ? { forceRefresh: true } : undefined
        );
        setProjects(withoutGlobalRoot(list ?? []));
        loadedOnceRef.current = true;
      } catch {
        // Quiet: the cached list, or the empty state, is still the right answer.
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

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

  /**
   * Every workspace worth a row: the named projects, and the directory the
   * session is actually in when that is not one of them.
   */
  const listedProjects = useMemo(() => {
    // A workspace whose folder the host says is gone is not an offer this
    // sheet can keep -- except the one the reader is standing in, which is
    // listed and marked. See `listableWorkspaces`.
    const listable = listableWorkspaces(projects, activeDirectory);
    if (!activeDirectory) return listable;
    if (listable.some((project) => project.canonical === activeDirectory)) return listable;
    return [directoryAsProject(activeDirectory), ...listable];
  }, [projects, activeDirectory]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return listedProjects;
    // A path typed in full filters the list too. The field says "or type a
    // path", and typing one used to empty the list it was filtering -- the
    // query was handed straight to the directory suggester and the rows below
    // were left matching nothing.
    return listedProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(q) ||
        project.canonical.toLowerCase().includes(q) ||
        project.id.toLowerCase().includes(q)
    );
  }, [listedProjects, searchQuery]);

  const choose = (directory: string, project?: AgentProject) => {
    onSelectWorkspace(directory, project);
    onClose();
  };

  const typedPath = searchQuery.trim();
  // Never for the workspace already open: "Open this path" on the path you are
  // standing in is an action with nothing to do.
  const showTypedPath =
    typedPath.length > 0 &&
    (typedPath.startsWith('/') || typedPath.startsWith('~')) &&
    typedPath !== activeDirectory;
  let rowIndex = 0;

  return (
    <SheetScene
      testID="agent-workspace-sheet"
      title={t`Switch project`}
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
                caption={t`Open as a project`}
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
                  captionKind="path"
                  leading={<Folder size={16} color={theme.colors.textSubtle} />}
                  onPress={() => choose(item.path)}
                />
              ))}
            </Animated.View>
          ) : null}

          <Animated.View layout={listLayout('short')}>
            {showTypedPath || suggestions.length > 0 ? <SheetSceneGroupRule /> : null}
            <SheetSceneGroupHeading
              title={t`Projects`}
              first={!showTypedPath && suggestions.length === 0}
            />
            {filtered.length === 0 ? (
              <View style={styles.empty}>
                <Text variant="caption" color={theme.colors.textMuted} style={styles.emptyText}>
                  {searchQuery.trim()
                    ? t`No projects match “${searchQuery.trim()}”.`
                    : t`No projects here yet. Type a path above to open one.`}
                </Text>
                {searchQuery.trim() ? null : (
                  // A host that answered with nothing and a host that has
                  // nothing look the same from here, and only one of them is
                  // worth asking again. Offered rather than guessed at.
                  <PressableScale
                    testID="agent-workspace-retry"
                    accessibilityRole="button"
                    accessibilityLabel={t`Retry`}
                    onPress={() => {
                      void loadProjects({ forceRefresh: true }).catch(() => {});
                    }}
                    style={[
                      styles.retry,
                      { backgroundColor: withAlpha(theme.colors.primary, 0.09) },
                    ]}>
                    <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                      {t`Retry`}
                    </Text>
                  </PressableScale>
                )}
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
                      // Every workspace on one machine shares a prefix, so the
                      // head is the part that is the same and the tail is the
                      // part that is the answer.
                      captionKind="path"
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
                      // The only missing workspace that is listed at all is the
                      // one the reader is standing in, and it says so rather
                      // than looking like every other row.
                      {...(workspaceProjectMissing(project)
                        ? {
                            meta: (
                              <Text variant="caption" color={theme.colors.textSubtle}>
                                {t`Folder is missing`}
                              </Text>
                            ),
                          }
                        : {})}
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
  empty: { paddingVertical: 32, alignItems: 'center', justifyContent: 'center', gap: 12 },
  retry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  emptyText: { textAlign: 'center', maxWidth: 260, lineHeight: AGENT_TYPE.mono.lineHeight },
});
