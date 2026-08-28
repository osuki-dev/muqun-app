/**
 * Quick actions: one thing done to the pane in front of you.
 *
 * The sheet is opened from a pane's lightning button, which means the reader is
 * already looking at the thing they want to act on. Everything here is arranged
 * around that: the rows are short, the sheet closes as soon as one is taken,
 * and nothing on it asks to be read twice.
 *
 * Three decisions carry the design, and each replaces something that was here:
 *
 * 1. The typeface is the taxonomy. A row whose second line is set in the
 *    terminal's monospace is a row that types that text into the pane; a row
 *    whose second line is prose does something else. That is what the forty
 *    leading icon chips were failing to say -- several of them restated their
 *    own row (a slash beside `/model`, a terminal beside `git status`), and all
 *    forty spent the accent on a screen the rest of the app spends it on once.
 *
 * 2. A key combo is drawn as keys, not as text. `ctrl+c` and `git status` leave
 *    by different gateway calls -- `sendPaneKeys` against `sendPaneText` plus
 *    Return -- and a shell handed "ctrl+c" as characters does nothing with it.
 *    The distinction is real, so it is drawn, and drawn in the same key face
 *    the on-screen keyboard already uses rather than as another icon.
 *
 * 3. Authoring is a mode, not a permanent fixture. The two-field editor used to
 *    sit under every row on the sheet, so reaching it meant scrolling the whole
 *    catalogue, and six danger-coloured delete buttons stood in the tap column
 *    of a surface whose rows fire the moment they are touched. Both now appear
 *    only under Edit. The Settings entry (`manage=1`) is that mode and nothing
 *    else, because it has no pane to act on.
 *
 * Colour is spent twice and only ever to mean something: `danger` on Stop, which
 * is the one row here that throws work away, and `primary` on the mark that says
 * a row is in flight. At rest the sheet has no tinted chrome at all.
 */
import {
  Button,
  Card,
  Input,
  Skeleton,
  Spinner,
  Tabs,
  Text,
  useThemeTokens,
} from '@osuki-dev/ui';
// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Trash2, X } from 'lucide-react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { LADDER, SettingsCard } from '@/components/settings-chrome';
import { appChrome } from '@/constants/appearance';
import { usePaneViewMode } from '@/hooks/use-pane-view-mode';
import { withAlpha } from '@/lib/color';
import { fadeIn, fadeOut, listLayout, riseIn, STAGGER } from '@/lib/motion';
import {
  createTab,
  interruptAgent,
  splitPane,
  loadPaneShortcuts,
  sendAgentText,
  sendPaneKeys,
  sendPaneText,
  type SlashCommand,
} from '@/lib/gateway-client';
import { describeGatewayFailure } from '@/lib/network-error';
import { quickActionAvailability } from '@/lib/quick-actions';
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';
import { useComposerDraftStore } from '@/stores/composer-draft';
import { usePanelPickerStore } from '@/stores/panel-picker';
import {
  addQuickCommand,
  hasHiddenDefaults,
  loadQuickCommands,
  quickCommandKeys,
  removeQuickCommand,
  restoreDefaultCommands,
  type QuickCommand,
  type QuickCommandKind,
  type QuickCommandMode,
} from '@/lib/quick-commands';
import { quickCommandName } from '@/i18n/labels';

/**
 * The face a value is set in when tapping the row types that value into the
 * pane. It is the one piece of the terminal's own vocabulary this sheet
 * borrows, and it is what tells a command apart from a description.
 */
const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/**
 * Spread into every style that carries the terminal's face.
 *
 * `Text` takes one flattened style rather than an array, so the three places
 * that need this compose it at module scope instead of stacking styles at the
 * call site.
 */
const MONO_TEXT = {
  fontFamily: MONO_FONT,
  // What is typed is typed exactly as it reads, so the instrument styles'
  // uppercasing would be a lie about what the pane receives.
  textTransform: 'none',
} as const;

