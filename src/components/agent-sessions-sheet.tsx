import { memo, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { GitFork } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { SettingsSegmented } from '@/components/settings-segmented';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneRow,
  SheetSceneSearch,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { fadeIn, listLayout, riseIn, STAGGER } from '@/lib/motion';
import {
  sessionTitleOr,
  workspaceDisplayName,
  type AgentProject,
  type AgentSessionInfo,
} from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';

const STAGGERED_ROWS = 8;

/** Every workspace the sessions fall into, plus the catch-all. */
const ALL_WORKSPACES = 'all';

/**
 * The workspace the reader is in, whichever one that is.
 *
 * A literal id would be wrong for the one case this segment exists for: a
 * directory OpenCode files under its catch-all project has the catch-all's id,
 * which is shared with every other loose directory on the host -- so filtering
 * by it listed sessions from all of them and the segment was named after
 * whichever project happened to sort first. The current workspace is a
 * *directory*, and this value says "that one" rather than naming it.
 */
const CURRENT_WORKSPACE = 'current';

/**
 * Every agent session on this host, as a native form sheet route.
 *
 * Presentational: the route above it reads the list and the handlers out of
 * `stores/agent-sheet-bridge.ts` and hands them down. The shape is
 * `sheet-scene.tsx`'s -- one ground, no cards, the left rule for the session
 * you are in, subagents indented under their root.
 */
export interface AgentSessionsSheetProps {
  sessions: readonly AgentSessionInfo[];
  activeAsid?: string;
  knownProjects?: readonly AgentProject[];
  activeDirectory?: string;
  /** The project the active directory belongs to, when it belongs to a named one. */
  activeProject?: AgentProject;
  onSelectSession: (asid: string) => void;
  onCreateNewSession?: () => void;
  onClose: () => void;
}

export const AgentSessionsSheet = memo(function AgentSessionsSheet({
  sessions,
  activeAsid,
  knownProjects,
  activeDirectory,
  activeProject,
  onSelectSession,
  onClose,
}: AgentSessionsSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  /**
   * Which workspace is being listed. It opens on the reader's own, because
   * that is what the sheet is reached from and what `/sessions` promises.
   */
  const [workspaceFilter, setWorkspaceFilter] = useState<string>(
    activeDirectory ? CURRENT_WORKSPACE : ALL_WORKSPACES
  );

  const { rootSessions, subagentMap } = useMemo(() => {
    const roots: AgentSessionInfo[] = [];
    const subs = new Map<string, AgentSessionInfo[]>();
    // One session is one row. The listing and the stream both answer with the
    // same session sometimes, and two rows reading "Untitled session · build"
    // side by side are indistinguishable from two real sessions.
    const seen = new Set<string>();
    for (const session of sessions) {
      if (seen.has(session.asid)) continue;
      seen.add(session.asid);
      if (session.parent_id) {
        const list = subs.get(session.parent_id) ?? [];
        list.push(session);
        subs.set(session.parent_id, list);
      } else {
        roots.push(session);
      }
    }
    roots.sort((a, b) => (b.updated_ms || 0) - (a.updated_ms || 0));
    return { rootSessions: roots, subagentMap: subs };
  }, [sessions]);

  const projects = useMemo(() => {
    const map = new Map<string, { id: string; name: string; canonical?: string }>();
    for (const project of knownProjects ?? []) {
      map.set(project.id, {
        id: project.id,
        name: project.name || project.canonical,
        canonical: project.canonical,
      });
    }
    for (const session of sessions) {
      if (session.project_id && !map.has(session.project_id)) {
        const name = session.directory
          ? (session.directory.split('/').filter(Boolean).pop() ?? session.project_id)
          : session.project_id;
        map.set(session.project_id, { id: session.project_id, name, canonical: session.directory });
      }
    }
    return Array.from(map.values());
  }, [knownProjects, sessions]);

  const projectNameOf = (session: AgentSessionInfo): string | undefined => {
    if (session.project_id) {
      const match = projects.find((project) => project.id === session.project_id);
      if (match) return match.name;
    }
    if (session.directory) {
      const match = projects.find(
        (project) =>
          project.canonical === session.directory ||
          (project.canonical && session.directory?.startsWith(project.canonical))
      );
      if (match) return match.name;
      return session.directory.split('/').filter(Boolean).pop();
    }
    return undefined;
  };

  const filteredRoots = useMemo(() => {
    let list = rootSessions;
    if (workspaceFilter === CURRENT_WORKSPACE && activeDirectory) {
      // The directory, not the project id: the catch-all project is shared by
      // every loose directory on the host.
      list = list.filter(
        (root) =>
          root.directory === activeDirectory ||
          (root.directory?.startsWith(`${activeDirectory}/`) ?? false)
      );
    } else if (workspaceFilter !== ALL_WORKSPACES && workspaceFilter !== CURRENT_WORKSPACE) {
      const target = projects.find((project) => project.id === workspaceFilter);
      list = list.filter((root) => {
        if (root.project_id && root.project_id === workspaceFilter) return true;
        if (target?.canonical && root.directory) {
          return root.directory === target.canonical || root.directory.startsWith(target.canonical);
        }
        return root.directory === workspaceFilter;
      });
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((root) => {
      const hit =
        root.title?.toLowerCase().includes(q) ||
        root.agent?.toLowerCase().includes(q) ||
        root.directory?.toLowerCase().includes(q) ||
        root.asid.toLowerCase().includes(q);
      if (hit) return true;
      return (subagentMap.get(root.asid) ?? []).some(
        (sub) =>
          sub.title?.toLowerCase().includes(q) ||
          sub.agent?.toLowerCase().includes(q) ||
          sub.asid.toLowerCase().includes(q)
      );
    });
  }, [rootSessions, subagentMap, searchQuery, workspaceFilter, activeDirectory, projects]);

  const [nowMs] = useState(() => Date.now());
  const formatTime = (ms?: number) => {
    if (!ms) return '';
    const minutes = Math.round((nowMs - ms) / 60000);
    if (minutes < 1) return t`just now`;
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  };

  /**
   * Two segments at most -- Android's segmented control is a two-state pill --
   * and the first of them is the workspace the reader is actually in.
   *
   * It used to be whichever project sorted first in the catalogue, which on a
   * host with several is simply a different workspace's name over this
   * workspace's sessions.
   */
  const currentWorkspaceName = workspaceDisplayName(
    activeProject,
    activeDirectory,
    t`This workspace`
  );
  const segments = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    if (activeDirectory) options.push({ label: currentWorkspaceName, value: CURRENT_WORKSPACE });
    options.push({ label: t`All workspaces`, value: ALL_WORKSPACES });
    return options;
  }, [activeDirectory, currentWorkspaceName, t]);

  let rowIndex = 0;

  return (
    <SheetScene
      testID="agent-sessions-sheet"
      title={t`Sessions`}
      caption={t`${sessions.length} on this host`}
      header={
        <>
          <SheetSceneSearch
            testID="agent-sessions-search"
            accessibilityLabel={t`Search sessions`}
            placeholder={t`Search sessions`}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {segments.length > 1 ? (
            <SettingsSegmented
              testID="agent-sessions-project-filter"
              options={segments}
              value={workspaceFilter}
              onChange={setWorkspaceFilter}
            />
          ) : null}
        </>
      }>
      <ScrollView
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {filteredRoots.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="caption" color={theme.colors.textMuted} style={styles.emptyText}>
              {searchQuery
                ? t`No sessions match “${searchQuery}”.`
                : t`No sessions in this workspace yet. Start one from the + button.`}
            </Text>
          </View>
        ) : (
          filteredRoots.map((root, index) => {
            const subs = subagentMap.get(root.asid) ?? [];
            const projectName = projectNameOf(root);
            const rowAt = rowIndex++;
            return (
              <Animated.View
                key={root.asid}
                entering={rowAt < STAGGERED_ROWS ? riseIn(rowAt * STAGGER.row) : fadeIn('short')}
                layout={listLayout('short')}>
                {index > 0 ? <SheetSceneGroupRule /> : null}
                {index === 0 ? <SheetSceneGroupHeading title={t`Recent`} first /> : null}
                <SheetSceneRow
                  testID={`agent-session-row-${root.asid}`}
                  title={sessionTitleOr(root, t`Untitled session`)}
                  caption={[root.agent || 'build', root.model?.model_id, projectName]
                    .filter(Boolean)
                    .join(' · ')}
                  selected={root.asid === activeAsid}
                  onPress={() => {
                    onSelectSession(root.asid);
                    onClose();
                  }}
                  meta={
                    <Text variant="caption" color={theme.colors.textMuted}>
                      {formatTime(root.updated_ms)}
                    </Text>
                  }
                />
                {subs.map((sub) => (
                  <SheetSceneRow
                    key={sub.asid}
                    testID={`agent-subagent-row-${sub.asid}`}
                    title={sessionTitleOr(sub, t`Untitled session`)}
                    caption={sub.agent || 'subagent'}
                    selected={sub.asid === activeAsid}
                    style={styles.subagentRow}
                    leading={<GitFork size={13} color={theme.colors.textSubtle} />}
                    onPress={() => {
                      onSelectSession(sub.asid);
                      onClose();
                    }}
                  />
                ))}
              </Animated.View>
            );
          })
        )}
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  empty: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', maxWidth: 260, lineHeight: AGENT_TYPE.mono.lineHeight },
  // Subagents belong to the root above them, so they start one step in -- the
  // only indent in the sheet, and it is what makes the tree readable.
  subagentRow: { paddingLeft: SHEET_LADDER.section },
});
