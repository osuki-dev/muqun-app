import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AgentComposer } from '@/components/agent-composer';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import type { HomeLaunchController } from '@/components/home-launch-actions';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useAgentFeatures, useAgentsDiscoveryRefresh } from '@/hooks/use-agent-features';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { reachabilityDescription } from '@/i18n/labels';
import type { AgentClientCommandId } from '@/lib/agent-commands';
import { loadRememberedAgentDefaults } from '@/lib/agent-model-memory';
import { classifyAgentRequestError } from '@/lib/agent-request-error';
import {
  createAgentSession,
  formatModelName,
  getAgentCatalog,
  invokeAgentSkill,
  normalizeAgentId,
  sendAgentCommand,
  sendAgentPrompt,
  switchAgentMode,
  switchAgentModel,
  type AgentCatalog,
  type ModelRef,
} from '@/lib/agent-session';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';
import { checkAgentServer } from '@/lib/home-agent-readiness';
import {
  HOME_AGENT_SESSION_ID,
  homeComposerAgent,
  homeGuideParams,
  homeHiddenClientCommands,
  homeSessionParams,
  homeSessionReuse,
  resolveHomeComposerTarget,
  type HomeStartedSession,
} from '@/lib/home-composer';
import type { HomeCommandResult } from '@/lib/home-commands';
import { markPromptedSession } from '@/lib/prompted-agent-sessions';
import { buildLaunchModel } from '@/lib/home-launch-model';
import type { ServerReachability } from '@/lib/server-reachability';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeComposerSheet } from '@/stores/home-composer-sheet';

const FLASH_IN_MS = 120;
const FLASH_OUT_MS = 600;

const NO_COMMANDS: AgentCatalog['commands'] = [];
const NO_SKILLS: AgentCatalog['skills'] = [];

/**
 * Home's dock: the session screen's own composer, before there is a session.
 *
 * `AgentComposer` is hosted whole -- text, attachments, voice, `@` files, `/`
 * commands, the mode and model pills -- in the pre-session state the agent
 * screen shows for a new session: no `activeAsid`, the target computer's
 * catalog behind the pills. The assignment bar rides on top of it and says
 * where Send goes; tapping it opens the target picker.
 *
 * The target computer is the selected gateway record (one connection at a
 * time), so the catalog, the attachment uploads and the file mentions all go
 * to the computer the bar names. Send does what the workbench does for a new
 * session -- `createAgentSession`, then the prompt -- and only then opens that
 * session as an existing one. A failure keeps the draft and the staged files
 * in the dock and says why under the bar; nothing is retried by itself.
 */