export default function QuickCommandsScreen() {
  const router = useRouter();
  const theme = useThemeTokens();
  // `t` from the hook, never the global `t` from `@lingui/core/macro`: React
  // Compiler memoizes a global `t` call whose arguments have not changed and
  // has no way to know the result also depends on the active locale, which
  // leaves the screen half-translated after a language switch.
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isPadLayout = responsiveWorkspaceLayout(width).mode === 'pad';
  const params = useLocalSearchParams<{
    sessionId: string;
    paneId: string;
    // Only the terminal sends these; the Settings entry opens this screen to
    // manage the saved shortcuts and has no pane to make anything next to.
    serverId?: string;
    workspaceId?: string;
    tabId?: string;
    /** Where the pane behind the sheet is, so a new task starts there too. */
    cwd?: string;
    mode?: string;
    manage?: string;
    /**
     * Whether this gateway said it can start and stop an agent.
     *
     * Passed rather than read from the capability mirror the home card uses:
     * the screen that opened this sheet is holding the health answer itself,
     * and going through a mirror would make the demo -- which has no mirrored
     * server -- the one place the rows are missing.
     */
    canSpawn?: string;
    /**
     * Whether this connection is one where opening a plain URL is honest.
     *
     * Passed rather than derived here for the same reason as `canSpawn`: the
     * screen that opened this sheet is holding the health answer, and it is the
     * only thing that knows both the transport the gateway reported and whether
     * this is the demo.
     */
    canOpenWeb?: string;
    /** This pane's agent, and what it is doing, for the Stop row. */
    agentTarget?: string;
    agentStatus?: string;
  }>();
  const mode: QuickCommandMode = params.mode === 'agent' ? 'agent' : 'terminal';
  const manageOnly = params.manage === '1';
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<QuickCommandKind>('command');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentCommands, setAgentCommands] = useState<SlashCommand[]>([]);
  // The gateway is asked what this pane understands, and until it answers the
  // section is not absent -- it is pending. Those are different things to show,
  // and showing the first for the second is what made this list pop in fully
  // populated a beat after the sheet had settled.
  const [loadingAgentCommands, setLoadingAgentCommands] = useState(false);
  const [canRestore, setCanRestore] = useState(false);
  const [creating, setCreating] = useState<'panel' | 'tab' | null>(null);
  const [stopping, setStopping] = useState(false);
  // Authoring is off until it is asked for. The Settings entry is the editor,
  // so it has nothing to ask for and no way back out of it.
  const [editRequested, setEditRequested] = useState(false);
  const editing = manageOnly || editRequested;
  const prefillDraft = useComposerDraftStore((state) => state.prefillDraft);
  const choosePanel = usePanelPickerStore((state) => state.choosePanel);

  // Which rows exist at all, decided once from the route's params rather than
  // as five boolean chains spread through the markup.
  const available = quickActionAvailability({
    sessionId: params.sessionId,
    paneId: params.paneId,
    serverId: params.serverId,
    spawnSupported: params.canSpawn === '1',
    webServiceSupported: params.canOpenWeb === '1',
    agentTarget: params.agentTarget,
    agentStatus: params.agentStatus,
    manageOnly,
  });

  // The same per-pane view memory the pane header's own control writes to, so
  // the two cannot disagree about what this pane is being read as. `parts` is
  // not asked for here: with the chat view behind its flag an agent pane has
  // exactly two readings, and the toggle is the cycle between them.
  const paneView = usePaneViewMode({
    serverId: params.serverId ?? '',
    paneId: params.paneId ?? '',
    agent: mode === 'agent',
    parts: false,
  });
  // Only agent panes have a second reading -- reflowing a plain shell loses the
  // grid that is the entire point of it -- so only they are offered the switch.
  const canSwitchView = available.canCreate && mode === 'agent' && paneView.canCycle;

  useEffect(() => {
    void loadQuickCommands(mode).then(setCommands);
    void hasHiddenDefaults().then(setCanRestore);
  }, [mode]);

  // The agent's own slash commands, straight from the gateway. They sit beside
  // the saved prompts rather than replacing them: one is what this agent
  // understands, the other is what the user asks for often.
  useEffect(() => {
    if (!params.sessionId || !params.paneId) return;
    let cancelled = false;
    setLoadingAgentCommands(true);
    void loadPaneShortcuts(params.sessionId, params.paneId)
      .then((value) => {
        if (cancelled) return;
        setAgentCommands(value.commands);
        setLoadingAgentCommands(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAgentCommands([]);
        setLoadingAgentCommands(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.paneId, params.sessionId]);

  async function run(command: QuickCommand) {
    if (!params.paneId || !params.sessionId || sendingId) return;
    setSendingId(command.id);
    setError(null);
    try {
      if (mode === 'agent') {
        await sendAgentText(params.sessionId, params.paneId, command.value);
      } else if (command.kind === 'keys') {
        await sendPaneKeys(params.sessionId, params.paneId, quickCommandKeys(command));
      } else {
        await sendPaneText(params.sessionId, params.paneId, command.value);
        await sendPaneKeys(params.sessionId, params.paneId, ['enter']);
      }
      router.back();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`Could not send shortcut.`);
      setSendingId(null);
    }
  }

  async function runSlashCommand(entry: SlashCommand) {
    if (!params.paneId || !params.sessionId || sendingId) return;
    // A command that takes an argument cannot be fired blind: hand it to the
    // composer with the cursor after it so the argument can be typed.
    if (entry.argument_hint) {
      prefillDraft(`${entry.command} `);
      router.back();
      return;
    }
    setSendingId(entry.command);
    setError(null);
    try {
      if (mode === 'agent') {
        await sendAgentText(params.sessionId, params.paneId, entry.command);
      } else {
        // An editor's `:q` is text plus Return, not an agent message: this pane
        // has no agent to send to.
        await sendPaneText(params.sessionId, params.paneId, entry.command);
        await sendPaneKeys(params.sessionId, params.paneId, ['enter']);
      }
      router.back();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`Could not send command.`);
      setSendingId(null);
    }
  }

  /**
   * A new panel, in the workspace the pane you came from lives in.
   *
   * A "panel" and a "tab" are one and the same herdr object, so both rows call
   * the same create. What differs is whose focus follows it: `focus: false`
   * leaves the desktop showing whatever it was showing -- the phone wanders off
   * on its own -- while `focus: true` moves herdr's focus too, so the desk lands
   * on the new thing as well. Either way the phone goes to what it just made,
   * which is the whole point of doing this from the terminal instead of the
   * panels sheet.
   */
  async function create(focus: boolean) {
    const serverId = params.serverId;
    if (!available.canCreate || creating || !serverId) return;
    setCreating(focus ? 'tab' : 'panel');
    setError(null);
    try {
      // Two different objects, not one object with two focuses: a new panel is
      // a split of the tab the reader is in (Ellen: "add it underneath the tab
      // you are on"), and only a new tab is a new tab.
      const target = focus
        ? await createTab(params.sessionId, {
            workspace_id: params.workspaceId,
            focus,
          })
        : await splitPane(params.sessionId, params.paneId, { direction: 'down' });
      // The create is what names the new pane. Without that id there is nothing
      // to send the phone to, and choosing an empty one would clear the
      // terminal instead -- so say so and stay put.
      if (!target.paneId) {
        setError(t`The server did not say which terminal it made.`);
        setCreating(null);
        return;
      }
      choosePanel({ serverId, paneId: target.paneId });
      router.back();
    } catch (failure) {
      // Reported here rather than by closing the sheet: a sheet that dismisses
      // itself onto the pane you were already on has told you nothing.
      setError(failure instanceof Error ? failure.message : t`Could not start a terminal.`);
      setCreating(null);
    }
  }

  /**
   * Hand the whole question over to the New Task sheet.
   *
   * `replace` rather than `push`: this sheet and that one are two answers to
   * the same tap, and stacking them would put a form sheet on a form sheet and
   * leave Back pointing at a list nobody is coming back to. Replacing means the
   * new pane is one dismissal away, which is what `origin: 'pane'` tells it.
   */
  function startTask() {
    if (!available.canStartTask) return;
    router.replace({
      pathname: '/new-task',
      params: {
        serverId: params.serverId,
        sessionId: params.sessionId,
        // The tab on screen and the directory the current pane is in: a task
        // begun from a pane starts beside it unless the sheet is told otherwise.
        ...(params.tabId ? { tabId: params.tabId } : {}),
        ...(params.cwd ? { cwd: params.cwd } : {}),
        origin: 'pane',
      },
    } as Href);
  }

  /**
   * Hand over to the sheet that opens a port on this machine.
   *
   * `replace`, like New task: this sheet is finished with, and stacking a second
   * form sheet on top of it would leave a Back that lands on a list nobody was
   * coming back to.
   */
  function openWebService() {
    if (!available.canOpenWebService) return;
    router.replace({
      pathname: '/web-service',
      params: { serverId: params.serverId },
    } as Href);
  }

  /**
   * Hand over to the simulator preview.
   *
   * `canOpenWeb` travels on rather than being recomputed: the screen that
   * opened this sheet is the one holding the health answer, and its gate has a
   * term nothing downstream can see -- the demo is excluded before the
   * transport is even consulted, because its record points at an address that
   * does not exist. Re-deriving here would quietly drop that.
   */
  function openSimulatorPreview() {
    if (!available.canPreviewSimulator) return;
    router.replace({
      pathname: '/simfarm',
      params: { serverId: params.serverId, allowed: params.canOpenWeb === '1' ? '1' : '' },
    } as Href);
  }

  /**
   * Stop what this pane's agent is doing.
   *
   * The app sends one interrupt and says nothing else about it: which agent
   * that reaches, and what stopping means for the one it reaches, is the
   * gateway's to know. The sheet closes on success because the answer is
   * behind it -- the pane's own status is what says it worked.
   */
  async function stopAgent() {
    const target = params.agentTarget;
    if (!available.canStopAgent || stopping || !target) return;
    setStopping(true);
    setError(null);
    try {
      await interruptAgent(params.sessionId, target);
      router.back();
    } catch (failure) {
      setError(describeGatewayFailure(failure, t`Could not stop this agent.`).message);
      setStopping(false);
    }
  }

  /**
   * Flip this pane between its terminal and its reflowed text, then get out of
   * the way -- the point of the row is the pane behind the sheet, so staying
   * open would hide the only thing that changed.
   */
  function switchView() {
    paneView.cycle();
    router.back();
  }

  async function add() {
    if (!label.trim() || !value.trim()) return;
    setCommands(await addQuickCommand(mode, label, value, kind));
    setLabel('');
    setValue('');
  }

  async function remove(id: string) {
    setCommands(await removeQuickCommand(id, mode));
    setCanRestore(await hasHiddenDefaults());
  }

  async function restore() {
    setCommands(await restoreDefaultCommands(mode));
    setCanRestore(false);
  }

  return (
    // The editor is the reason for the keyboard-aware scroller: a plain
    // ScrollView left both inputs under the keyboard, with the save button out
    // of reach entirely.
    <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          isPadLayout && styles.padContent,
          { paddingBottom: LADDER.section + bottomInset },
        ]}>
        {process.env.EXPO_OS === 'android' ? <View style={styles.sheetHandle} /> : null}

        {/* No glyph beside the title. The reader arrived here by pressing the
            lightning button, so a lightning chip repeats the gesture back at
            them -- and it was the first of the forty places this screen spent
            the accent. */}
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text variant="subheading" style={styles.headerTitle}>
              {manageOnly ? t`Quick action settings` : t`Quick actions`}
            </Text>
            <Text variant="caption" color={theme.colors.textMuted}>
              {manageOnly
                ? t`Customize terminal commands and key combinations.`
                : mode === 'agent'
                  ? t`Send a prompt to this agent.`
                  : t`Run a command or key combo.`}
            </Text>
          </View>
          <PressableScale
            accessibilityLabel={t`Close quick actions`}
            onPress={() => router.back()}
            style={[styles.closeButton, { backgroundColor: theme.colors.surface }]}>
            <X size={19} color={theme.colors.text} />
          </PressableScale>
        </View>

        {/* Alone on its own surface rather than first in the list below, which
            is the point: while an agent is working this row exists, and while
            it does not, it does not. A row that came and went inside the list
            would slide New task under whatever the thumb had learned, on the
            one sheet where a mistap sends something to a live agent. Here the
            list beneath it never reorders. */}
        {available.canStopAgent ? (
          <Animated.View entering={fadeIn('micro')} exiting={fadeOut('micro')}>
            <View style={[styles.group, { backgroundColor: theme.colors.dangerSubtle }]}>
              <ActionRow
                accessibilityLabel={t`Stop this agent`}
                name={t`Stop`}
                nameColor={theme.colors.danger}
                detail={t`Interrupt what this agent is doing.`}
                detailColor={theme.colors.textMuted}
                busy={stopping}
                busyColor={theme.colors.danger}
                disabled={stopping}
                onPress={() => void stopAgent()}
              />
            </View>
          </Animated.View>
        ) : null}

        {/* The sheet's own verbs, in one surface with a hairline between them.
            Ordered by how far each one takes you from the pane you are looking
            at: three that make somewhere to work, then how this pane is drawn,
            then the machine underneath it. Nothing here is titled -- the
            sheet's own name is already the heading for its own verbs. */}
        {available.hasActions ? (
          <SettingsCard>
            {available.canStartTask ? (
              <ActionRow
                accessibilityLabel={t`New task`}
                name={t`New task`}
                detail={t`Start an agent and send it the first thing to do.`}
                detailColor={theme.colors.textMuted}
                disabled={creating !== null}
                onPress={startTask}
              />
            ) : null}
            {available.canCreate ? (
              <ActionRow
                accessibilityLabel={t`New terminal`}
                name={t`New terminal`}
                detail={t`Split this group and go to what it makes.`}
                detailColor={theme.colors.textMuted}
                busy={creating === 'panel'}
                busyColor={theme.colors.primary}
                disabled={creating !== null}
                onPress={() => void create(false)}
              />
            ) : null}
            {available.canCreate ? (
              <ActionRow
                accessibilityLabel={t`New group`}
                name={t`New group`}
                detail={t`Open a group of its own and go to it.`}
                detailColor={theme.colors.textMuted}
                busy={creating === 'tab'}
                busyColor={theme.colors.primary}
                disabled={creating !== null}
                onPress={() => void create(true)}
              />
            ) : null}
            {/* Named for where it goes, not for where it is: a row that read
                "Terminal" while the pane was already a terminal is a label, and
                this is a button. */}
            {canSwitchView ? (
              <ActionRow
                accessibilityLabel={
                  paneView.mode === 'terminal' ? t`Render as text` : t`Render as terminal`
                }
                name={paneView.mode === 'terminal' ? t`Render as text` : t`Render as terminal`}
                detail={
                  paneView.mode === 'terminal'
                    ? t`Agent output reflowed for reading. Colour is lost.`
                    : t`The raw pane, on its grid and in its own colours.`
                }
                detailColor={theme.colors.textMuted}
                disabled={creating !== null}
                onPress={switchView}
              />
            ) : null}
            {/* Last, because it is the only row that does not act on the pane
                behind this sheet: it reaches past it to the machine that pane
                runs on, and leaves the app for the browser. */}
            {available.canPreviewSimulator ? (
              <ActionRow
                accessibilityLabel={t`Preview a simulator`}
                name={t`Preview a simulator`}
                detail={t`Watch this machine's iOS, Android or WeChat simulator.`}
                detailColor={theme.colors.textMuted}
                onPress={openSimulatorPreview}
              />
            ) : null}
            {available.canOpenWebService ? (
              <ActionRow
                accessibilityLabel={t`Open a web service`}
                name={t`Open a web service`}
                detail={t`Open a port on this machine in your browser.`}
                detailColor={theme.colors.textMuted}
                onPress={openWebService}
              />
            ) : null}
          </SettingsCard>
        ) : null}

        <View style={styles.section}>
          <SectionHeading
            title={t`SHORTCUTS`}
            // Settings' entry is the editor, so it has no state to toggle and
            // offers no way to leave a mode that is the whole screen.
            action={
              manageOnly ? null : (
                <PressableScale
                  accessibilityLabel={editing ? t`Done editing shortcuts` : t`Edit shortcuts`}
                  onPress={() => setEditRequested((was) => !was)}
                  style={styles.headingAction}>
                  <Text variant="label" color={theme.colors.text}>
                    {editing ? t`Done` : t`Edit`}
                  </Text>
                </PressableScale>
              )
            }
          />
          <SettingsCard>
            {commands.map((command, index) => {
              // A default's name is ours to translate; a custom one is the
              // user's own word, shown exactly as they typed it.
              const descriptor = command.custom ? undefined : quickCommandName[command.id];
              const name = descriptor ? _(descriptor) : command.label;
              return (
                // Adding, deleting and restoring all rewrite this list, and each
                // of them used to pop a row in or snap the rest up into the gap.
                // The stagger is on the entrance only, so a first open reads as
                // a list arriving and a single delete is just the one row
                // leaving.
                <Animated.View
                  key={command.id}
                  entering={riseIn(index * STAGGER.row)}
                  exiting={fadeOut('micro')}
                  layout={listLayout('short')}>
                  <ActionRow
                    accessibilityLabel={name}
                    name={name}
                    // A key combo is keys and a command is characters; they
                    // leave by different calls, so they are drawn differently.
                    value={command.kind === 'keys' ? undefined : command.value}
                    keys={command.kind === 'keys' ? quickCommandKeys(command) : undefined}
                    detailColor={theme.colors.textMuted}
                    busy={sendingId === command.id}
                    busyColor={theme.colors.primary}
                    // In edit mode a row is what is being edited, not what is
                    // being sent: it stops firing so that reaching for its
                    // delete cannot send it to a live pane instead.
                    disabled={editing || Boolean(sendingId)}
                    onPress={editing ? undefined : () => void run(command)}
                    trailing={
                      editing ? (
                        // Every command can be removed -- custom ones are
                        // deleted, built-in defaults are hidden and can be
                        // restored below -- so the defaults are never forced on
                        // anyone.
                        <PressableScale
                          accessibilityLabel={command.custom ? t`Delete ${name}` : t`Hide ${name}`}
                          onPress={() => void remove(command.id)}
                          style={styles.deleteButton}>
                          <Trash2 size={16} color={theme.colors.danger} />
                        </PressableScale>
                      ) : null
                    }
                  />
                </Animated.View>
              );
            })}
            {editing && canRestore ? (
              <Animated.View
                entering={fadeIn('short')}
                exiting={fadeOut('micro')}
                layout={listLayout('short')}>
                <ActionRow
                  accessibilityLabel={t`Restore hidden default commands`}
                  name={t`Restore hidden defaults`}
                  nameColor={theme.colors.textMuted}
                  onPress={() => void restore()}
                />
              </Animated.View>
            ) : null}
          </SettingsCard>
        </View>

        {!manageOnly && loadingAgentCommands ? (
          // The section's own shape while the gateway is being asked for it. It
          // is the same height as the rows that replace it, so the sheet does
          // not move when the answer lands -- which was the other half of the
          // pop.
          <Animated.View
            entering={fadeIn('micro')}
            exiting={fadeOut('short')}
            style={styles.section}
            accessibilityLabel={t`Loading commands`}>
            <Skeleton variant="text" width={110} height={11} style={styles.headingSkeleton} />
            <SettingsCard>
              {[0, 1].map((row) => (
                <View key={row} style={styles.row}>
                  <View style={styles.rowCopy}>
                    <Skeleton variant="text" width="42%" height={14} />
                    <Skeleton variant="text" width="68%" height={12} style={styles.skeletonDetail} />
                  </View>
                </View>
              ))}
            </SettingsCard>
          </Animated.View>
        ) : null}

        {!manageOnly && !loadingAgentCommands && agentCommands.length > 0 ? (
          <Animated.View entering={fadeIn('short')} style={styles.section}>
            <SectionHeading title={mode === 'agent' ? t`AGENT COMMANDS` : t`TERMINAL COMMANDS`} />
            <SettingsCard>
              {agentCommands.map((entry, index) => (
                <Animated.View
                  key={entry.command}
                  entering={riseIn(index * STAGGER.row)}
                  exiting={fadeOut('micro')}
                  layout={listLayout('short')}>
                  <ActionRow
                    accessibilityLabel={entry.command}
                    // The command is the row's name here, and it is set in the
                    // terminal's face because that is exactly what gets typed.
                    // Its description is the prose underneath, which is the
                    // same arrangement every other row on the sheet uses.
                    name={entry.command}
                    nameMono
                    // What the reader still has to type, never what is sent --
                    // so it is drawn as the placeholder it is, beside the name.
                    nameSuffix={entry.argument_hint ?? undefined}
                    detail={entry.description}
                    detailColor={theme.colors.textMuted}
                    busy={sendingId === entry.command}
                    busyColor={theme.colors.primary}
                    disabled={Boolean(sendingId)}
                    onPress={() => void runSlashCommand(entry)}
                    trailing={
                      // A command the developer wrote themselves, found on disk
                      // by the gateway rather than listed in its built-in table.
                      // An annotation, not a badge: the pill it used to sit in
                      // was tinted with the accent, which on this sheet now
                      // means only "in flight".
                      entry.source && entry.source !== 'builtin' ? (
                        <Text variant="label" color={theme.colors.textSubtle}>
                          {entry.source}
                        </Text>
                      ) : null
                    }
                  />
                </Animated.View>
              ))}
            </SettingsCard>
          </Animated.View>
        ) : null}

        {editing ? (
          <Animated.View
            entering={fadeIn('short')}
            exiting={fadeOut('micro')}
            layout={listLayout('short')}
            style={styles.section}>
            <SectionHeading title={t`NEW SHORTCUT`} />
            <Card variant="flat" padding="md" style={styles.addCard}>
              <Text variant="caption" color={theme.colors.textMuted}>
                {mode === 'agent'
                  ? t`Save a prompt you send this agent often.`
                  : t`Save a command or key combo you reach for.`}
              </Text>

              {mode === 'terminal' ? (
                <Tabs
                  options={[
                    { label: t`Command`, value: 'command' },
                    { label: t`Keys`, value: 'keys' },
                  ]}
                  value={kind}
                  variant="pill"
                  size="compact"
                  onChange={(next) => setKind(next as QuickCommandKind)}
                />
              ) : null}

              <View style={styles.addFields}>
                <Input
                  label={t`Name`}
                  value={label}
                  onChangeText={setLabel}
                  placeholder={
                    mode === 'agent'
                      ? t`Review changes`
                      : kind === 'keys'
                        ? t`Interrupt process`
                        : t`List branches`
                  }
                  variant="outline"
                />
                <Input
                  label={mode === 'agent' ? t`Prompt` : kind === 'keys' ? t`Keys` : t`Command`}
                  value={value}
                  onChangeText={setValue}
                  autoCapitalize="none"
                  autoCorrect={false}
                  // The examples for the *value* stay as they are typed: key
                  // names and a git command are the pane's vocabulary, not copy.
                  placeholder={
                    mode === 'agent'
                      ? t`Review the current changes.`
                      : kind === 'keys'
                        ? 'ctrl+c, esc'
                        : 'git branch --show-current'
                  }
                  variant="outline"
                />
              </View>

              <Button onPress={() => void add()} disabled={!label.trim() || !value.trim()}>
                {t`Save shortcut`}
              </Button>
            </Card>
          </Animated.View>
        ) : null}

        {error ? (
          <Animated.View
            entering={fadeIn('micro')}
            exiting={fadeOut('micro')}
            layout={listLayout('short')}>
            <Text selectable variant="caption" color={theme.colors.danger}>
              {error}
            </Text>
          </Animated.View>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

/**
 * A group's instrument label, and whatever control belongs to the group itself.
 *
 * `variant="label"` rather than a caption with `toUpperCase()` applied in
 * JavaScript: case is a language's business, and `toUpperCase()` on 日本語 does
 * nothing while on some scripts it does the wrong thing. `textTransform` is a
 * rendering instruction the platform applies per script.
 */
function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  const theme = useThemeTokens();
  return (
    <View style={styles.heading}>
      <Text variant="label" color={theme.colors.textSubtle} style={styles.headingTitle}>
        {title}
      </Text>
      {action}
    </View>
  );
}

/**
 * Every row on this sheet, in one shape: a name, and under it either prose or
 * something the pane is about to be sent.
 *
 * The three second lines are the whole taxonomy. `detail` is prose and means the
 * row does something other than typing. `value` is the terminal's own face and
 * means those characters are what gets typed. `keys` are drawn as keys, because
 * a key combo is not characters at all -- it leaves through `sendPaneKeys`, and
 * a shell handed "ctrl+c" as text does nothing with it.
 *
 * The name is 14pt in full-strength ink over a 12pt muted second line, which is
 * the inverse of what this sheet used to do: it set every row's identity in the
 * 11pt all-caps instrument style and its content one point larger, so a row's
 * own name was the smallest thing in it.
 */
function ActionRow({
  accessibilityLabel,
  name,
  nameColor,
  nameMono = false,
  nameSuffix,
  detail,
  detailColor,
  value,
  keys,
  busy = false,
  busyColor,
  disabled = false,
  onPress,
  trailing,
}: {
  accessibilityLabel: string;
  name: string;
  nameColor?: string;
  nameMono?: boolean;
  nameSuffix?: string;
  detail?: string;
  detailColor?: string;
  value?: string;
  keys?: string[];
  busy?: boolean;
  busyColor?: string;
  disabled?: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const theme = useThemeTokens();
  const body = (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <View style={styles.nameLine}>
          <Text
            variant="bodySmall"
            color={nameColor}
            numberOfLines={1}
            style={nameMono ? styles.rowNameMono : styles.rowName}>
            {name}
          </Text>
          {nameSuffix ? (
            <Text
              variant="caption"
              color={theme.colors.textSubtle}
              numberOfLines={1}
              style={styles.nameSuffix}>
              {nameSuffix}
            </Text>
          ) : null}
        </View>
        {keys ? <KeyCaps keys={keys} /> : null}
        {value ? (
          <Text
            selectable
            variant="caption"
            color={detailColor}
            numberOfLines={2}
            style={styles.rowValue}>
            {value}
          </Text>
        ) : null}
        {detail ? (
          <Text variant="caption" color={detailColor} numberOfLines={2} style={styles.rowDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {/* The one place the accent survives, and only while it means something:
          this row is the one that was tapped and it has not come back yet. */}
      {busy ? <Spinner size="sm" color={busyColor} /> : trailing}
    </View>
  );

  if (!onPress) {
    // Still labelled: in edit mode the row is not pressable, but the delete
    // button beside it is named after it and a screen reader needs the row it
    // is named after to exist.
    return (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={disabled ? styles.rowDisabled : undefined}>
      {body}
    </PressableScale>
  );
}

/**
 * A key combo, drawn as the keys it is.
 *
 * The face and the fill are the on-screen keyboard's own -- `borderRadius` 8 on
 * a continuous curve over the text colour at the chrome-control alpha -- so a
 * saved combo is recognisably the same object as the key the reader would have
 * pressed on the key row instead. Deriving the fill from `text` rather than
 * naming a colour is what keeps it legible across all thirty-two packs: it is
 * always a tenth of whatever this pack writes with.
 */
function KeyCaps({ keys }: { keys: string[] }) {
  const theme = useThemeTokens();
  const fill = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);
  return (
    <View style={styles.keyCaps}>
      {keys.map((key, index) => (
        <View key={`${key}-${index}`} style={[styles.keyCap, { backgroundColor: fill }]}>
          <Text variant="caption" color={theme.colors.text} style={styles.keyCapText}>
            {key}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    // The stack renders form sheets over a transparent background so the
    // native sheet keeps its own corners; without filling the height, that
    // transparency shows as a grey strip under the content.
    flex: 1,
  },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap,
    gap: LADDER.snug,
  },
  // One measured column rather than two. A grouped list read across two columns
  // is a table, and the hairline that makes it readable as a list is exactly
  // what makes it read as one -- so a pad window spends its width on a
  // comfortable measure instead of a second column of the same rows.
  padContent: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: LADDER.section,
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
    gap: LADDER.snug,
    paddingBottom: LADDER.tight,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  headerTitle: { includeFontPadding: false },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: appChrome.radius.roundControl,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: LADDER.gap },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
  },
  headingTitle: { paddingHorizontal: LADDER.tight, letterSpacing: 0.8 },
  headingSkeleton: { marginHorizontal: LADDER.tight },
  // Reaches past the label's own line so the tap target clears 44pt without the
  // heading itself growing a band of empty space above the card.
  headingAction: {
    minHeight: 32,
    paddingHorizontal: LADDER.gap,
    justifyContent: 'center',
  },
  // The surface Stop sits on. `SettingsCard` draws its own, and this one has to
  // be tinted, so it repeats that card's geometry rather than taking it.
  group: {
    borderRadius: appChrome.radius.popover,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  // 56 rather than the 60 Settings gives a row: this sheet can hold forty of
  // them behind one tap, and four points a row is most of a row back over a
  // screenful. Still well clear of the 44pt minimum -- a mistap here sends
  // something to a live pane.
  row: {
    minHeight: 56,
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.gap,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowDisabled: { opacity: appChrome.opacity.disabled },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  rowName: { flexShrink: 1, lineHeight: 20, includeFontPadding: false },
  rowNameMono: { flexShrink: 1, lineHeight: 20, includeFontPadding: false, ...MONO_TEXT },
  nameSuffix: { flexShrink: 1, lineHeight: 17, includeFontPadding: false, ...MONO_TEXT },
  rowDetail: { lineHeight: 17, includeFontPadding: false },
  rowValue: { lineHeight: 17, includeFontPadding: false, ...MONO_TEXT },
  skeletonDetail: { marginTop: 3 },
  deleteButton: {
    width: 38,
    height: 38,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyCaps: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  keyCap: {
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyCapText: { includeFontPadding: false, textTransform: 'none' },
  addCard: { gap: LADDER.snug },
  addFields: { gap: LADDER.snug },
});
