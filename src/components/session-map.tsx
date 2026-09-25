import { plural } from '@lingui/core/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Bot, Plus, RefreshCw, SquareTerminal } from 'lucide-react-native';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { agentStatusWord } from '@/i18n/labels';
import { appChrome } from '@/constants/appearance';
import { Button } from '@/components/themed-button';
import { Input } from '@/components/themed-input';
import { PressableScale } from '@/components/pressable-scale';
import { RowActionMenu } from '@/components/row-action-menu';
import {
  SHEET_LADDER,
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneQuietAction,
  SheetSceneQuietControl,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { Skeleton } from '@/components/themed-skeleton';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useLatestRef, useLazyRef } from '@/hooks/use-render-refs';
import { fadeIn, fadeOut, listLayout, PULSE_PERIOD, riseIn, STAGGER, timing } from '@/lib/motion';
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
import { field, statusColor } from '@/lib/herdr-entity';
import { describeGatewayFailure } from '@/lib/network-error';
import {
  switcherRails,
  type MachineChoice,
  type MachineReach,
  type SessionRailItem,
} from '@/lib/switcher-rails';
import {
  beginSessionMapOperation,
  clearSessionMapOutcome,
  finishSessionMapOperation,
  hasSessionMapOutcome,
  markSessionMapOutcomeUnknown,
  ownsSessionMapGateway,
  ownsSessionMapOperation,
  subscribeSessionMapOutcome,
  type SessionMapOperation,
  type SessionMapOperationScope,
} from '@/lib/session-map-operations';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';

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
 * text. Before, the accent was on the selected chip, the selected row, that
 * row's address badge, and both create actions at once, and a reader had no way
 * to tell which of the five meant "you are here".
 *
 * ## What the scene took away
 *
 * The card per tab, and the grid those cards were laid out in on a Pad. A sheet
 * in this app is one frosted ground with one column on one gutter, and the
 * panel you are in is marked by the left rule -- the same rule the agent
 * timeline puts beside the reader's own messages, and the same one every picker
 * uses. A card around each group was a second surface the rule had nowhere to
 * sit against, and two columns of them gave the rule two left edges. The tab is
 * a `SheetSceneGroupHeading` now, and the hairline between groups is the only
 * divider left.
 *
 * ## What the machines sheet brought with it
 *
 * The header used to carry two buttons in the same corner. The monitor glyph
 * opened "Machines and sessions", which knew every machine this phone is paired
 * with and every backend on them and nothing about what was running inside one;
 * this sheet knew the workspaces, the groups and the panels of whichever
 * session that sheet had already picked. One address -- machine, backend,
 * workspace, panel -- cut in half, so a reader hunting for a terminal had to
 * know which half it was in before they could start looking.
 *
 * There is one button now and one sheet, and it is laid out as the address it
 * is: a rail of machines, the backends on the one that was tapped, the
 * workspaces in the one being read, and then the groups and panels as before.
 * Each rail is what the next rung down can be chosen from, and all four come
 * out of one pass of `switcherRails`, so they cannot disagree with each other.
 *
 * The rails are named. The WORKSPACE eyebrow card #830 removed was an all-caps
 * sign carrying a redundant count, over the only rail on the sheet; three
 * unlabelled rails of similar-looking chips is a different problem, and a
 * sentence-case `SheetSceneGroupHeading` is the furniture the groups below
 * already use. The sessions rail takes its machine's name as the heading's
 * meta, because that is the one thing about those chips a reader cannot get
 * from the chips: they can be the backends of a machine that is not this one.
 *
 * Add and manage leave the list and become the two quiet actions at the end.
 * They are the only things here that are not a pick, and a row with a `+` in
 * the middle of a rail of machines reads as another machine.
 */