export function HomeComposerDock({
  controller,
  reachabilityByServer,
  targetPulse = 0,
  bottomInset = 0,
  topInset = 0,
  onDockHeight,
  onOpenAgent,
}: {
  controller: HomeLaunchController;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  /**
   * Bumped when Home sets the target from outside the dock (a tap on a
   * computer row); each bump flashes the assignment bar.
   */
  targetPulse?: number;
  bottomInset?: number;
  topInset?: number;
  onDockHeight?: (height: number) => void;
  onOpenAgent: (
    serverId: string,
    asid?: string,
    directory?: string,
    sessionId?: string,
    agentId?: string
  ) => Promise<HomeCommandResult>;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const router = useRouter();
  const { showToast } = useToast();
  const { servers, chosen, openTargetPicker } = controller;
  const { record, selectRecord, selectRecordNow } = useGatewayRecord();
  const [error, setError] = useState<string | null>(null);

  // The assignment bar lights up for a moment whenever the target is set by
  // hand, so the change is seen, not inferred.
  const flash = useSharedValue(0);
  useEffect(() => {
    if (targetPulse === 0) return;
    flash.set(
      withSequence(
        withTiming(1, { duration: FLASH_IN_MS }),
        withTiming(0, { duration: FLASH_OUT_MS })
      )
    );
  }, [targetPulse, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));

  const target = resolveHomeComposerTarget({ servers, chosen, reachabilityByServer });
  const targetServer = target.kind === 'none' ? undefined : target.server;
  const targetId = targetServer?.serverId;
  const ready = target.kind === 'ready';
  const selected = Boolean(targetId) && record?.serverId === targetId;

  // One connection at a time: the computer Send goes to is the one selected,
  // so its catalog, uploads and file list are what the dock shows.
  useEffect(() => {
    if (!ready || !targetId || record?.serverId === targetId) return;
    if (!selectRecordNow(targetId)) void selectRecord(targetId);
  }, [ready, targetId, record?.serverId, selectRecord, selectRecordNow]);
  useAgentsDiscoveryRefresh(targetId, ready && selected);

  const discovery = useAgents((state) => (targetId ? state.index.servers[targetId] : undefined));
  const lastUsedAgentId = useAgents((state) =>
    targetId ? state.index.lastUsed[targetId] : undefined
  );
  const markAgentUsed = useAgents((state) => state.markUsed);
  const agent = homeComposerAgent(buildLaunchModel({ discovery, lastUsedAgentId }).entries);
  const agentsDiscovered = Boolean(discovery?.agents);
  const agentId = agentsDiscovered ? normalizeAgentId(agent?.agentId) : undefined;
  const features = useAgentFeatures(targetId, agentId);
  const computerLabel = targetServer?.label ?? '';
  const agentName = agent?.name ?? '';
  const agentLabel = agentName || computerLabel;

  // The catalog behind the pills, read for the computer and agent on the bar.
  // Kept with the key it was read for, so another target never shows it.
  const catalogKey = `${targetId ?? ''}\u0000${agentId ?? ''}`;
  const [catalogRead, setCatalogRead] = useState<{ key: string; catalog: AgentCatalog } | null>(
    null
  );
  useEffect(() => {
    if (!ready || !selected) return;
    let current = true;
    getAgentCatalog(HOME_AGENT_SESSION_ID, undefined, agentId ? { agentId } : undefined)
      .then((catalog) => {
        if (current) setCatalogRead({ key: catalogKey, catalog });
      })
      .catch((failure: unknown) => {
        console.warn('Failed to load the agent catalog for Home:', failure);
      });
    return () => {
      current = false;
    };
  }, [ready, selected, agentId, catalogKey]);
  const catalog = catalogRead?.key === catalogKey ? catalogRead.catalog : undefined;
  const models = catalog?.models ?? [];
  const modes = catalog?.modes ?? [];

  // What the reader picked in the dock, for this computer and agent only.
  const [picked, setPicked] = useState<{ key: string; mode?: string; model?: ModelRef }>({
    key: '',
  });
  const picks = picked.key === catalogKey ? picked : { key: catalogKey };
  const sessionParams = homeSessionParams({
    picked: {
      ...(picks.mode ? { mode: picks.mode } : {}),
      ...(picks.model ? { model: picks.model } : {}),
    },
    // Keyed as the workbench keys it, so both read the same memory.
    remembered: loadRememberedAgentDefaults(HOME_AGENT_SESSION_ID, undefined, agentId),
    catalogDefaults: catalog?.defaults ?? {},
    models,
    modes,
    ...(agentId ? { agentId } : {}),
    agentsDiscovered,
  });
  const selectedModel = sessionParams.model;
  const modelInfo = selectedModel
    ? models.find(
        (model) =>
          model.id === selectedModel.model_id &&
          (!selectedModel.provider_id || model.provider_id === selectedModel.provider_id)
      )
    : undefined;
  const modelName = formatModelName(selectedModel, '', modelInfo?.name);
  const canPickMode = features.modes && modes.length > 0;

  const selectModel = useStableHandler((model: ModelRef) => {
    setPicked((current) => ({
      ...(current.key === catalogKey ? current : {}),
      key: catalogKey,
      model,
    }));
  });
  useEffect(() => () => useHomeComposerSheet.getState().release(selectModel), [selectModel]);
  function openModelSheet() {
    useHomeComposerSheet.getState().open(selectedModel, selectModel);
    router.push({
      pathname: '/agent-model',
      params: {
        sessionId: HOME_AGENT_SESSION_ID,
        ...(agentId ? { agentId } : {}),
        owner: 'home',
      },
    });
  }
  // A mode that names its own model brings it, as it does on a session: the
  // model pick is dropped and the ladder starts from the mode again.
  function selectMode(mode: string) {
    setPicked({ key: catalogKey, mode });
  }

  /** The workbench's own sentences for a failed request, in this agent's name. */
  function describeFailure(failure: unknown): string {
    // No agent tile to name: the computer stands in, never an empty name.
    const agentName = agentLabel;
    const reading = classifyAgentRequestError(failure);
    switch (reading.kind) {
      case 'offline':
        return t`${agentName} is offline`;
      case 'refused': {
        const message = reading.message;
        return t`${agentName} refused the request: ${message}`;
      }
      case 'unsupported':
        return t`${agentName} does not support that action.`;
      case 'unknown-agent':
        return t`This computer does not know ${agentName}. Refresh the agent list and try again.`;
      case 'other':
        return reading.message;
    }
  }

  /**
   * A session made for a send whose act did not land. The next Send on the
   * same computer and agent goes to it (see `homeSessionReuse`) rather than
   * leaving an empty session behind each attempt.
   */
  const startedRef = useRef<HomeStartedSession | null>(null);
  /** Two taps in one frame are one send: React state cannot lock that. */
  const inFlightRef = useRef(false);
  /** The composer's own draft, for a command that failed after it was cleared. */
  const injectDraftRef = useRef<((text: string) => void) | null>(null);

  /** The computer Send goes to, selected; or `null` with the reason shown. */
  async function sendTarget(): Promise<string | null> {
    if (target.kind === 'offline') {
      openTargetPicker();
      return null;
    }
    if (target.kind !== 'ready') return null;
    const serverId = target.server.serverId;
    if (useGatewayConnectionStore.getState().record?.serverId === serverId) return serverId;
    const reached = selectRecordNow(serverId) || (await selectRecord(serverId));
    if (!reached) {
      setError(t`Computer unavailable.`);
      return null;
    }
    return serverId;
  }

  /**
   * Create the session (or reuse the one a failed send left), act on it, open
   * it. A create that fails on an agent that is not ready opens its setup
   * guide, as a launch tile does; every other failure is said under the bar.
   */
  async function startSession(act: (asid: string) => Promise<void>): Promise<boolean> {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    return settleAfter(
      async () => {
        setError(null);
        const serverId = await sendTarget();
        if (!serverId) return false;
        const params = sessionParams;
        const key = `${serverId}\u0000${params.agentId ?? ''}`;
        // The selection moved while this was in flight: the session and its
        // prompt would go to a computer the bar no longer names.
        const owns = () => useGatewayConnectionStore.getState().record?.serverId === serverId;
        let creating = false;
        return recoverWith(
          async () => {
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            const plan = homeSessionReuse(startedRef.current, key, params);
            let started: HomeStartedSession;
            if (plan.kind === 'reuse') {
              const { asid } = plan.started;
              if (plan.switchMode) await switchAgentMode(asid, plan.switchMode);
              if (plan.switchModel)
                await switchAgentModel(HOME_AGENT_SESSION_ID, asid, plan.switchModel);
              started = { ...plan.started, params };
            } else {
              creating = true;
              const created = await createAgentSession(HOME_AGENT_SESSION_ID, params);
              creating = false;
              markAgentUsed(serverId, created.agent_id);
              started = {
                key,
                asid: created.asid,
                ...(created.directory ? { directory: created.directory } : {}),
                sessionAgentId: created.agent_id,
                params,
              };
            }
            startedRef.current = started;
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            await act(started.asid);
            startedRef.current = null;
            // Its first snapshot may predate the prompt: no welcome card for it.
            markPromptedSession(serverId, started.asid);
            void onOpenAgent(
              serverId,
              started.asid,
              started.directory,
              HOME_AGENT_SESSION_ID,
              started.sessionAgentId
            );
            return true;
          },
          async (failure) => {
            console.warn('Home could not start a session:', failure);
            if (creating) {
              const record = useGatewayConnectionStore
                .getState()
                .records.find((item) => item.serverId === serverId);
              const readiness = await checkAgentServer(record, params.agentId);
              const guide = homeGuideParams(readiness, {
                serverId,
                ...(record?.label ? { label: record.label } : {}),
              });
              if (guide) {
                router.push({ pathname: '/agent-guide', params: guide });
                return false;
              }
            }
            setError(describeFailure(failure));
            return false;
          }
        );
      },
      () => {
        inFlightRef.current = false;
      }
    );
  }

  function sendPrompt(text: string, attachments?: string[]) {
    return startSession((asid) =>
      sendAgentPrompt(HOME_AGENT_SESSION_ID, asid, {
        text,
        ...(attachments ? { attachments } : {}),
      })
    );
  }
  // The composer empties the field as it hands a command over, so a command
  // that did not run puts its line back.
  function runCommand(name: string, args: string) {
    void startSession((asid) =>
      sendAgentCommand(asid, { name, ...(args ? { arguments: args } : {}) })
    ).then((accepted) => {
      if (!accepted)
        injectDraftRef.current?.(`/${name.replace(/^\//, '')}${args ? ` ${args}` : ''}`);
    });
  }
  async function invokeSkill(skill: string, args: string) {
    const accepted = await startSession((asid) =>
      invokeAgentSkill(HOME_AGENT_SESSION_ID, asid, { skill })
    );
    // A skill takes no arguments on the wire; what was typed after it is said
    // out loud rather than dropped in silence.
    if (accepted && args)
      showToast({
        variant: 'info',
        title: t`Skill started`,
        message: t`“${args}” was not sent: a skill takes no arguments.`,
      });
    return accepted;
  }
  function clientCommand(name: AgentClientCommandId) {
    if (name === 'models') openModelSheet();
  }

  if (servers.length === 0) return null;

  const bar = (
    <View style={styles.accessory}>
      {error ? (
        <Text
          testID="home-composer-error"
          variant="caption"
          color={theme.colors.danger}
          accessibilityLiveRegion="polite"
          style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PressableScale
        testID="home-composer-target"
        accessibilityRole="button"
        accessibilityLabel={
          targetServer
            ? agentName
              ? t`Assigned to ${computerLabel}, ${agentName}`
              : t`Send to ${computerLabel}`
            : t`No computer online`
        }
        accessibilityHint={t`Choose another computer`}
        hitSlop={{ top: 6, bottom: 6 }}
        onPress={openTargetPicker}
        style={[styles.bar, { borderRadius: profile.chrome.navigationPill }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: profile.chrome.navigationPill,
              backgroundColor: background(theme.colors.primarySubtle),
            },
            flashStyle,
          ]}
        />
        {targetServer ? (
          <>
            <ThemeIcon
              name="home.arrow"
              direction="right"
              fallback={ArrowRight}
              size={14}
              color={ready ? theme.colors.primary : theme.colors.textMuted}
            />
            <Text
              variant="bodySmall"
              weight="semibold"
              numberOfLines={1}
              color={ready ? theme.colors.text : theme.colors.textMuted}
              style={styles.barLabel}>
              {agentName ? `${computerLabel} · ${agentName}` : computerLabel}
            </Text>
            {target.kind === 'offline' ? (
              <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                {_(reachabilityDescription.offline)}
              </Text>
            ) : null}
          </>
        ) : (
          <Text variant="bodySmall" color={theme.colors.textMuted} numberOfLines={1}>
            {t`No computer online`}
          </Text>
        )}
      </PressableScale>
    </View>
  );

  return (
    <AgentComposer
      accessory={bar}
      inputTestID="home-composer-input"
      sendTestID="home-composer-send"
      running={false}
      disabled={target.kind === 'none'}
      agentName={agentLabel}
      sessionId={HOME_AGENT_SESSION_ID}
      availableAgents={modes}
      skills={features.skills ? (catalog?.skills ?? NO_SKILLS) : NO_SKILLS}
      commands={features.slashCommands ? (catalog?.commands ?? NO_COMMANDS) : NO_COMMANDS}
      hiddenClientCommands={homeHiddenClientCommands(features)}
      selectedAgent={sessionParams.mode}
      selectedModel={selectedModel}
      modelName={modelName}
      canPickMode={canPickMode}
      canAttach={features.attachments}
      bottomInset={bottomInset}
      topInset={topInset}
      onDockHeight={onDockHeight}
      onSend={sendPrompt}
      onAbort={async () => {}}
      onSelectAgentMode={selectMode}
      onOpenModelSheet={features.modelSelection ? openModelSheet : undefined}
      onOpenDiffSheet={() => {}}
      onRunCommand={runCommand}
      onInvokeSkill={invokeSkill}
      onClientCommand={clientCommand}
      injectDraftRef={injectDraftRef}
    />
  );
}

const styles = StyleSheet.create({
  // The dock's first row: its glass and gutter are the composer's own.
  accessory: { paddingBottom: 6, gap: 6, alignItems: 'flex-start' },
  bar: {
    minHeight: 32,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  barLabel: { minWidth: 0, flexShrink: 1 },
  error: { paddingHorizontal: 4 },
});
