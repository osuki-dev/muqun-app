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
import { sessionTitleOr, type AgentProject, type AgentSessionInfo } from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';

const STAGGERED_ROWS = 8;

/** Every project the sessions fall into, plus the catch-all. */
const ALL_PROJECTS = 'all';

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
  onSelectSession: (asid: string) => void;
  onCreateNewSession?: () => void;
  onClose: () => void;
}

export const AgentSessionsSheet = memo(function AgentSessionsSheet({
  sessions,
  activeAsid,
  knownProjects,
  onSelectSession,
  onClose,
}: AgentSessionsSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);

  const { rootSessions, subagentMap } = useMemo(() => {
    const roots: AgentSessionInfo[] = [];
    const subs = new Map<string, AgentSessionInfo[]>();
    for (const session of sessions) {
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
    if (projectFilter !== ALL_PROJECTS) {
      const target = projects.find((project) => project.id === projectFilter);
      list = list.filter((root) => {
        if (root.project_id && root.project_id === projectFilter) return true;
        if (target?.canonical && root.directory) {
          return root.directory === target.canonical || root.directory.startsWith(target.canonical);
        }
        return root.directory === projectFilter;
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
  }, [rootSessions, subagentMap, searchQuery, projectFilter, projects]);

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

  // Two segments at most: Android's segmented control is a two-state pill, and
  // a project list longer than that belongs in the workspace switcher.
  const segments = useMemo(() => {
    const options = [{ label: t`All projects`, value: ALL_PROJECTS }];
    const current = projects.find((project) => project.id === projectFilter);
    if (current) options.push({ label: current.name, value: current.id });
    else if (projects[0]) options.push({ label: projects[0].name, value: projects[0].id });
    return options;
  }, [projects, projectFilter, t]);

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
              value={projectFilter}
              onChange={setProjectFilter}
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
                ? t`No sessions match that search.`
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