export function SessionMap({
  sessionId,
  label,
  activePaneId,
  onChoosePane,
  onCreatedPane,
  machines,
  serverId,
  pendingId,
  onConnectMachine,
  onChooseSession,
  onAddMachine,
  onManageMachines,
}: {
  sessionId: string;
  /** The machine's name, for the line under the title. */
  label: string;
  /** The panel the terminal is showing, so the sheet opens on "where am I". */
  activePaneId?: string;
  onChoosePane: (paneId: string) => void;
  /** Completes Home's explicit new-terminal intent with the pane the API made. */
  onCreatedPane?: (paneId: string) => void;
  /** Every machine this phone is paired with, the current one included. */
  machines: readonly MachineChoice[];
  /** The machine the terminal underneath the sheet is on. */
  serverId: string;
  /** The machine being connected to, or null. It freezes the machines rail. */
  pendingId: string | null;
  /**
   * Tapping a machine: connect to it, and switch to it when there is one
   * backend on it or a remembered one to land in. A machine with a genuine
   * choice of backend answers by filling the sessions rail instead.
   */
  onConnectMachine: (serverId: string) => void;
  onChooseSession: (serverId: string, sessionId: string) => void;
  onAddMachine: () => void;
  onManageMachines: () => void;
}) {
  const surfaceBackground = useSurfaceBackground();
  const insets = useSafeAreaInsets();
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
        return t`Rename group`;
      default:
        return t`Rename terminal`;
    }
  }

  const theme = useThemeTokens();

  /**
   * How far this phone has got with a machine, as a sentence.
   *
   * Four whole strings and not a stem with a state appended, for the same
   * reason `renameFieldLabel` is four whole strings, and declared inside the
   * component closing over the hook's `t` for the same reason again: the macro
   * only rewrites a tagged template it can walk back to the very `useLingui()`
   * that produced the binding.
   */
  function machineCaption(reach: MachineReach, busy: boolean): string {
    if (busy) return t`Connecting`;
    switch (reach) {
      case 'current':
        return t`Current machine`;
      case 'connected':
        return t`Connected`;
      case 'unreachable':
        return t`Tap to retry`;
      default:
        return t`Tap to connect`;
    }
  }

  /**
   * The dot, which is the only part of a machine chip that is not its name.
   *
   * The same four status colours the panel rows and the workspace dots use, so
   * one green means one thing on the whole sheet. `primary` while a machine is
   * being reached: it is the one state that is about the reader's own tap
   * rather than about the machine, and it is the state the breath is on.
   */
  function reachColor(reach: MachineReach, busy: boolean): string {
    if (busy) return theme.colors.primary;
    switch (reach) {
      case 'current':
      case 'connected':
        return theme.colors.success;
      case 'unreachable':
        return theme.colors.danger;
      default:
        return theme.colors.textSubtle;
    }
  }

  const [workspaces, setWorkspaces] = useState<HerdrEntity[]>([]);
  const [tabs, setTabs] = useState<HerdrEntity[]>([]);
  const [panes, setPanes] = useState<HerdrEntity[]>([]);
  const [agents, setAgents] = useState<HerdrEntity[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  /**
   * The machine whose backends the sessions rail is about.
   *
   * Undefined until the reader taps one, and then the model falls back to the
   * machine they are on -- which is the right answer for the whole of the
   * common case, where the sheet opens on where you already are.
   *
   * It exists because tapping a machine with two backends cannot switch on its
   * own: there is no way to know which of them was meant. The old sheet
   * answered by revealing that machine's sessions as rows underneath it, and
   * this is the same answer in the rail.
   */
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeKey = JSON.stringify([serverId, sessionId]);
  const latestScopeKey = useLatestRef(scopeKey);
  const unknownCreateOutcome = useSyncExternalStore(
    useCallback((listener) => subscribeSessionMapOutcome(scopeKey, listener), [scopeKey]),
    useCallback(() => hasSessionMapOutcome({ scope: scopeKey, generation: 0 }), [scopeKey]),
    useCallback(() => hasSessionMapOutcome({ scope: scopeKey, generation: 0 }), [scopeKey])
  );
  const mounted = useRef(true);
  const generation = useRef(0);
  const loadRequest = useRef(0);
  const structuralOperation = useRef<SessionMapOperation | null>(null);
  const gatewayOwnsServer = useCallback(
    () => ownsSessionMapGateway(serverId, useGatewayConnectionStore.getState().record?.serverId),
    [serverId]
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      structuralOperation.current = null;
    };
  }, []);

  // A route target can change while this sheet remains mounted. Invalidate
  // pending reads and release only the local UI ownership before the new target
  // is rendered as actionable. The process-level mutation slot stays occupied
  // until the request settles, so a remounted picker cannot retry an ambiguous
  // POST.
  useEffect(() => {
    generation.current += 1;
    if (structuralOperation.current && structuralOperation.current.scope !== scopeKey) {
      structuralOperation.current = null;
      if (mounted.current) setBusy(false);
    }
    if (mounted.current) setRefreshing(false);
  }, [scopeKey]);

  const currentScope = useLazyRef(() => (): SessionMapOperationScope => ({
    scope: latestScopeKey.current,
    generation: generation.current,
  })).current;

  const isCurrentScope = useLazyRef(
    () =>
      (token: SessionMapOperationScope): boolean =>
        mounted.current &&
        token.scope === latestScopeKey.current &&
        token.generation === generation.current
  ).current;

  function owns(operation: SessionMapOperation): boolean {
    return (
      isCurrentScope(operation) &&
      gatewayOwnsServer() &&
      structuralOperation.current === operation &&
      ownsSessionMapOperation(operation, currentScope())
    );
  }

  function beginStructuralOperation(
    kind: 'structural' | 'create' = 'structural'
  ): SessionMapOperation | null {
    if (!gatewayOwnsServer()) return null;
    const operation = beginSessionMapOperation(currentScope(), kind);
    if (!operation) return null;
    structuralOperation.current = operation;
    setBusy(true);
    return operation;
  }

  function finishStructuralOperation(operation: SessionMapOperation): void {
    finishSessionMapOperation(operation);
    if (structuralOperation.current === operation) {
      structuralOperation.current = null;
      if (mounted.current) setBusy(false);
    }
  }

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

  const load = useCallback(async (): Promise<boolean> => {
    const token = currentScope();
    const request = ++loadRequest.current;
    if (!mounted.current || !gatewayOwnsServer()) return false;
    setLoading(true);
    return settleAfter(
      async () => {
        return recoverWith(
          async () => {
            const [nextWorkspaces, nextTabs, nextPanes, nextAgents] = await Promise.all([
              gatewayTransport.loadWorkspaces(sessionId),
              gatewayTransport.loadTabs(sessionId),
              gatewayTransport.loadPanes(sessionId),
              gatewayTransport.loadAgents(sessionId),
            ]);
            if (request !== loadRequest.current || !isCurrentScope(token) || !gatewayOwnsServer())
              return false;
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
                : (nextWorkspaces.find((item) => Boolean(item.raw.focused))?.id ??
                    nextWorkspaces[0]?.id ??
                    '')
            );
            return true;
          },
          (failure) => {
            if (request === loadRequest.current && isCurrentScope(token) && gatewayOwnsServer())
              setError(describeGatewayFailure(failure, t`Could not load what is running.`).message);
            return false;
          }
        );
      },
      () => {
        if (request === loadRequest.current && isCurrentScope(token) && gatewayOwnsServer())
          setLoading(false);
      }
    );
  }, [activePaneId, currentScope, gatewayOwnsServer, isCurrentScope, sessionId, t]);

  useEffect(() => {
    void load();
  }, [load, scopeKey, t]);

  /**
   * All four rails, in one pass, from `switcherRails`.
   *
   * It used to be three memos in this file -- the workspaces ordered, the tabs
   * grouped, the inventory counted -- and the numbers on the chips came from a
   * different walk of the pane list than the rows they were counting. One
   * function means "the number on that chip is the number of rows tapping it
   * gives you" is true by construction, and it is the only way the machines and
   * the panels can be made to agree about which session is on screen.
   *
   * What is in each workspace is counted rather than read off the workspace
   * record: `pane_count` and `agent_status` are both optional on the wire and
   * the tmux backend sends neither -- `tmux list-sessions` has no per-session
   * pane count to report -- so the rail's number was `0` and its dot grey on
   * every chip, forever, however much was running. Everything needed to answer
   * is already here: `load` fetches the whole session before the sheet draws.
   */
  const rails = useMemo(
    () =>
      switcherRails({
        machines,
        serverId,
        sessionId,
        focusedId,
        pendingId,
        workspaces,
        workspaceId,
        tabs,
        panes,
        agents,
        activePaneId,
      }),
    [
      activePaneId,
      agents,
      focusedId,
      machines,
      panes,
      pendingId,
      serverId,
      sessionId,
      tabs,
      workspaceId,
      workspaces,
    ]
  );

  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  /**
   * Creating workspaces, tabs and panels is Herdr's, not any agent's: it runs
   * over the gateway's REST API rather than being typed into a pane. Agent
   * slash commands live in Quick actions for the same reason in reverse.
   */
  async function runStructuralAction(action: () => Promise<unknown>) {
    const operation = beginStructuralOperation();
    if (!operation) return;
    setError(null);
    return settleAfter(
      async () => {
        try {
          await action();
          if (owns(operation)) await load();
        } catch (failure) {
          if (owns(operation))
            setError(describeGatewayFailure(failure, t`Could not update the session.`).message);
        }
      },
      () => {
        finishStructuralOperation(operation);
      }
    );
  }

  async function reconcileUnknownCreate(operation: SessionMapOperation): Promise<void> {
    markSessionMapOutcomeUnknown(operation);
    if (!owns(operation)) return;
    await load();
    if (owns(operation))
      setError(
        t`The terminal request may have succeeded. Refresh the list and check it before trying again.`
      );
  }

  // Creating focuses the new container in the sheet, so the sheet shows what was
  // just made rather than a refresh landing back on the old focused workspace.
  async function createAndSelect(action: () => Promise<{ workspaceId: string; paneId: string }>) {
    const operation = beginStructuralOperation('create');
    if (!operation) return;
    setError(null);
    return settleAfter(
      async () => {
        try {
          const created = await action();
          if (!created.paneId) {
            await reconcileUnknownCreate(operation);
            return;
          }
          if (!owns(operation)) return;
          if (created.workspaceId) setWorkspaceId(created.workspaceId);

          // The POST response is the authoritative success signal. Refreshing the
          // sheet is useful, but a refresh failure must not discard a pane we already
          // know the gateway created.
          await load();
          if (!owns(operation)) return;
          if (onCreatedPane) {
            try {
              onCreatedPane(created.paneId);
            } catch {
              // Selection is recorded before routing, so the known target remains
              // recoverable in the picker store even when navigation itself fails.
              if (owns(operation))
                setError(t`The new terminal was created, but could not open it.`);
            }
          }
        } catch (failure) {
          const described = describeGatewayFailure(failure, t`Could not update the session.`);
          if (described.retryable) await reconcileUnknownCreate(operation);
          else if (owns(operation)) setError(described.message);
        }
      },
      () => {
        finishStructuralOperation(operation);
      }
    );
  }

  async function refresh() {
    const token = currentScope();
    setRefreshing(true);
    return settleAfter(
      async () => {
        const refreshed = await load();
        if (refreshed && isCurrentScope(token)) {
          clearSessionMapOutcome(token);
        }
      },
      () => {
        if (isCurrentScope(token)) setRefreshing(false);
      }
    );
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
    <SheetScene
      testID="session-map"
      title={t`What is running`}
      caption={activeWorkspace ? `${label} \u00b7 ${activeWorkspace.title}` : label}
      headingTrailing={
        <SheetSceneQuietControl
          testID="panels-refresh"
          accessibilityLabel={t`Refresh`}
          busy={loading}
          onPress={() => void refresh()}>
          <RefreshCw size={17} color={theme.colors.textMuted} />
        </SheetSceneQuietControl>
      }>
      <ScrollView
        nestedScrollEnabled
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={theme.colors.textMuted}
            colors={[theme.colors.primary]}
          />
        }>
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

        {error || unknownCreateOutcome ? (
          <Text selectable variant="caption" color={theme.colors.danger} style={styles.errorLine}>
            {error ??
              t`The terminal request may have succeeded. Refresh the list and check it before trying again.`}
          </Text>
        ) : null}

        {/*
          The top of the address. A machine is the only rung whose chips cannot
          all be tapped straight through to a result: reaching one is a request
          over the network, and one with two backends on it has to ask which.
          So the chip reports where this phone has got to with that machine --
          the dot -- and the rail below it is the question, when there is one.
        */}
        <SheetSceneGroupHeading title={t`Machines`} first />
        <View testID="machines-rail" style={styles.rail}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.railList}>
            {rails.machines.map((machine) => {
              // Spelled into the chip's own label as well as drawn, because a
              // Pressable that carries a label is one accessibility element and
              // the caption inside it stops existing -- the same trap the
              // workspace count fell into on iOS.
              const name = machine.label;
              const state = machineCaption(machine.reach, machine.busy);
              return (
                <RailChip
                  key={machine.id}
                  testID={`machine-chip-${machine.id}`}
                  title={name}
                  caption={state}
                  accessibilityLabel={
                    // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
                    t`Switch to ${name}, ${state}`
                  }
                  selected={machine.current}
                  disabled={machine.disabled}
                  busy={machine.busy}
                  statusColor={reachColor(machine.reach, machine.busy)}
                  onPress={() => {
                    setFocusedId(machine.id);
                    onConnectMachine(machine.id);
                  }}
                />
              );
            })}
          </ScrollView>
          {/* The whole sentence, under the rail rather than clipped into a
              chip's caption: what went wrong with a machine is the one thing
              here a reader has to read rather than scan. */}
          {rails.machines
            .filter((machine) => machine.error)
            .map((machine) => (
              <Text
                key={machine.id}
                selectable
                variant="caption"
                color={theme.colors.textMuted}
                style={styles.machineError}>
                {machine.label} {'·'} {machine.error}
              </Text>
            ))}
        </View>

        {/* Only when there is genuinely a choice, and never for a machine with
            one backend: a rail of a single chip asks the reader to decide
            something already decided, and costs the sheet a row of its height
            to do it. Quieter than the rail above -- one line, no dot -- because
            a backend has no state of its own to report; whether it answers at
            all is the machine's news, and the machine's chip carries it. */}
        {rails.sessions.length > 0 ? (
          <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')}>
            <SheetSceneGroupHeading
              title={t`Sessions`}
              meta={
                <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                  {rails.sessionsOn}
                </Text>
              }
            />
            <View testID="sessions-rail" style={styles.rail}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railList}>
                {rails.sessions.map((session) => {
                  // Named placeholders, which the macro only writes for a plain
                  // identifier: `{label}` and `{kind}` tell a translator which
                  // slot is which, and `{0}` and `{1}` do not.
                  const { label: name, kind } = session;
                  return (
                    <SessionChip
                      key={session.id}
                      testID={`session-chip-${session.id}`}
                      session={session}
                      accessibilityLabel={
                        // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
                        t`Use the ${name} session, ${kind}`
                      }
                      onPress={() => onChooseSession(focusedId ?? serverId, session.id)}
                    />
                  );
                })}
              </ScrollView>
            </View>
          </Animated.View>
        ) : null}

        {/*
          The workspace rail is the sheet's scope, not a peer of the groups
          below it: the title pill's swipe already switches workspaces, so what
          this adds is the inventory -- how many there are, which one you are
          in, and the only way to make another. Chips, which is one of the three
          rounded things a scene allows: a control, not a card.
        */}
        <SheetSceneGroupHeading title={t`Workspaces`} />
        <View testID="workspaces-rail" style={styles.rail}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.railList}>
            {rails.workspaces.map((workspace) => {
              const panelCount = workspace.panels;
              return (
                <RailChip
                  key={workspace.id}
                  title={workspace.title}
                  // The count is spelled into the label rather than left to the
                  // caption inside the chip. A Pressable that carries a label is
                  // one accessibility element on iOS, and everything drawn inside
                  // it -- the name, the `N panels` caption -- stops existing as
                  // far as VoiceOver, or a test, is concerned. Android happens to
                  // expose the children anyway, which is why the count read as
                  // present until this ran on a phone that does not.
                  accessibilityLabel={
                    // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
                    t`Open workspace ${workspace.title}, ${plural(panelCount, { one: '# running', other: '# running' })}. Long press to close.`
                  }
                  /* One ICU message rather than a ternary over two strings: which
                   forms a language needs is the language's business, and Chinese
                   needs one where English needs two. */
                  caption={<Plural value={panelCount} one="# running" other="# running" />}
                  selected={workspace.selected}
                  statusColor={statusColor(workspace.status)}
                  onPress={() => setWorkspaceId(workspace.id)}
                  onLongPress={() =>
                    setMenuFor({ kind: 'workspace', id: workspace.id, label: workspace.title })
                  }
                />
              );
            })}
            <PressableScale
              accessibilityLabel={t`New workspace`}
              disabled={busy || unknownCreateOutcome}
              onPress={() =>
                void createAndSelect(() => createWorkspace(sessionId, { focus: false }))
              }
              style={[
                styles.createChip,
                { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              ]}>
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

        {showSkeleton ? <SessionMapSkeleton /> : null}

        {rails.groups.map((group, groupIndex) => (
          // A tab created or closed used to pop a whole group in, or snap every
          // group below it up into the space. `riseIn` staggers the groups on a
          // first load so the sheet arrives as a list rather than all at once,
          // and `listLayout` is what makes a delete read as the rest closing the
          // gap.
          <Animated.View
            key={group.tab.id}
            entering={riseIn(groupIndex * STAGGER.card)}
            exiting={fadeOut('micro')}
            layout={listLayout('short')}>
            {groupIndex > 0 ? <SheetSceneGroupRule /> : null}
            {/*
              The tab is a header, not a filter. Long press is where its rename
              and close live, the same long press every other row in the app
              uses -- so the heading is wrapped rather than restyled, and the
              action menu rides the heading's own trailing slot.
            */}
            <PressableScale
              accessibilityLabel={t`Group ${group.tab.title}. Long press for actions.`}
              feedback={false}
              onLongPress={() =>
                setMenuFor({ kind: 'tab', id: group.tab.id, label: group.tab.title })
              }>
              {/* No count here. The panels it counted are the next thing on the
                  screen, so the heading was reporting the length of a list the
                  reader was already looking at. What the heading is for is
                  naming the tab. */}
              <SheetSceneGroupHeading
                title={group.tab.title}
                meta={actionMenu('tab', group.tab.id)}
              />
            </PressableScale>

            {group.panes.map(({ pane, agent, title, detail, status, selected }) => {
              const armed = menuFor?.kind === 'panel' && menuFor.id === pane.id;
              return (
                <PanelRow
                  key={pane.id}
                  accessibilityLabel={t`Open ${title}. Long press to close.`}
                  title={title}
                  detail={detail}
                  status={status}
                  hasAgent={Boolean(agent)}
                  selected={selected}
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
                style={styles.emptyGroup}>
                <Text variant="caption" color={theme.colors.textMuted}>
                  <Trans>This group has no terminals.</Trans>
                </Text>
              </Animated.View>
            ) : null}
          </Animated.View>
        ))}

        {!loading && rails.groups.length === 0 ? (
          <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')}>
            <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyGroup}>
              <Trans>This workspace has no groups yet.</Trans>
            </Text>
          </Animated.View>
        ) : null}

        {/* A new full panel (a new tab), not a split -- two panes sharing one
            small phone screen is unreadable, and the pane strip already lets you
            flip between panels. A row and not a filled button: this sheet is for
            picking, not for creating, and the last row of a list is already the
            most findable thing on it. */}
        <SheetSceneGroupRule />
        <SheetSceneRow
          title={t`New terminal`}
          accessibilityLabel={t`New terminal`}
          disabled={busy || unknownCreateOutcome || !workspaceId}
          leading={<Plus size={17} color={theme.colors.textMuted} />}
          onPress={() =>
            void createAndSelect(() =>
              createTab(sessionId, { workspace_id: workspaceId, focus: false })
            )
          }
        />

        {/* What the machines sheet could do that is not a pick. Two lines of
            text side by side at the very end, not two buttons and not two rows:
            a sheet with one primary action has decided what it is for, and this
            one is for choosing a terminal. Both of them leave the sheet. */}
        <View style={styles.machineActions}>
          <SheetSceneQuietAction
            testID="add-machine"
            label={t`Add machine`}
            onPress={onAddMachine}
            disabled={pendingId !== null}
          />
          <SheetSceneQuietAction
            testID="manage-machines"
            label={t`Manage machines`}
            onPress={onManageMachines}
            disabled={pendingId !== null}
          />
        </View>
        {/* The rename field can be anywhere in this column, so the keyboard's
            own strip goes at the end of the scroller rather than under it. */}
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}

/**
 * One chip in a rail: a name, a dot for how it stands, and one line saying so.
 *
 * Written once for the machines and for the workspaces, because they are the
 * same object seen at two scales -- a name, a round status mark, and a line of
 * detail under it -- and drawing them twice is how two rails on one sheet end
 * up disagreeing about what selection looks like.
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
function RailChip({
  testID,
  title,
  caption,
  accessibilityLabel,
  selected,
  disabled = false,
  busy = false,
  statusColor: dotColor,
  onPress,
  onLongPress,
}: {
  testID?: string;
  title: string;
  /** The line under the name: a count, or where this phone has got to. */
  caption: ReactNode;
  accessibilityLabel: string;
  selected: boolean;
  disabled?: boolean;
  /** This chip is waiting on the network, so its dot breathes. */
  busy?: boolean;
  statusColor: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const surfaceBackground = useSurfaceBackground();
  const theme = useThemeTokens();
  const chosen = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    chosen.set(withTiming(selected ? 1 : 0, timing('toggle')));
  }, [chosen, selected]);

  // A breath, not a spinner. A spinner in the dot's place is 20pt where 7pt
  // was, so every chip to its right moves while a machine is being reached --
  // and the one thing a reader is doing at that moment is looking at the rail.
  // `PULSE_PERIOD` is the app's "answering right now" period, the same one the
  // live status dot and the pairing screen breathe on.
  const breath = useSharedValue(1);
  useEffect(() => {
    breath.set(
      busy
        ? withRepeat(withTiming(0.25, timing(PULSE_PERIOD)), -1, true)
        : withTiming(1, timing('short'))
    );
  }, [breath, busy]);

  const restingStyle = useAnimatedStyle(() => ({ opacity: 1 - chosen.value }));
  const selectedStyle = useAnimatedStyle(() => ({ opacity: chosen.value }));
  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      layout={listLayout('short')}>
      <PressableScale
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected, disabled, busy }}
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        style={[
          styles.railChip,
          {
            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
          },
          disabled ? { opacity: appChrome.opacity.disabled } : null,
        ]}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.chipFill,
            { backgroundColor: surfaceBackground(theme.colors.text) },
            selectedStyle,
          ]}
        />
        {/* The dot keeps its own colour when the chip is selected rather than
            going mono like the lettering: it is the one thing on the chip that
            is not about the thing's identity but about whether it wants you,
            and that stays true after you have tapped it. */}
        <View style={styles.statusDot}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.dotFill,
              { backgroundColor: dotColor },
              breathStyle,
            ]}
          />
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
              {caption}
            </Text>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, selectedStyle]}>
            <Text variant="bodySmall" color={theme.colors.surface} numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" color={theme.colors.surface} numberOfLines={1}>
              {caption}
            </Text>
          </Animated.View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

