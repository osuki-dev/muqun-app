import { plural } from '@lingui/core/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Button, Input, ScrollScreen, Skeleton, Text, useThemeTokens } from '@osuki-dev/ui';
import { Bot, Plus, RefreshCw, SquareTerminal, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { agentStatusWord } from '@/i18n/labels';
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { RowActionMenu } from '@/components/row-action-menu';
import { fadeIn, fadeOut, listLayout, riseIn, STAGGER, timing } from '@/lib/motion';
import {
  createTab,
  createWorkspace,
  deletePane,
  deleteTab,
  deleteWorkspace,
  gatewayTransport,
  renamePane,
  renameTab,
  renameWorkspace,
  type HerdrEntity,
} from '@/lib/gateway-client';
import {
  field,
  panelTitle,
  statusColor,
} from '@/lib/herdr-entity';
import { describeGatewayFailure } from '@/lib/network-error';
import { panelPickerGridLayout } from '@/lib/panel-picker-layout';
import { EMPTY_WORKSPACE_INVENTORY, workspaceInventories } from '@/lib/workspace-inventory';

const MONO_FONT = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

/**
 * The session map: every panel in the current workspace, grouped under the tab
 * that owns it, one tap from any of them.
 *
 * This sheet used to be a filter chain -- pick a workspace, pick a tab, and
 * only then see the panels inside it -- which meant two thirds of the session
 * was off screen at any moment and reaching a panel in another tab took three
 * taps. A tab is a container, not a mode, so it is drawn as a group header and
 * every panel is visible at once.
 *
 * It deliberately does not repeat the two switches that already exist. The
 * title pill's swipe cycles workspaces blind and fast; the pane strip along the
 * bottom switches panels inside the current tab. Neither can show you how many
 * workspaces there are, neither reaches a panel in a *different* tab, and
 * neither can create, rename or close anything. That is what this is for.
 *
 * The width in a row belongs to the pane title, because the title is the thing
 * being chosen (card #693).
 *
 * There is less of it than the screen suggests: iOS insets a form sheet 8pt on
 * each side, so on a 402pt iPhone the sheet is 386pt wide, this file's 16pt
 * padding leaves 354pt, and a row's own padding leaves 333pt.
 *
 * ## What card #830 took away
 *
 * The sheet said the same number three times -- a total beside WORKSPACE, a
 * number on every chip, and `N panels` on every tab heading -- and drew a
 * monospaced `1.2` address in a fixed column on every row. Three counts is not
 * three facts: the rows being counted are on screen underneath the count, so
 * two of them were describing what the reader could already see, and the third,
 * the one on the chips, was the only one carrying information the reader could
 * not get any other way. It was also the broken one.
 *
 * So there is one count left, on the chips, where a number answers "what is
 * over in that workspace" rather than "what is in front of you". It is spelled
 * with its unit -- `8 panels`, not `8` -- so an empty workspace reads `0
 * panels`, which is an answer, and not a bare `0`, which is what the defect
 * looked like.
 *
 * The per-row address went with them. `1.2` is how you would *type* your way to
 * a pane, and nobody is typing here -- this is a list you tap. It cost a 26pt
 * column on every row for the length of the sheet, and what it was really doing
 * was carrying the selection highlight. The highlight moved onto the row
 * itself, and the tab keeps its own index, because a tab really is a numbered
 * sequence: it is the order the two-finger swipe cycles through.
 *
 * That left the accent colour free to mean one thing. It is spent once, on the
 * panel you are currently in; the workspace chip marks itself selected by
 * swapping ink and surface instead, and both create actions are drawn in plain
 * text on a raised fill. Before, the accent was on the selected chip, the
 * selected row, that row's address badge, and both create actions at once, and
 * a reader had no way to tell which of the five meant "you are here".
 */
export function SessionMap({

  sessionId,
  label,
  activePaneId,
  onChoosePane,
  onClose,
}: {
  sessionId: string;
  /** The server's name, for the line under the title. */
  label: string;
  /** The panel the terminal is showing, so the sheet opens on "where am I". */
  activePaneId?: string;
  onChoosePane: (paneId: string) => void;
  onClose: () => void;
}) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();

  /**
   * "Rename workspace" / "Rename tab" / "Rename panel" as three whole
   * sentences.
   *
   * The English reads as if it were one string with a noun slot, which is why
   * it was written that way. It is not: a language that inflects the verb, or
   * orders the words differently, cannot be assembled from a stem and a noun --
   * so each one is extracted, and translated, in full.
   *
   * Declared inside the component, closing over the hook's `t`, and NOT as a
   * module function handed `t` as a parameter. The Lingui babel macro rewrites
   * ``t`...` `` only where it can walk the reference back to the very
   * `useLingui()` destructuring it came from; a `t` that arrives as an argument
   * is a different binding, so the macro leaves the tagged template alone, the
   * runtime calls Lingui's `_` with a raw strings array, and the label comes
   * out empty. A closure keeps one binding and one meaning.
   */
  function renameFieldLabel(kind: 'workspace' | 'tab' | 'panel'): string {
    switch (kind) {
      case 'workspace':
        return t`Rename workspace`;
      case 'tab':
        return t`Rename tab`;
      default:
        return t`Rename panel`;
    }
  }

  const theme = useThemeTokens();
  const { width: windowWidth } = useWindowDimensions();
  // Native form sheets can be narrower than the app window. The root layout
  // wins as soon as it measures; the window width only avoids a one-column
  // flash on full-screen Pad presentations.
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const gridLayout = panelPickerGridLayout(measuredWidth || windowWidth);

  const [workspaces, setWorkspaces] = useState<HerdrEntity[]>([]);
  const [tabs, setTabs] = useState<HerdrEntity[]>([]);
  const [panes, setPanes] = useState<HerdrEntity[]>([]);
  const [agents, setAgents] = useState<HerdrEntity[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rename is an inline field rather than Alert.prompt, which exists only on
  // iOS and would silently do nothing on Android.
  const [renaming, setRenaming] = useState<{
    // Narrowed from `string` so the rename label has all three cases to name.
    // It was only ever set to these three; the wider type was just slack.
    kind: 'workspace' | 'tab' | 'panel';
    label: string;
    apply: (next: string) => Promise<unknown>;
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Which row is showing its inline actions, revealed by a long press. One at a
  // time, keyed by the entity's own id, so a workspace chip and a panel row
  // cannot both be armed.
  const [menuFor, setMenuFor] = useState<{
    kind: 'workspace' | 'tab' | 'panel';
    id: string;
    label: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextWorkspaces, nextTabs, nextPanes, nextAgents] = await Promise.all([
        gatewayTransport.loadWorkspaces(sessionId),
        gatewayTransport.loadTabs(sessionId),
        gatewayTransport.loadPanes(sessionId),
        gatewayTransport.loadAgents(sessionId),
      ]);
      setWorkspaces(nextWorkspaces);
      setTabs(nextTabs);
      setPanes(nextPanes);
      setAgents(nextAgents);
      setError(null);
      // Open on whatever the terminal is already showing, so the sheet reads as
      // "where am I" rather than a fresh list.
      const current = nextPanes.find((pane) => pane.id === activePaneId);
      setWorkspaceId(
        current
          ? field(current, 'workspace_id')
          : nextWorkspaces.find((item) => Boolean(item.raw.focused))?.id
            ?? nextWorkspaces[0]?.id
            ?? ''
      );
    } catch (failure) {
      setError(describeGatewayFailure(failure, t`Could not load panels.`).message);
    } finally {
      setLoading(false);
    }
  }, [activePaneId, sessionId, t]);

  useEffect(() => {
    void load();
  }, [load, t]);

  const orderedWorkspaces = useMemo(
    () => [
      ...workspaces.filter((workspace) => workspace.id === workspaceId),
      ...workspaces.filter((workspace) => workspace.id !== workspaceId),
    ],
    [workspaceId, workspaces]
  );

  /**
   * The workspace's tabs, each carrying its own panels and its address.
   *
   * Indices are positions in these lists rather than anything the gateway
   * sends, which is exactly what a tmux index is: where the thing sits in the
   * list in front of you.
   */
  const groups = useMemo(
    () =>
      tabs
        .filter((tab) => field(tab, 'workspace_id') === workspaceId)
        .map((tab, tabIndex) => ({
          tab,
          address: tabIndex + 1,
          panes: panes.filter((pane) => field(pane, 'tab_id') === tab.id),
        })),
    [panes, tabs, workspaceId]
  );

  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  /**
   * What is in each workspace, counted here rather than read off the workspace
   * record.
   *
   * The record's `pane_count` and `agent_status` are both optional on the wire
   * and the tmux backend sends neither -- `tmux list-sessions` has no
   * per-session pane count to report -- so the rail's number was `0` and its
   * dot was grey on every chip, forever, however much was running. Everything
   * needed to answer is already loaded: `load` fetches the whole session's
   * tabs, panes and agents before the sheet draws.
   */
  const inventories = useMemo(
    () => workspaceInventories(tabs, panes, agents),
    [agents, panes, tabs]
  );

  /**
   * Creating workspaces, tabs and panels is Herdr's, not any agent's: it runs
   * over the gateway's REST API rather than being typed into a pane. Agent
   * slash commands live in Quick actions for the same reason in reverse.
   */
  async function runStructuralAction(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(describeGatewayFailure(failure, t`Could not update the session.`).message);
    } finally {
      setBusy(false);
    }
  }

  // Creating focuses the new container in the sheet, so the sheet shows what was
  // just made rather than a refresh landing back on the old focused workspace.
  async function createAndSelect(action: () => Promise<{ workspaceId: string; paneId: string }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await action();
      await load();
      if (created.workspaceId) setWorkspaceId(created.workspaceId);
    } catch (failure) {
      setError(describeGatewayFailure(failure, t`Could not update the session.`).message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  function beginRename() {
    if (!menuFor) return;
    const { kind, id, label: name } = menuFor;
    setMenuFor(null);
    setRenameDraft(name);
    setRenaming({
      kind: kind === 'panel' ? 'panel' : kind,
      label: name,
      apply: (next) =>
        kind === 'workspace'
          ? renameWorkspace(sessionId, id, next)
          : kind === 'tab'
            ? renameTab(sessionId, id, next)
            : renamePane(sessionId, id, next),
    });
  }

  function confirmDelete() {
    if (!menuFor) return;
    const { kind, id } = menuFor;
    setMenuFor(null);
    void runStructuralAction(() =>
      kind === 'workspace'
        ? deleteWorkspace(sessionId, id)
        : kind === 'tab'
          ? deleteTab(sessionId, id)
          : deletePane(sessionId, id)
    );
  }

  async function applyRename() {
    const pending = renaming;
    const next = renameDraft.trim();
    if (!pending || !next) return;
    setRenaming(null);
    await runStructuralAction(() => pending.apply(next));
  }

  /**
   * The shared action bar, rendered wherever the armed row happens to be.
   *
   * It arrives rather than replacing what was there: a long press is a
   * deliberate act, and a set of buttons that simply exists where a status
   * label was reads as a mis-render rather than as an answer. The row it lands
   * in carries `listLayout`, so the width it takes is taken smoothly too.
   */
  function actionMenu(kind: 'workspace' | 'tab' | 'panel', id: string) {
    if (menuFor?.kind !== kind || menuFor.id !== id) return null;
    return (
      <Animated.View entering={fadeIn('micro')} exiting={fadeOut('micro')}>
        <RowActionMenu
          label={menuFor.label}
          onRename={beginRename}
          onDelete={confirmDelete}
          onCancel={() => setMenuFor(null)}
        />
      </Animated.View>
    );
  }

  /** Nothing has arrived yet, so the sheet shows its own shape. */
  const showSkeleton = loading && workspaces.length === 0;

  return (
    // The scroller is the sheet's root, with nothing wrapped around it:
    // react-native-screens lays a form sheet out specially when its content is a
    // scroll view, and warns "FormSheet with ScrollView expects at most 2
    // subviews" the moment anything else shares the container -- after which the
    // sheet renders empty.
    <ScrollScreen
      variant="surface"
      safeArea="bottom"
      style={styles.sheet}
      contentContainerStyle={styles.content}
      onLayout={(event: LayoutChangeEvent) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        setMeasuredWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={theme.colors.textMuted}
          colors={[theme.colors.primary]}
        />
      }>
      {/* Handle and header as one sticky node: a sheet with more panels than
          fit used to scroll its own title away and then clip the first row
          against the sheet's top edge, so the reader lost both the close
          button and the row they were reaching for. `stickyHeaderIndices`
          needs a constant index, which is why the platform-only handle lives
          inside this node rather than beside it. */}
      <View style={[styles.stickyTop, { backgroundColor: theme.colors.surface }]}>
      {process.env.EXPO_OS === 'android' ? <View style={styles.sheetHandle} /> : null}

      <View style={styles.header}>
        <View style={styles.flexOne}>
          <Text variant="bodySmall" style={styles.headerTitle}>
            <Trans>Panels</Trans>
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {activeWorkspace ? `${label} · ${activeWorkspace.title}` : label}
          </Text>
        </View>
        {/* The sheet's chrome, in the same material as the server page's --
            `sheet` rather than `floating` because this sits on an opaque sheet,
            where the thick material would only read as a grey disc. */}
        <GlassChrome face="sheet" style={styles.iconButton}>
          <PressableScale
            accessibilityLabel={t`Refresh panels`}
            onPress={() => void load()}
            style={styles.iconButtonHit}>
            {loading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <RefreshCw size={17} color={theme.colors.textMuted} />
            )}
          </PressableScale>
        </GlassChrome>
        <GlassChrome face="sheet" style={styles.iconButton}>
          <PressableScale
            accessibilityLabel={t`Close panels`}
            onPress={onClose}
            style={styles.iconButtonHit}>
            <X size={18} color={theme.colors.text} />
          </PressableScale>
        </GlassChrome>
      </View>
      </View>

      {renaming ? (
        <View style={styles.renameBlock}>
          <Input
            label={renameFieldLabel(renaming.kind)}
            value={renameDraft}
            onChangeText={setRenameDraft}
            autoFocus
            variant="outline"
            returnKeyType="done"
            onSubmitEditing={() => void applyRename()}
          />
          <View style={styles.renameActions}>
            <Button variant="ghost" onPress={() => setRenaming(null)}>
              {t`Cancel`}
            </Button>
            <Button onPress={() => void applyRename()} disabled={!renameDraft.trim() || busy}>
              {t`Save`}
            </Button>
          </View>
        </View>
      ) : null}

      {error ? (
        <Text selectable variant="caption" color={theme.colors.danger}>
          {error}
        </Text>
      ) : null}

      {/*
        The workspace rail is the sheet's scope, not a peer of the groups below
        it: the title pill's swipe already switches workspaces, so what this
        adds is the inventory -- how many there are, which one you are in, and
        the only way to make another.
      */}
      <View style={styles.rail}>
        {/* The eyebrow alone. The total that used to sit opposite it counted the
            selected workspace, in a row that is about all of them, and the rows
            it counted begin two lines below -- so it was answering a question
            the reader was not asking in the one place it could be misread as
            being about the rail. */}
        <Text variant="caption" color={theme.colors.textMuted} style={styles.eyebrow}>
          <Trans>WORKSPACE</Trans>
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.railList}>
          {orderedWorkspaces.map((workspace) => {
            const inventory = inventories.get(workspace.id) ?? EMPTY_WORKSPACE_INVENTORY;
            return (
              <WorkspaceChip
                key={workspace.id}
                title={workspace.title}
                // The count is spelled into the label rather than left to the
                // caption inside the chip. A Pressable that carries a label is
                // one accessibility element on iOS, and everything drawn inside
                // it -- the name, the `N panels` caption -- stops existing as
                // far as VoiceOver, or a test, is concerned. Android happens to
                // expose the children anyway, which is why the count read as
                // present until this ran on a phone that does not.
                accessibilityLabel={t`Open workspace ${workspace.title}, ${plural(inventory.panels, { one: '# panel', other: '# panels' })}. Long press to close.`}
                panelCount={inventory.panels}
                selected={workspace.id === workspaceId}
                statusColor={statusColor(inventory.status)}
                onPress={() => setWorkspaceId(workspace.id)}
                onLongPress={() =>
                  setMenuFor({ kind: 'workspace', id: workspace.id, label: workspace.title })
                }
              />
            );
          })}
          <PressableScale
            accessibilityLabel={t`New workspace`}
            disabled={busy}
            onPress={() => void createAndSelect(() => createWorkspace(sessionId, { focus: false }))}
            style={[styles.createChip, { backgroundColor: theme.colors.surfaceRaised }]}>
            <Plus size={16} color={theme.colors.textMuted} />
            <Text variant="caption" color={theme.colors.text}>
              <Trans>Workspace</Trans>
            </Text>
          </PressableScale>
        </ScrollView>
        {menuFor?.kind === 'workspace' ? (
          <Animated.View
            entering={fadeIn('micro')}
            exiting={fadeOut('micro')}
            layout={listLayout('short')}
            style={styles.menuRow}>
            <Text
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={1}
              style={styles.flexOne}>
              {menuFor.label}
            </Text>
            {actionMenu('workspace', menuFor.id)}
          </Animated.View>
        ) : null}
      </View>

      <View style={[styles.groups, gridLayout.columns > 1 ? styles.groupGrid : null]}>
        {showSkeleton
          ? Array.from({ length: gridLayout.columns }, (_, index) => (
              <SessionMapSkeleton key={index} width={gridLayout.itemWidth} />
            ))
          : null}

        {groups.map((group, groupIndex) => (
          // A tab created or closed used to pop a whole group in, or snap every
          // group below it up into the space. `riseIn` staggers the groups on a
          // first load so the sheet arrives as a list rather than all at once,
          // and `listLayout` is what makes a delete read as the rest closing the
          // gap.
          <Animated.View
            key={group.tab.id}
            entering={riseIn(groupIndex * STAGGER.card)}
            exiting={fadeOut('micro')}
            layout={listLayout('short')}
            style={[styles.group, { width: gridLayout.itemWidth }]}>
            {/*
              The tab is a header, not a filter. Long press is where its rename
              and close live, the same long press every other row in the app uses.
            */}
            <PressableScale
              accessibilityLabel={t`Tab ${group.tab.title}. Long press for actions.`}
              feedback={false}
              onLongPress={() =>
                setMenuFor({ kind: 'tab', id: group.tab.id, label: group.tab.title })
              }
              style={styles.groupHeader}>
              <Text
                variant="caption"
                color={theme.colors.textMuted}
                style={[styles.address, styles.groupAddress]}>
                {group.address}
              </Text>
              <Text variant="label" numberOfLines={1} style={styles.flexOne}>
                {group.tab.title}
              </Text>
              {/* No count here. The panels it counted are the next thing on the
                  screen, in a card with a visible edge, so the heading was
                  reporting the length of a list the reader was already looking
                  at. What the heading is for is naming the tab. */}
              {actionMenu('tab', group.tab.id)}
            </PressableScale>

            {/*
              One card with hairline dividers rather than a card per panel: two
              levels of nesting read as "header plus grouped block", and the group
              boundary becomes something you can actually see.
            */}
            <View
              style={[
                styles.groupCard,
                { backgroundColor: theme.colors.surfaceRaised },
              ]}>
              {group.panes.map((pane) => {
                const agent = agents.find((item) => field(item, 'pane_id') === pane.id);
                const title = panelTitle(pane, agent);
                const status = agent?.status ?? pane.status;
                const armed = menuFor?.kind === 'panel' && menuFor.id === pane.id;
                return (
                  <PanelRow
                    key={pane.id}
                    accessibilityLabel={t`Open panel ${title}. Long press to close.`}
                    title={title}
                    detail={pane.cwd ?? pane.id}
                    status={status}
                    hasAgent={Boolean(agent)}
                    selected={pane.id === activePaneId}
                    trailing={armed ? actionMenu('panel', pane.id) : null}
                    onPress={() => onChoosePane(pane.id)}
                    onLongPress={() => setMenuFor({ kind: 'panel', id: pane.id, label: title })}
                  />
                );
              })}
              {group.panes.length === 0 ? (
                <Animated.View
                  entering={fadeIn('micro')}
                  exiting={fadeOut('micro')}
                  layout={listLayout('short')}
                  style={styles.panelRow}>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    <Trans>This tab has no panels.</Trans>
                  </Text>
                </Animated.View>
              ) : null}
            </View>
          </Animated.View>
        ))}
      </View>

      {!loading && groups.length === 0 ? (
        <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')}>
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            <Trans>This workspace has no tabs yet.</Trans>
          </Text>
        </Animated.View>
      ) : null}

      {/* A new full panel (a new tab), not a split -- two panes sharing one
          small phone screen is unreadable, and the pane strip already lets you
          flip between panels. */}
      <PressableScale
        accessibilityLabel={t`New panel`}
        disabled={busy || !workspaceId}
        onPress={() =>
          void createAndSelect(() =>
            createTab(sessionId, { workspace_id: workspaceId, focus: false })
          )
        }
        style={[
          styles.createRow,
          { backgroundColor: theme.colors.surfaceRaised },
          gridLayout.columns > 1 ? { width: gridLayout.itemWidth } : null,
        ]}>
        {/* Plain text on a raised fill, not accent. This sheet is for picking,
            not for creating, and a full-width row at the end of the list is
            already the most findable thing on it -- it does not also need the
            one colour that now means "you are here". */}
        <Plus size={17} color={theme.colors.textMuted} />
        <Text variant="bodySmall" color={theme.colors.text}>
          <Trans>New panel</Trans>
        </Text>
      </PressableScale>
    </ScrollScreen>
  );
}

