import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { CornerUpLeft, GitFork, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated from 'react-native-reanimated';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { AgentUnreadDot } from '@/components/agent-unread-dot';
import { PressableScale } from '@/components/pressable-scale';
import { SettingsSegmented } from '@/components/settings-segmented';
import {
  SheetScene,
  SheetSceneField,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneQuietAction,
  SheetSceneRow,
  SheetSceneSearch,
  SHEET_LADDER,
  sheetSceneStyles,
  useSheetSceneInputStyle,
} from '@/components/sheet-scene';
import { appChrome } from '@/constants/appearance';
import {
  DURATION,
  fadeIn,
  fadeInDown,
  fadeOutDown,
  listLayout,
  riseIn,
  STAGGER,
} from '@/lib/motion';
import {
  formatModelName,
  hasRealSessionTitle,
  isSessionUnread,
  sessionTitleOr,
  workspaceDisplayName,
  type AgentProject,
  type AgentSessionInfo,
  type ModelInfo,
  type ModelRef,
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
  /** Every model the host publishes, for naming the one each session runs. */
  models?: readonly ModelInfo[];
  onSelectSession: (asid: string) => void;
  onCreateNewSession?: () => void;
  /** A new name for one session. The workbench owns the call and the rollback. */
  onRenameSession?: (asid: string, title: string) => void;
  /** Delete one session, after the confirmation this sheet asks for. */
  onDeleteSession?: (asid: string) => void;
  onClose: () => void;
}

export const AgentSessionsSheet = memo(function AgentSessionsSheet({
  sessions,
  activeAsid,
  knownProjects,
  activeDirectory,
  activeProject,
  models,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
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

  /**
   * The model a session runs, named the way the reader chose it.
   *
   * The row used to print `model_id` -- `openai/gpt-oss-120b:free` in a caption
   * next to a human-written title. The catalogue's own name is the one on the
   * chip and in the model sheet; `formatModelName` is the fallback for a model
   * this host no longer publishes.
   */
  const modelNameOf = (model?: ModelRef | null): string => {
    if (!model?.model_id) return '';
    const listed = models?.find(
      (entry) =>
        entry.id === model.model_id &&
        (!model.provider_id || entry.provider_id === model.provider_id)
    );
    return listed?.name || formatModelName(model, '');
  };

  /**
   * What a screen reader hears, when the dot is saying something the title is
   * not. A mark that only exists as six points of colour is not a mark.
   */
  const rowLabel = (session: AgentSessionInfo): string => {
    const title = sessionTitleOr(session, t`Untitled session`);
    return isSessionUnread(session) ? t`${title} — finished while you were away` : title;
  };

  /**
   * The row the reader has opened the actions on, and the one they are
   * renaming. One at a time: two open menus on one list is two questions.
   */
  const [menuAsid, setMenuAsid] = useState<string | null>(null);
  const [renameAsid, setRenameAsid] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const scrollerRef = useRef<ScrollView>(null);
  /** Where each root's block sits, so a rename field can be brought up. */
  const rowOffsets = useRef<Record<string, number>>({});
  const inputStyle = useSheetSceneInputStyle();

  /**
   * Where a root's block sits in the scroller.
   *
   * Written through a callback rather than into the ref from the row's own
   * `onLayout` closure: everything inside the list's `map` is render scope, and
   * a ref touched there is the thing `react/refs` is about -- the same shape
   * the composer's chip measuring already uses.
   */
  const measureRow = useCallback((asid: string, y: number) => {
    rowOffsets.current[asid] = y;
  }, []);

  const openMenu = useCallback((asid: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRenameAsid(null);
    setMenuAsid((current) => (current === asid ? null : asid));
  }, []);

  const startRename = useCallback((session: AgentSessionInfo) => {
    setMenuAsid(null);
    setRenameDraft(hasRealSessionTitle(session) ? session.title : '');
    setRenameAsid(session.asid);
  }, []);

  /**
   * The field the reader is typing in, where the keyboard is not.
   *
   * The scroller grows by the keyboard's height at its end
   * (`SheetSceneFooter` -> `KeyboardInset`), so there is somewhere to scroll
   * to; this is what does the scrolling. A row near the bottom of a form sheet
   * is exactly where the keyboard lands, and a field under the keys is a field
   * the reader cannot see what they are typing into.
   *
   * In an effect rather than in `startRename`, because the field has to exist
   * before it can be brought up -- and because a ref read in a handler built
   * during render is the thing `react/refs` stops.
   */
  useEffect(() => {
    if (!renameAsid) return;
    const offset = rowOffsets.current[renameAsid];
    if (offset === undefined) return;
    const timer = setTimeout(() => {
      scrollerRef.current?.scrollTo({
        y: Math.max(0, offset - RENAME_REVEAL_MARGIN),
        animated: true,
      });
    }, DURATION.short);
    return () => clearTimeout(timer);
  }, [renameAsid]);

  const submitRename = useCallback(
    (asid: string) => {
      const next = renameDraft.trim();
      setRenameAsid(null);
      if (next) onRenameSession?.(asid, next);
    },
    [renameDraft, onRenameSession]
  );

  /**
   * The one destructive thing on this sheet, asked natively.
   *
   * A row that deletes on a tap is a row that deletes by accident, and what
   * goes with it is not only this session: OpenCode removes its children too.
   */
  const confirmDelete = useCallback(
    (session: AgentSessionInfo) => {
      const title = sessionTitleOr(session, t`Untitled session`);
      setMenuAsid(null);
      Alert.alert(
        t`Delete this session?`,
        t`“${title}” and any subagent sessions under it are removed from the host. This cannot be undone.`,
        [
          { text: t`Cancel`, style: 'cancel' },
          {
            text: t`Delete`,
            style: 'destructive',
            onPress: () => onDeleteSession?.(session.asid),
          },
        ]
      );
    },
    [onDeleteSession, t]
  );

  const menuItems = (session: AgentSessionInfo): AgentActionMenuItem[] => {
    const items: AgentActionMenuItem[] = [
      {
        id: 'rename',
        label: t`Rename`,
        Icon: PencilLine,
        onPress: () => startRename(session),
        testID: `agent-session-rename-${session.asid}`,
      },
    ];
    // Bound out of the field rather than asserted: there is no `!` on anything
    // that came off the wire in this surface.
    const parent = session.parent_id;
    if (parent) {
      items.push({
        id: 'parent',
        label: t`Open parent`,
        Icon: CornerUpLeft,
        onPress: () => {
          setMenuAsid(null);
          onSelectSession(parent);
          onClose();
        },
        testID: `agent-session-open-parent-${session.asid}`,
      });
    }
    items.push({
      id: 'delete',
      label: t`Delete`,
      Icon: Trash2,
      tone: 'danger',
      onPress: () => confirmDelete(session),
      testID: `agent-session-delete-${session.asid}`,
    });
    return items;
  };

  /** The actions affordance, for a reader who cannot long-press. */
  const overflowButton = (session: AgentSessionInfo) => (
    <PressableScale
      testID={`agent-session-actions-${session.asid}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: menuAsid === session.asid }}
      accessibilityLabel={t`Actions for ${sessionTitleOr(session, t`Untitled session`)}`}
      hitSlop={10}
      onPress={() => openMenu(session.asid)}
      style={styles.overflow}>
      <MoreHorizontal size={16} color={theme.colors.textMuted} />
    </PressableScale>
  );

  /** The menu, or the rename field that replaced it, under the row it belongs to. */
  const rowTrailing = (session: AgentSessionInfo) => {
    if (renameAsid === session.asid) {
      return (
        <Animated.View
          entering={fadeInDown('dropdown')}
          exiting={fadeOutDown('micro')}
          style={styles.rename}>
          <SheetSceneField label={t`Session name`}>
            <TextInput
              testID={`agent-session-rename-input-${session.asid}`}
              accessibilityLabel={t`Session name`}
              value={renameDraft}
              onChangeText={setRenameDraft}
              autoFocus
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => submitRename(session.asid)}
              placeholder={t`Untitled session`}
              placeholderTextColor={theme.colors.textSubtle}
              style={inputStyle}
            />
          </SheetSceneField>
          <View style={styles.renameActions}>
            <SheetSceneQuietAction
              testID={`agent-session-rename-cancel-${session.asid}`}
              label={t`Cancel`}
              onPress={() => setRenameAsid(null)}
            />
            <PressableScale
              testID={`agent-session-rename-save-${session.asid}`}
              accessibilityRole="button"
              accessibilityLabel={t`Save the new name`}
              onPress={() => submitRename(session.asid)}
              style={[styles.renameSave, { backgroundColor: theme.colors.primary }]}>
              <Text variant="caption" weight="bold" color={theme.colors.onPrimary}>
                {t`Save`}
              </Text>
            </PressableScale>
          </View>
        </Animated.View>
      );
    }
    if (menuAsid === session.asid) {
      return (
        <AgentActionMenu
          testID={`agent-session-menu-${session.asid}`}
          surface="ground"
          items={menuItems(session)}
        />
      );
    }
    return null;
  };

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
        ref={scrollerRef}
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
                onLayout={(event) => measureRow(root.asid, event.nativeEvent.layout.y)}
                entering={rowAt < STAGGERED_ROWS ? riseIn(rowAt * STAGGER.row) : fadeIn('short')}
                layout={listLayout('short')}>
                {index > 0 ? <SheetSceneGroupRule /> : null}
                {index === 0 ? <SheetSceneGroupHeading title={t`Recent`} first /> : null}
                <SheetSceneRow
                  testID={`agent-session-row-${root.asid}`}
                  title={sessionTitleOr(root, t`Untitled session`)}
                  caption={[root.agent || 'build', modelNameOf(root.model), projectName]
                    .filter(Boolean)
                    .join(' · ')}
                  selected={root.asid === activeAsid}
                  accessibilityLabel={rowLabel(root)}
                  crossfadeTitle
                  onPress={() => {
                    onSelectSession(root.asid);
                    onClose();
                  }}
                  onLongPress={() => openMenu(root.asid)}
                  meta={
                    <View style={styles.meta}>
                      {isSessionUnread(root) ? (
                        <AgentUnreadDot testID={`agent-session-unread-${root.asid}`} />
                      ) : null}
                      <Text variant="caption" color={theme.colors.textMuted}>
                        {formatTime(root.updated_ms)}
                      </Text>
                      {overflowButton(root)}
                    </View>
                  }
                  trailing={rowTrailing(root)}
                />
                {subs.map((sub) => (
                  <SheetSceneRow
                    key={sub.asid}
                    testID={`agent-subagent-row-${sub.asid}`}
                    title={sessionTitleOr(sub, t`Untitled session`)}
                    caption={sub.agent || 'subagent'}
                    selected={sub.asid === activeAsid}
                    style={styles.subagentRow}
                    accessibilityLabel={rowLabel(sub)}
                    crossfadeTitle
                    leading={<GitFork size={13} color={theme.colors.textSubtle} />}
                    onPress={() => {
                      onSelectSession(sub.asid);
                      onClose();
                    }}
                    onLongPress={() => openMenu(sub.asid)}
                    meta={
                      <View style={styles.meta}>
                        {isSessionUnread(sub) ? (
                          <AgentUnreadDot testID={`agent-session-unread-${sub.asid}`} />
                        ) : null}
                        {overflowButton(sub)}
                      </View>
                    }
                    trailing={rowTrailing(sub)}
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

/** How much of the list stays visible above a rename field brought into view. */
const RENAME_REVEAL_MARGIN = 12;

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  overflow: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  rename: { paddingBottom: SHEET_LADDER.gap },
  renameActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SHEET_LADDER.gap,
  },
  renameSave: {
    paddingHorizontal: SHEET_LADDER.snug,
    paddingVertical: SHEET_LADDER.gap,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  empty: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', maxWidth: 260, lineHeight: AGENT_TYPE.mono.lineHeight },
  // Subagents belong to the root above them, so they start one step in -- the
  // only indent in the sheet, and it is what makes the tree readable.
  subagentRow: { paddingLeft: SHEET_LADDER.section },
});