/**
 * One backend on one machine: the quiet rail.
 *
 * A backend has no state of its own to report -- whether the machine answers at
 * all is the machine's news, and the chip above this rail is already carrying
 * it -- so this one has no dot and one line, and it is shorter than the rails
 * either side of it. That is the whole of what "quieter" means here: less to
 * read, not greyer. The rail only exists when there are two or more of them.
 *
 * The kind (`herdr`, `tmux`) rides after the label, and only when it is not
 * simply the label again: a gateway that labels its tmux socket "tmux" would
 * otherwise draw "tmux tmux". Same rule, same reason, as `panelTitle`.
 *
 * Selection is the rail's own device -- ink and surface swapped -- rather than
 * the accent, which this sheet spends once, on the panel you are in.
 */
function SessionChip({
  testID,
  session,
  accessibilityLabel,
  onPress,
}: {
  testID?: string;
  session: SessionRailItem;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const surfaceBackground = useSurfaceBackground();
  const theme = useThemeTokens();
  const chosen = useSharedValue(session.selected ? 1 : 0);
  useEffect(() => {
    chosen.set(withTiming(session.selected ? 1 : 0, timing('toggle')));
  }, [chosen, session.selected]);

  const restingStyle = useAnimatedStyle(() => ({ opacity: 1 - chosen.value }));
  const selectedStyle = useAnimatedStyle(() => ({ opacity: chosen.value }));
  const kind = session.kind.toLowerCase() === session.label.toLowerCase() ? '' : session.kind;

  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      layout={listLayout('short')}>
      <PressableScale
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected: session.selected, disabled: session.disabled }}
        disabled={session.disabled}
        onPress={onPress}
        style={[
          styles.sessionChip,
          { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
          session.disabled ? { opacity: appChrome.opacity.disabled } : null,
        ]}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.chipFill,
            { backgroundColor: surfaceBackground(theme.colors.text) },
            selectedStyle,
          ]}
        />
        <Animated.View style={[styles.sessionChipCopy, restingStyle]}>
          <Text variant="caption" color={theme.colors.text} numberOfLines={1}>
            {session.label}
          </Text>
          {kind ? (
            <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
              {kind}
            </Text>
          ) : null}
        </Animated.View>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.sessionChipCopy, selectedStyle]}
          pointerEvents="none">
          <Text variant="caption" color={theme.colors.surface} numberOfLines={1}>
            {session.label}
          </Text>
          {kind ? (
            <Text variant="caption" color={theme.colors.surface} numberOfLines={1}>
              {kind}
            </Text>
          ) : null}
        </Animated.View>
      </PressableScale>
    </Animated.View>
  );
}