/**
 * One workspace in the rail: a name, what is inside it, and how urgent that is.
 *
 * The chip is the only place in the sheet that describes somewhere the reader
 * is not currently looking, which is why it is the only place left with a
 * count. The count is written with its unit on a second line rather than as a
 * bare number beside the name: `0` alone is indistinguishable from a field that
 * was never filled in, which is precisely the bug this chip shipped with for as
 * long as it existed, and `0 panels` cannot be misread that way.
 *
 * Selection swaps ink and surface -- text-coloured fill, surface-coloured
 * lettering -- instead of taking the accent. The accent is spent on the panel
 * you are in, one screen element, and a rail that also used it left the reader
 * with two different things claiming to be the current one. `text` on `surface`
 * is the one colour pair every one of the 32 packs guarantees is legible,
 * because it is the pair the whole app draws body copy with; inverting it is
 * safe in a way that no invented hex would be.
 *
 * Selection used to be an inline `selected ? primary : surfaceRaised` on four
 * separate things at once -- the fill, the border, the status dot and two
 * labels -- so tapping a chip repainted half the rail on a single frame. It is
 * one ramp on the toggle token now, and the resting copy of each two-tone piece
 * is the one that lays out, with the selected copy drawn over it. The reason it
 * is not `interpolateColor` is written up on `PaneChip` in the server screen:
 * the same rule, the same trap.
 */
