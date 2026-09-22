import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLingui } from '@lingui/react/macro';
import {
  FolderGit2,
  GitBranch,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated from 'react-native-reanimated';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { PressableScale } from '@/components/pressable-scale';
import {
  SheetScene,
  SheetSceneAction,
  SheetSceneField,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneQuietAction,
  SheetSceneQuietControl,
  SheetSceneRow,
  sheetSceneStyles,
  useSheetSceneInputStyle,
} from '@/components/sheet-scene';
import { AGENT_TYPE } from '@/constants/agent-type';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
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
  createAgentWorktree,
  isManagedWorktree,
  isWorktreeForceRequired,
  listAgentWorktrees,
  refreshAgentWorktrees,
  removeAgentWorktree,
  sameDirectory,
  worktreeDisplayName,
  type WorkspaceMissing,
  type WorktreeDirectory,
} from '@/lib/agent-session';
import { FontedTextInput } from '@/components/fonted-text-input';

const STAGGERED_ROWS = 8;

/** How much ground to leave above the create fields when they are brought up. */
const CREATE_REVEAL_MARGIN = 72;

/**
 * Move this session to a worktree, as a native form sheet route.
 *
 * A worktree is a second checkout of the same repository, so an agent can work
 * on a branch without disturbing the one the reader has open. OpenCode's TUI
 * spends `session.move` and three `dialog.move_session.*` keys on this; on a
 * phone it is one sheet, and the four verbs are its groups: the project, the
 * worktrees, the one being removed, and the one being made.
 *
 * The inventory is the sheet's source of truth rather than anything passed in.
 * `GET /api/agent-worktrees` lists the project's own root alongside the
 * worktrees, and the root is the entry carrying no `strategy` -- so the sheet
 * asks the engine which directory is the project instead of inferring it from
 * a path prefix, which is what the workspace pill has to do and gets wrong for
 * a worktree parked under `~/.local/share/opencode`.
 */
export interface AgentWorktreeSheetProps {
  /** The session being moved: its title is the sheet's caption. */
  sessionTitle?: string;
  /** Where the session is now -- the project's root, or one of its worktrees. */
  activeDirectory?: string;
  /** The project as the workbench knows it, used only until the list answers. */
  projectDirectory?: string;
  /**
   * Bumped when `agent.worktree.changed` says the inventory moved.
   *
   * The event carries no `asid` and reaches every reader, but a route cannot
   * subscribe to the workbench's stream -- so the workbench counts them and
   * the sheet re-lists when the count changes. The same shape as the context
   * sheet's `savedPermissionsRevision`.
   */
  revision?: number;
  /** Point the session at this directory. The workbench owns the call. */
  onMove: (directory: string) => void;
  onClose: () => void;
}