/**
 * One panel, as the scene's row.
 *
 * Creating a panel used to pop a row into the middle of a card and closing one
 * snapped every row below it upwards; the highlight on the panel you are
 * actually in changed on the frame the selection did. All three are the same
 * fix -- arrive, leave, and travel between the two -- and the last of them is
 * `SheetSceneRow`'s now: the left rule fades out of the row that is leaving
 * before it fades into the row that is arriving.
 *
 * What is left here is the glyph, which is the one thing on the row the scene
 * cannot colour for it. An agent's keeps its status colour whether or not the
 * row is selected: that colour is the only report of what the agent is doing,
 * and losing it on the row you are looking at would be losing it where it
 * matters most. A shell has nothing to report, so its glyph is free to carry
 * the selection -- and it carries it as a cross-fade between two drawn copies,
 * not as a colour that changes on one frame.
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
  trailing: ReactNode;
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
    chosen.set(withTiming(selected ? 1 : 0, timing('toggle')));
  }, [chosen, selected]);

  const restingStyle = useAnimatedStyle(() => ({ opacity: 1 - chosen.value }));
  const selectedStyle = useAnimatedStyle(() => ({ opacity: chosen.value }));

  return (
    <Animated.View
      entering={fadeIn('short')}
      exiting={fadeOut('micro')}
      layout={listLayout('short')}>
      <SheetSceneRow
        accessibilityLabel={accessibilityLabel}
        title={title}
        selected={selected}
        onPress={onPress}
        onLongPress={onLongPress}
        trailing={trailing}
        leading={
          hasAgent ? (
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
          )
        }
        caption={
          /*
            Status and place on one line, status first.

            The status used to be a word at the row's trailing edge, where it
            took about 46pt off the title of exactly the rows worth reading --
            the ones with an agent in them. It is the same word in the same
            colour here, in front of the path, on a line that already existed:
            the title gets the width back and the row does not get taller. The
            middot is the separator the address language already uses.

            Through `agentStatusWord`, not straight out of `status`. `status` is
            the gateway's wire vocabulary -- `working`, `blocked`, `idle` -- and
            rendering it put a lower-case English word on this row in all eight
            languages, beside a title and a path that were translated. A status
            the table does not know reads as "unknown" rather than falling back
            to the raw word: wire vocabulary is not copy, so it should not reach
            a user even when it is unrecognised.
          */
          status && status !== 'unknown' ? (
            <>
              <Text variant="caption" color={statusColor(status)}>
                {_(agentStatusWord[status] ?? agentStatusWord.unknown)}
              </Text>
              {' \u00b7 '}
              {detail}
            </>
          ) : (
            detail
          )
        }
      />
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
 * Shaped like what is coming -- a heading and three rows on the ground -- so
 * the layout does not move when the answer lands.
 */