function WorkspaceChip({
  title,
  accessibilityLabel,
  panelCount,
  selected,
  statusColor: dotColor,
  onPress,
  onLongPress,
}: {
  title: string;
  accessibilityLabel: string;
  panelCount: number;
  selected: boolean;
  statusColor: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useThemeTokens();
  const chosen = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    chosen.value = withTiming(selected ? 1 : 0, timing('toggle'));
  }, [chosen, selected]);

  const restingStyle = useAnimatedStyle(() => ({ opacity: 1 - chosen.value }));
  const selectedStyle = useAnimatedStyle(() => ({ opacity: chosen.value }));

  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      layout={listLayout('short')}>
      <PressableScale
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onLongPress={onLongPress}
        style={[
          styles.workspaceChip,
          {
            backgroundColor: theme.colors.surfaceRaised,
          },
        ]}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.chipFill,
            { backgroundColor: theme.colors.text },
            selectedStyle,
          ]}
        />
        {/* The dot keeps its own colour when the chip is selected rather than
            going mono like the lettering: it is the one thing on the chip that
            is not about the workspace's identity but about whether something in
            there wants you, and that stays true after you have tapped it. */}
        <View style={styles.statusDot}>
          <View style={[StyleSheet.absoluteFill, styles.dotFill, { backgroundColor: dotColor }]} />
        </View>
        <View style={styles.flexOne}>
          {/* `bodySmall`, not `label`. The `label` style is uppercased, and a
              workspace name is something a person typed -- it turned a tmux
              session called `card829` into `CARD829` on the one surface whose
              job is recognising it. Uppercase belongs to the WORKSPACE eyebrow,
              which is furniture, not to the data underneath it. */}
          <Animated.View style={restingStyle}>
            <Text variant="bodySmall" color={theme.colors.text} numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
              {/* One ICU message rather than a ternary over two strings: which
                  forms a language needs is the language's business, and Chinese
                  needs one where English needs two. */}
              <Plural value={panelCount} one="# panel" other="# panels" />
            </Text>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, selectedStyle]}>
            <Text variant="bodySmall" color={theme.colors.surface} numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" color={theme.colors.surface} numberOfLines={1}>
              <Plural value={panelCount} one="# panel" other="# panels" />
            </Text>
          </Animated.View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