export const AgentWorktreeSheet = memo(function AgentWorktreeSheet({
  sessionTitle,
  activeDirectory,
  projectDirectory,
  revision = 0,
  onMove,
  onClose,
}: AgentWorktreeSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const inputStyle = useSheetSceneInputStyle();
  /**
   * Both fields on this sheet hold a literal, so both are monospaced.
   *
   * `useSheetSceneInputStyle` hands out the interface face, which is right for
   * the sheets whose fields hold prose -- a session's name, a note. Neither of
   * these is. One is a directory name that will exist on the host's filesystem
   * exactly as it was typed, the other a ref that already exists in that
   * repository; the file's own comment about not translating "probe" and
   * "main" is the same argument one step earlier. What follows from it is the
   * face: a literal is copied and compared character for character, and a
   * proportional face is where `release-1.0` and `release-l.O` stop being
   * distinguishable at 15pt on a phone.
   *
   * Layered as a family alone over `inputStyle`, so the field keeps the
   * flush sheet field's size and padding and changes only the face.
   */
  const monoFontFamily = useMonoFontFamily();

  const [entries, setEntries] = useState<WorktreeDirectory[]>([]);
  /**
   * The folder this sheet is about, when the host no longer has it.
   *
   * A session outlives its directory, and the inventory read is then a `404`
   * naming the path. That is an empty state, not a failure: nothing went
   * wrong, there is nothing to retry, and a toast over the one sheet that can
   * move the session somewhere else would be in the way of the answer.
   */
  const [missing, setMissing] = useState<WorkspaceMissing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /** The row whose actions are open, and the row that is busy going away. */
  const [menuDirectory, setMenuDirectory] = useState<string | null>(null);
  /** The worktree that refused without `force`, and is waiting to be asked again. */
  const [forceFor, setForceFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  /** A refusal, kept on the row it belongs to rather than anywhere else. */
  const [rowError, setRowError] = useState<{ directory: string; message: string } | null>(null);

  const [creating, setCreating] = useState(false);
  const [busyCreating, setBusyCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [branchDraft, setBranchDraft] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const scrollerRef = useRef<ScrollView>(null);
  const createOffset = useRef(0);

  /**
   * Which directory to ask about: the session's own, before anyone's guess.
   *
   * The route documents `directory` as the project's root, but what OpenCode
   * does with it is *resolve* it -- a location becomes the project that owns
   * it, which is the whole of `worktree.resolved` -- so the session's own
   * directory is a complete answer and the only one that cannot be wrong.
   *
   * `projectDirectory` is second because it is a guess: the workbench matches
   * a project to a directory on a path prefix, and the device found what that
   * costs. A session in `/tmp/muqun-c10/repo` matched the known project whose
   * canonical is `/tmp`, so the sheet asked about `/tmp`, and OpenCode
   * answered about `/tmp` -- a "This project" row naming a directory that is
   * not the project, and an inventory belonging to something else entirely.
   */
  const queryDirectory = activeDirectory || projectDirectory;

  const load = useCallback(async () => {
    try {
      const listing = await listAgentWorktrees(queryDirectory);
      setEntries(listing.entries);
      setMissing(listing.missing ?? null);
    } finally {
      setLoading(false);
    }
  }, [queryDirectory]);

  useEffect(() => {
    void load().catch(() => setLoading(false));
  }, [load, revision]);

  /** The project's own root: the one entry OpenCode did not create. */
  const projectRoot = useMemo(
    () => entries.find((entry) => !isManagedWorktree(entry))?.directory ?? queryDirectory,
    [entries, queryDirectory]
  );
  const worktrees = useMemo(() => entries.filter(isManagedWorktree), [entries]);

  const inProject = sameDirectory(activeDirectory, projectRoot);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void refreshAgentWorktrees(queryDirectory)
      .catch(() => {
        // Quiet: a rediscovery that did not run leaves the list as it was,
        // which is the same list the reader is already looking at.
      })
      .then(() => load())
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [queryDirectory, load]);

  const choose = useCallback(
    (directory: string) => {
      if (sameDirectory(directory, activeDirectory)) {
        onClose();
        return;
      }
      onMove(directory);
      onClose();
    },
    [activeDirectory, onMove, onClose]
  );

  const openMenu = useCallback((directory: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRowError(null);
    setForceFor(null);
    setMenuDirectory((current) => (current === directory ? null : directory));
  }, []);

  /**
   * Remove one, and ask again when the refusal was only about `force`.
   *
   * A worktree with local changes in it refuses without `force`, and that
   * refusal is the one question worth putting to the reader: everything else
   * that comes back is a failure and says so on the row. The second attempt is
   * never automatic -- uncommitted work is exactly what the first refusal was
   * protecting.
   */
  const remove = useCallback(
    async (directory: string, force: boolean) => {
      setMenuDirectory(null);
      setRowError(null);
      setRemoving(directory);
      try {
        await removeAgentWorktree(directory, { directory: projectRoot, force });
        await load();
      } catch (err) {
        if (!force && isWorktreeForceRequired(err)) {
          // Asked in the row, not in a native alert: the menu reopens on this
          // worktree with one item, and that item takes two taps.
          setForceFor(directory);
          setMenuDirectory(directory);
        } else {
          setRowError({
            directory,
            message: err instanceof Error ? err.message : t`Could not remove that worktree.`,
          });
        }
      } finally {
        setRemoving(null);
      }
    },
    [projectRoot, load, t]
  );

  /**
   * Make one, then move the session onto it.
   *
   * The create blocks until the worktree exists -- 2.0.1 announces no
   * `creating` and the inventory change follows the answer -- so the spinner
   * is this request and nothing else. A refusal keeps what the reader typed:
   * `branch` is an existing ref to branch from, and the commonest refusal is a
   * ref that is not there, which is a one-word edit rather than a re-entry.
   */
  const submitCreate = useCallback(() => {
    if (busyCreating) return;
    setBusyCreating(true);
    setCreateError(null);
    void createAgentWorktree({
      directory: projectRoot,
      name: nameDraft,
      branch: branchDraft,
    })
      .then((directory) => {
        if (!directory) {
          setCreateError(t`The host made a worktree but did not say where.`);
          return;
        }
        setCreating(false);
        setNameDraft('');
        setBranchDraft('');
        choose(directory);
      })
      .catch((err: unknown) => {
        setCreateError(err instanceof Error ? err.message : t`Could not create that worktree.`);
      })
      .finally(() => setBusyCreating(false));
  }, [busyCreating, projectRoot, nameDraft, branchDraft, choose, t]);

  /**
   * The create fields, where the keyboard is not.
   *
   * `SheetSceneFooter` grows the scroller by the keyboard's height so there is
   * somewhere to scroll to; this is what scrolls. In an effect because the
   * fields have to exist before they can be brought up -- the pattern the
   * sessions sheet's rename established.
   */
  useEffect(() => {
    if (!creating) return;
    const timer = setTimeout(() => {
      scrollerRef.current?.scrollTo({
        y: Math.max(0, createOffset.current - CREATE_REVEAL_MARGIN),
        animated: true,
      });
    }, DURATION.short);
    return () => clearTimeout(timer);
  }, [creating]);

  const menuItems = (directory: string): AgentActionMenuItem[] => [
    {
      id: 'remove',
      label: forceFor === directory ? t`Remove anyway` : t`Remove worktree`,
      Icon: Trash2,
      tone: 'danger',
      // Two taps either way. The first pass is a plain removal, which git
      // refuses when there is uncommitted work; the second says what that
      // work is about to become, which is the one question worth asking.
      confirm:
        forceFor === directory
          ? {
              label: t`Tap again to remove anyway`,
              detail: t`“${worktreeDisplayName(directory)}” has changes that have not been committed. Removing it throws them away.`,
            }
          : { label: t`Tap again to remove` },
      onPress: () => {
        const force = forceFor === directory;
        setForceFor(null);
        void remove(directory, force).catch(() => {});
      },
      testID: `agent-worktree-remove-${worktreeDisplayName(directory)}`,
    },
  ];

  /** The actions affordance, for a reader who cannot long-press. */
  const overflowButton = (directory: string) => (
    <PressableScale
      testID={`agent-worktree-actions-${worktreeDisplayName(directory)}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: menuDirectory === directory }}
      accessibilityLabel={t`Actions for ${worktreeDisplayName(directory)}`}
      hitSlop={10}
      onPress={() => openMenu(directory)}
      style={styles.overflow}>
      <MoreHorizontal size={16} color={theme.colors.textMuted} />
    </PressableScale>
  );

  const rowTrailing = (directory: string) => {
    if (rowError?.directory === directory) {
      return (
        <Animated.View entering={fadeInDown('dropdown')} style={styles.rowError}>
          <Text variant="caption" color={theme.colors.danger} style={styles.rowErrorText}>
            {rowError.message}
          </Text>
        </Animated.View>
      );
    }
    if (menuDirectory === directory) {
      return (
        <AgentActionMenu
          testID={`agent-worktree-menu-${worktreeDisplayName(directory)}`}
          surface="ground"
          items={menuItems(directory)}
        />
      );
    }
    return null;
  };

  return (
    <SheetScene
      testID="agent-worktree-sheet"
      title={t`Move to worktree`}
      caption={sessionTitle}
      headingTrailing={
        <SheetSceneQuietControl
          testID="agent-worktree-refresh-btn"
          accessibilityLabel={t`Refresh worktrees`}
          busy={refreshing}
          onPress={handleRefresh}>
          <RefreshCw size={16} color={theme.colors.textMuted} />
        </SheetSceneQuietControl>
      }>
      <ScrollView
        nestedScrollEnabled
        ref={scrollerRef}
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Animated.View layout={listLayout('short')}>
          <SheetSceneGroupHeading title={t`This project`} first />
          <SheetSceneRow
            testID="agent-worktree-project-row"
            title={worktreeDisplayName(projectRoot) || t`Project`}
            caption={projectRoot}
            captionKind="path"
            selected={inProject}
            selectedTestID="agent-worktree-project-current"
            leading={
              <FolderGit2
                size={17}
                color={inProject ? theme.colors.primary : theme.colors.textSubtle}
              />
            }
            onPress={() => (projectRoot ? choose(projectRoot) : onClose())}
          />
        </Animated.View>

        <Animated.View layout={listLayout('short')}>
          <SheetSceneGroupRule />
          <SheetSceneGroupHeading
            title={t`Worktrees`}
            meta={
              worktrees.length > 0 ? (
                <Text variant="caption" color={theme.colors.textMuted}>
                  {worktrees.length}
                </Text>
              ) : null
            }
          />
          {worktrees.length === 0 ? (
            <View style={styles.empty}>
              <Text variant="caption" color={theme.colors.textMuted} style={styles.emptyText}>
                {loading
                  ? t`Reading this project’s worktrees…`
                  : missing
                    ? t`Project folder is missing: ${missing.directory}`
                    : t`No worktrees yet. Make one below to work on a branch without disturbing this checkout.`}
              </Text>
            </View>
          ) : (
            worktrees.map((entry, index) => {
              const current = sameDirectory(entry.directory, activeDirectory);
              const name = worktreeDisplayName(entry.directory);
              return (
                <Animated.View
                  key={entry.directory}
                  entering={index < STAGGERED_ROWS ? riseIn(index * STAGGER.row) : fadeIn('short')}
                  layout={listLayout('short')}>
                  <SheetSceneRow
                    testID={`agent-worktree-row-${name}`}
                    title={name}
                    caption={entry.directory}
                    captionKind="path"
                    selected={current}
                    selectedTestID={`agent-worktree-current-${name}`}
                    leading={
                      <GitBranch
                        size={16}
                        color={current ? theme.colors.primary : theme.colors.textSubtle}
                      />
                    }
                    accessibilityValue={
                      removing === entry.directory ? { text: t`Removing` } : undefined
                    }
                    onPress={() => choose(entry.directory)}
                    // Not the one the session is standing in: removing that
                    // checkout leaves the session pointing at a directory that
                    // is gone, and moving off it first is one row away.
                    onLongPress={current ? undefined : () => openMenu(entry.directory)}
                    meta={
                      <View style={styles.meta}>
                        {entry.strategy ? (
                          <Text variant="caption" color={theme.colors.textSubtle}>
                            {entry.strategy}
                          </Text>
                        ) : null}
                        {current ? null : overflowButton(entry.directory)}
                      </View>
                    }
                    trailing={rowTrailing(entry.directory)}
                  />
                </Animated.View>
              );
            })
          )}
        </Animated.View>

        <Animated.View
          layout={listLayout('short')}
          onLayout={(event) => {
            createOffset.current = event.nativeEvent.layout.y;
          }}>
          <SheetSceneGroupRule />
          <SheetSceneRow
            testID="agent-worktree-new-btn"
            title={t`New worktree…`}
            caption={creating ? undefined : t`A second checkout of this repository`}
            leading={<Plus size={17} color={theme.colors.primary} />}
            onPress={() => {
              setMenuDirectory(null);
              setCreateError(null);
              setCreating((open) => !open);
            }}
            trailing={
              creating ? (
                <Animated.View
                  entering={fadeInDown('dropdown')}
                  exiting={fadeOutDown('micro')}
                  style={styles.create}>
                  <SheetSceneField
                    label={t`Name`}
                    hint={t`Leave it empty and OpenCode picks a name.`}>
                    <FontedTextInput
                      testID="agent-worktree-name-input"
                      accessibilityLabel={t`Worktree name`}
                      value={nameDraft}
                      onChangeText={setNameDraft}
                      autoFocus
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                      // Not translated: an example of a directory name, and a
                      // git ref below it. Neither is copy -- a catalog that
                      // rendered "main" in Japanese would be naming a ref that
                      // does not exist.
                      placeholder="probe"
                      placeholderTextColor={theme.colors.textSubtle}
                      style={[inputStyle, { fontFamily: monoFontFamily }]}
                    />
                  </SheetSceneField>
                  <SheetSceneField
                    label={t`Branch from`}
                    hint={t`A branch or tag this repository already has.`}
                    error={createError ?? undefined}>
                    <FontedTextInput
                      testID="agent-worktree-branch-input"
                      accessibilityLabel={t`Branch to start from`}
                      value={branchDraft}
                      onChangeText={setBranchDraft}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="go"
                      onSubmitEditing={submitCreate}
                      placeholder="main"
                      placeholderTextColor={theme.colors.textSubtle}
                      style={[inputStyle, { fontFamily: monoFontFamily }]}
                    />
                  </SheetSceneField>
                  <SheetSceneAction
                    testID="agent-worktree-create-btn"
                    label={t`Create and move`}
                    busy={busyCreating}
                    onPress={submitCreate}
                  />
                  <SheetSceneQuietAction
                    testID="agent-worktree-create-cancel-btn"
                    label={t`Cancel`}
                    onPress={() => {
                      setCreating(false);
                      setCreateError(null);
                    }}
                  />
                </Animated.View>
              ) : null
            }
          />
        </Animated.View>
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  empty: { paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', maxWidth: 280, lineHeight: AGENT_TYPE.mono.lineHeight },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  overflow: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  rowError: { paddingLeft: 8, paddingRight: 14, paddingBottom: 6 },
  rowErrorText: { lineHeight: AGENT_TYPE.mono.lineHeight },
  create: { paddingLeft: 8, paddingRight: 14, paddingTop: 4, gap: 12 },
});