function SessionMapSkeleton() {
  const { t } = useLingui();
  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('short')}
      accessibilityLabel={t`Loading`}>
      <View style={styles.skeletonHeading}>
        <Skeleton variant="text" width={120} height={12} />
      </View>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <Skeleton variant="rect" width={15} height={15} />
          <View style={styles.flexOne}>
            <Skeleton variant="text" width="62%" height={13} />
            {/* Longer than it was: the second line now carries the status in
                front of the path, so the shape it stands in for is longer. */}
            <Skeleton variant="text" width="52%" height={10} style={styles.skeletonDetail} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  errorLine: {
    paddingTop: SHEET_LADDER.gap,
  },
  rail: {
    gap: SHEET_LADDER.gap,
    paddingTop: SHEET_LADDER.snug,
  },
  railList: {
    gap: SHEET_LADDER.gap,
    paddingRight: SHEET_LADDER.gutter,
  },
  /**
   * Rounded rectangles rather than full pills: at this height a 20pt radius
   * leaves no straight edge, which reads as a lozenge next to the rows below.
   *
   * The same 50pt minimum as a scene row, and for the same reason: both are a
   * name over a line of detail beside a small round status mark, so giving them
   * one height makes the rail and the list read as one system seen twice rather
   * than as two components that happen to share a sheet.
   */
  railChip: {
    minWidth: 118,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  /**
   * The sessions rail: one line of caption, so about two thirds the height of
   * the chips either side of it. The rail reads as a footnote to the machine
   * above it rather than as a third peer, which is what it is.
   */
  sessionChip: {
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  sessionChipCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  // The whole failure, under the rail it belongs to.
  machineError: {
    lineHeight: 17,
    paddingTop: SHEET_LADDER.tight,
  },
  // Two lines of text sharing one line of the sheet, centred together rather
  // than pushed to the two edges: they are a pair, not opposites.
  machineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SHEET_LADDER.section,
    paddingTop: SHEET_LADDER.gap,
  },
  // The selected fill is one layer, so selection fades in rather than changing
  // several inline colours on the same frame.
  chipFill: {
    borderRadius: appChrome.radius.control,
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
  skeletonHeading: {
    minHeight: 28,
    justifyContent: 'center',
    marginTop: SHEET_LADDER.gap,
    marginBottom: SHEET_LADDER.gap,
  },
  skeletonRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.snug,
    paddingVertical: SHEET_LADDER.snug,
  },
  skeletonDetail: {
    marginTop: 4,
  },
  createChip: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
  },
  emptyGroup: {
    paddingVertical: SHEET_LADDER.snug,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
  },
  renameBlock: {
    gap: SHEET_LADDER.gap,
    paddingTop: SHEET_LADDER.snug,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SHEET_LADDER.gap,
  },
});