/**
 * One panel inside a tab's card.
 *
 * Creating a panel used to pop a row into the middle of the card and closing
 * one snapped every row below it upwards; the highlight on the panel you are
 * actually in changed on the frame the selection did. All three are the same
 * fix -- arrive, leave, and travel between the two.
 *
 * The highlight used to be carried by a filled `1.2` badge in a monospaced
 * column that ran down the whole sheet. The badge was the strongest mark on the
 * screen because it had to compete with an accent-filled workspace chip and two
 * accent-coloured create actions; with those gone it does not need to shout,
 * and the address it was drawn on was paying a 26pt column on every row to say
 * something nobody was going to type. The row is the mark now: the accent tint
 * across it, its glyph, and its title. One element, three ways of saying the
 * same thing, which is what makes it legible in a pack whose `primarySubtle` is
 * a very quiet tint.
 */
function PanelRow({
  accessibilityLabel,
  title,
  detail,
  status,
  hasAgent,
  selected,
  trailing,
  onPress,
  onLongPress,
}: {
  accessibilityLabel: string;
  title: string;
  detail: string;
  status: string | undefined;
  hasAgent: boolean;
  selected: boolean;
  /** The action menu, when this row is the armed one. */
  trailing: React.ReactNode;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useThemeTokens();
  // The runtime `_`, for the status descriptor below. `useLingui` from the macro
  // package hands back `t`, which translates a template written at the call
  // site; a `MessageDescriptor` read out of a table needs `_`.
  const { _ } = useLinguiRuntime();
  const chosen = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    chosen.value = withTiming(selected ? 1 : 0, timing('toggle'));
  }, [chosen, selected]);

  const restingStyle = useAnimatedStyle(() => ({ opacity: 1 - chosen.value }));
  const selectedStyle = useAnimatedStyle(() => ({ opacity: chosen.value }));

  return (
    <Animated.View
      entering={fadeIn('short')}
      exiting={fadeOut('micro')}
      layout={listLayout('short')}>
      <PressableScale
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={280}
        style={styles.panelRow}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.colors.primarySubtle },
            selectedStyle,
          ]}
        />
        {/* An agent's glyph keeps its status colour whether or not the row is
            selected: that colour is the only report of what the agent is doing,
            and losing it on the one row you are looking at would be losing it
            where it matters most. A shell has nothing to report, so its glyph is
            free to carry the selection instead. */}
        {hasAgent ? (
          <Bot size={15} color={statusColor(status)} />
        ) : (
          <View style={styles.rowGlyph}>
            <Animated.View style={restingStyle}>
              <SquareTerminal size={15} color={theme.colors.textMuted} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, selectedStyle]}>
              <SquareTerminal size={15} color={theme.colors.primary} />
            </Animated.View>
          </View>
        )}
        <View style={styles.flexOne}>
          <View>
            <Animated.View style={restingStyle}>
              <Text variant="bodySmall" numberOfLines={1}>
                {title}
              </Text>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, selectedStyle]}>
              <Text variant="bodySmall" color={theme.colors.primary} numberOfLines={1}>
                {title}
              </Text>
            </Animated.View>
          </View>
          {/*
            Status and place on one line, status first.

            The status used to be a word at the row's trailing edge, where it
            took about 46pt off the title of exactly the rows worth reading --
            the ones with an agent in them. It is the same word in the same
            colour here, in front of the path, on a line that already existed:
            the title gets the width back and the row does not get taller. The
            middot is the separator the address language already uses.
          */}
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {status && status !== 'unknown' ? (
              <>
                {/*
                  Through `agentStatusWord`, not straight out of `status`.

                  `status` is the gateway's wire vocabulary -- `working`,
                  `blocked`, `idle` -- and rendering it put a lower-case English
                  word on this row in all eight languages, beside a title and a
                  path that were translated. It is the same fact the home
                  screen's server card and the home-screen widget both draw, and
                  both of those already go through this table; the panels sheet
                  was the one surface left echoing the wire.

                  A status the table does not know reads as "unknown" rather
                  than falling back to the raw word, which is the rule the table
                  documents for itself: wire vocabulary is not copy, so it should
                  not reach a user even when it is unrecognised.
                */}
                <Text variant="caption" color={statusColor(status)}>
                  {_(agentStatusWord[status] ?? agentStatusWord.unknown)}
                </Text>
                {' · '}
              </>
            ) : null}
            {detail}
          </Text>
        </View>
        {trailing}
      </PressableScale>
    </Animated.View>
  );
}

/**
 * The sheet's own shape while the gateway is being asked for it.
 *
 * It used to show nothing at all: the workspace rail was empty, the empty-state
 * line was gated on `!loading` so it did not show either, and then the whole
 * sheet appeared fully populated. A sheet that opens blank and fills in one
 * frame reads as having failed and then changed its mind, which is a worse
 * report of the same wait.
 *
 * Shaped like what is coming -- two chips, a header, three rows in a card --
 * rather than a spinner, so the layout does not move when the answer lands.
 */
function SessionMapSkeleton({ width }: { width: number }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('short')}
      style={[styles.group, { width }]}
      accessibilityLabel={t`Loading panels`}>
      <View style={styles.groupHeader}>
        <Skeleton variant="text" width={25} height={12} />
        <Skeleton variant="text" width={120} height={12} />
      </View>
      <View
        style={[
          styles.groupCard,
          { backgroundColor: theme.colors.surfaceRaised },
        ]}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.panelRow}>
            {/* The glyph the address slug used to stand beside. The slug is
                gone, so the shape a row arrives into is 15pt wide here too. */}
            <Skeleton variant="rect" width={15} height={15} />
            <View style={styles.flexOne}>
              <Skeleton variant="text" width="62%" height={13} />
              {/* Longer than it was: the second line now carries the status in
                  front of the path, so the shape it stands in for is longer. */}
              <Skeleton variant="text" width="52%" height={10} style={styles.skeletonDetail} />
            </View>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    // The stack renders form sheets over a transparent background so the native
    // sheet keeps its own corners; without filling the height, that transparency
    // shows as a grey strip under the content.
    //
    // `flex: 1` and not `height: '100%'`: inside a native form sheet the
    // container's height is not resolved when a percentage is measured, and the
    // sheet renders empty. Every other sheet in this app fills the same way.
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 32,
    // 14 rather than 16 between the blocks: this gap runs between every tab
    // group, so on the five-panel workspace the sheet is sized for it is paid
    // twice, and the groups still separate cleanly because each one is a header
    // over a bordered card.
    gap: 14,
  },
  stickyTop: {
    // The sheet's paddings live on the content container, so the sticky node
    // reclaims them for its own edges -- otherwise rows slide through the gap
    // beside it on their way up.
    marginHorizontal: -16,
    paddingHorizontal: 16,
    marginTop: -10,
    paddingTop: 10,
    paddingBottom: 8,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 25,
    includeFontPadding: false,
  },
  // The shape only: the fill is the glass chrome's, which is what makes the
  // sheet's buttons and the header's circles one material rather than two.
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonHit: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    letterSpacing: 0.8,
  },
  rail: {
    gap: 8,
  },
  railList: {
    gap: 8,
    paddingRight: 16,
  },
  /**
   * Rounded rectangles rather than full pills: at this height a 20pt radius
   * leaves no straight edge, which reads as a lozenge next to the cards below.
   *
   * The same 50pt minimum as a panel row, and for the same reason: both are a
   * name over a line of detail beside a small round status mark, so giving them
   * one height makes the rail and the list read as one system seen twice rather
   * than as two components that happen to share a sheet. It also puts the dot
   * in the chip exactly where the glyph in a row is -- centred against the pair
   * of lines, not against either one.
   */
  workspaceChip: {
    minWidth: 118,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  // The selected fill is one layer, so selection fades in rather than changing
  // several inline colours on the same frame.
  chipFill: {
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  statusDot: {
    width: 7,
    height: 7,
  },
  dotFill: {
    borderRadius: 4,
  },
  rowGlyph: {
    width: 15,
    height: 15,
  },
  skeletonDetail: {
    marginTop: 4,
  },
  createChip: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
  },
  group: {
    gap: 5,
  },
  groups: {
    gap: 14,
  },
  groupGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // 28 rather than 30: the tallest thing in it is one caption, so 30 was
    // padding the header past what a header needs and pushing the first row of
    // every group further down the sheet. There is one of these per tab.
    minHeight: 28,
    paddingRight: 2,
  },
  /**
   * The one monospaced element left in the sheet, and now the only numbered
   * one. A tab is a real sequence -- it is the order the two-finger swipe
   * cycles through, and the order the tab bar shows -- which is what earns it
   * an index where the per-row `1.2` addresses did not.
   */
  address: {
    fontFamily: MONO_FONT,
    fontVariant: ['tabular-nums'],
  },
  /**
   * 25pt, so that the tab's name and the panel titles under it start on the
   * same vertical line: 25 + the header's 8pt gap is 33, and a row reaches its
   * title through 10pt of card padding, a 15pt glyph and an 8pt gap, which is
   * also 33. That shared edge is what replaced the address column as the thing
   * the eye reads down.
   */
  groupAddress: {
    width: 25,
    textAlign: 'center',
  },
  groupCard: {
    borderRadius: 15,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  /**
   * 50pt, not 54.
   *
   * A row is two lines -- a title over a caption -- and 8pt of padding above
   * and below was more than either needed. 6pt measures 48.0pt a row on an
   * iPhone 17 Pro where 8pt measured 51.9pt: 4pt off every row in the sheet,
   * still comfortably past the 44pt minimum touch target.
   */
  panelRow: {
    minHeight: 50,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  createRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 15,
    borderCurve: 'continuous',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  renameBlock: {
    gap: 8,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
