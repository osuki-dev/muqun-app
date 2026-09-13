import { useLingui } from '@lingui/react/macro';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, AppState, Keyboard } from 'react-native';
import { DeliveryOwnership, DeliverySelection, assertDeliveryCurrent } from '@/lib/bound-delivery';
import { useAgentReferences } from '@/hooks/use-agent-references';
import { agentCommandTextWithReferences } from '@/lib/agent-command-references';
import {
  canAssignToAgent,
  collaborationAvailability,
  collaborationAgents,
  collaborationSpawnOutcome,
  supportsCollaboration,
  tasksForSession,
  taskAgent,
  partitionCollaborationTasks,
  type CollaborationTask,
  type CollaborationContext,
} from '@/lib/agent-collaboration';
import {
  loadAgents,
  loadPanes,
  loadHealth,
  loadSessions,
  loadAgentProfiles,
  readPaneOutput,
  spawnBoundAgent,
  type AgentProfile,
  type HerdrEntity,
} from '@/lib/gateway-client';
import { field } from '@/lib/herdr-entity';
import { describeGatewayFailure } from '@/lib/network-error';
import { useAgentCollaboration } from '@/stores/agent-collaboration';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { usePanelPickerStore } from '@/stores/panel-picker';
import { useCollaborationOutput } from '@/hooks/use-collaboration-output';
import { collaborationDraftScope, collaborationTaskText } from '@/lib/quick-command-collaboration';
export function useAgentCollaborationController(routeParams: CollaborationContext) {
  const { t } = useLingui();
  const router = useRouter();
  const scope = collaborationDraftScope(routeParams);
  const [initialDraft] = useState(() => useAgentCollaboration.getState().drafts[scope]);
  const [draftOwner] = useState(() => Symbol('collaboration-editor'));
  useLayoutEffect(() => {
    useAgentCollaboration.getState().claimDraft(scope, draftOwner);
  }, [scope, draftOwner]);
  const [ownership] = useState(() => new DeliveryOwnership());
  useFocusEffect(useCallback(() => () => ownership.invalidate(), [ownership]));
  useEffect(
    () =>
      useGatewayConnectionStore.subscribe((next, previous) => {
        if (next.record !== previous.record) ownership.invalidate();
      }),
    [ownership]
  );
  // Going to an assistant's terminal must not lose the unsent instructions
  // or silently change which terminal/project the assignment came from.
  const params = initialDraft?.context ?? routeParams;
  const command = initialDraft?.command;
  const instructions = command?.instructions;
  const { serverId, sessionId, paneId } = params;
  useLayoutEffect(
    () => () => ownership.invalidate(),
    [
      ownership,
      serverId,
      sessionId,
      paneId,
      params.workspaceId,
      params.tabId,
      params.cwd,
      params.commandId,
    ]
  );
  const capture = useCallback(() => {
    const record = useGatewayConnectionStore.getState().record;
    return ownership.capture(
      () =>
        Boolean(record) &&
        record?.serverId === serverId &&
        useGatewayConnectionStore.getState().record === record &&
        useAgentCollaboration.getState().draftOwners[scope] === draftOwner
    );
  }, [ownership, serverId, scope, draftOwner]);
  const references = useAgentReferences(
    {
      serverId,
      sessionId,
      sourcePaneId: paneId,
      commandId: params.commandId,
      connectionGeneration: 0,
    },
    initialDraft?.references,
    capture
  );
  const allTasks = useAgentCollaboration((state) => state.tasks);
  const tasks = tasksForSession(allTasks, serverId, sessionId);
  const connectedServerId = useGatewayConnectionStore((state) => state.record?.serverId);
  const connectionMatches = connectedServerId === serverId;
  const [agents, setAgents] = useState<HerdrEntity[]>([]);
  const [panes, setPanes] = useState<HerdrEntity[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [supported, setSupported] = useState(false);
  const [requirement, setRequirement] = useState<string | null>(null);
  const [canSpawn, setCanSpawn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState(Boolean(initialDraft) || Boolean(command));
  const [target, setTarget] = useOwnedSelection(initialDraft?.target ?? '', ownership);
  const [newAgent, setNewAgent] = useOwnedSelection(initialDraft?.newAgent ?? false, ownership);
  const [kind, setKind] = useOwnedSelection(initialDraft?.kind ?? '', ownership);
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? '');
  const [context, setContext] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const initializedPicker = useRef(Boolean(initialDraft));
  const [detail, setDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryPane, setRecoveryPane] = useState<string | null>(
    initialDraft?.recoveryPane ?? null
  );
  const candidates = collaborationAgents(agents, panes, paneId, params.workspaceId);
  const selected = candidates.find((agent) => agent.paneId === target);
  const detailTask = partitionCollaborationTasks(tasks, agents).current.find(
    (task) => task.id === detail
  );
  const outputState = useCollaborationOutput(detailTask, connectionMatches);
  const { workspaceId, tabId, cwd } = params;
  useEffect(() => {
    useAgentCollaboration.getState().saveOwnedDraft(
      scope,
      draftOwner,
      prompt.trim() || references.draft.images.length || (command && form)
        ? {
            owner: draftOwner,
            context: {
              serverId,
              sessionId,
              paneId,
              workspaceId,
              tabId,
              cwd,
              commandId: params.commandId,
            },
            command,
            prompt,
            target,
            newAgent,
            kind,
            recoveryPane,
            references: references.draft,
          }
        : null
    );
  }, [
    scope,
    serverId,
    sessionId,
    paneId,
    workspaceId,
    tabId,
    cwd,
    prompt,
    target,
    newAgent,
    kind,
    recoveryPane,
    command,
    params.commandId,
    form,
    references.draft,
    draftOwner,
  ]);

  // The existing transport is scoped to the selected paired server. Never
  // reselect a server underneath another screen or dispatch using stale params.
  const assertConnection = useCallback(() => {
    if (useGatewayConnectionStore.getState().record?.serverId !== serverId) {
      throw new Error(t`Return to this server to continue.`);
    }
  }, [serverId, t]);

  useEffect(() => {
    if (!connectionMatches) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    let metadataExpiresAt = 0;
    async function poll() {
      if (running || cancelled || AppState.currentState !== 'active') return;
      const isCurrent = capture();
      if (!isCurrent()) return;
      running = true;
      try {
        // Metadata is stable. Status alone needs the three-second cadence.
        const [metadata, nextAgents] = await Promise.all([
          Date.now() >= metadataExpiresAt
            ? Promise.all([loadHealth(), loadSessions(), loadPanes(sessionId)])
            : Promise.resolve(null),
          loadAgents(sessionId),
        ]);
        if (cancelled || !isCurrent() || AppState.currentState !== 'active') return;
        if (metadata) {
          const [health, sessions, nextPanes] = metadata;
          metadataExpiresAt = Date.now() + 30_000;
          const session = sessions.sessions?.find((item) => item.id === sessionId);
          const availability = collaborationAvailability(
            health,
            sessionId,
            session?.backend ?? (session ? 'herdr' : '')
          );
          const enabled = availability === 'ready';
          setRequirement(
            availability === 'gateway'
              ? t`Update Muqun Gateway to use Agent collaboration. Your terminals still work as usual.`
              : availability === 'herdr'
                ? t`Update this session to Herdr 0.9.0 or newer to use Agent collaboration.`
                : availability === 'unavailable'
                  ? t`Could not verify this session's Herdr version. Reconnect or update Muqun Gateway.`
                  : availability === 'backend'
                    ? t`Agent collaboration is available in Herdr sessions.`
                    : null
          );
          setSupported(enabled);
          setCanSpawn(enabled && Boolean(health.capabilities?.includes('agent_spawn')));
          if (enabled && !initializedPicker.current) {
            initializedPicker.current = true;
            setNewAgent(
              Boolean(health.capabilities?.includes('agent_spawn')) &&
                !nextAgents.some((agent) => (field(agent, 'pane_id') || agent.id) !== paneId)
            );
          }
          setPanes(nextPanes);
        }
        setAgents(nextAgents);
        setCheckedAt(Date.now());
        setError(null);
      } catch (failure) {
        metadataExpiresAt = 0;
        if (!cancelled && isCurrent()) {
          setCheckedAt(null);
          setError(describeGatewayFailure(failure, t`Could not refresh agent status.`).message);
        }
      } finally {
        running = false;
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    }
    void poll();
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'active') {
        metadataExpiresAt = 0;
        void poll();
      } else setCheckedAt(null);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [connectionMatches, sessionId, paneId, refresh, t, capture, setNewAgent]);

  useEffect(() => {
    if (!newAgent || !canSpawn || !connectionMatches) return;
    let cancelled = false;
    const isCurrent = capture();
    void loadAgentProfiles()
      .then((items) => {
        if (cancelled || !isCurrent()) return;
        setProfiles(items);
        setKind((current) => current || items.find((item) => item.available)?.kind || '');
      })
      .catch((failure: unknown) => {
        if (!cancelled && isCurrent())
          setNotice(
            describeGatewayFailure(failure, t`Could not list this server's agents.`).message
          );
      });
    return () => {
      cancelled = true;
    };
  }, [newAgent, canSpawn, connectionMatches, t, capture, setKind]);

  async function shareContext(enabled: boolean) {
    const isCurrent = capture();
    setIncludeContext(enabled);
    if (!enabled) return;
    setContextLoading(true);
    try {
      assertConnection();
      const text = await readPaneOutput(sessionId, paneId, 'text', 40, 'visible');
      assertDeliveryCurrent(isCurrent);
      setContext(text.slice(-6000));
    } catch (failure) {
      if (!isCurrent()) return;
      setIncludeContext(false);
      setNotice(describeGatewayFailure(failure, t`Could not read the terminal.`).message);
    } finally {
      setContextLoading(false);
    }
  }

  function openPane(id: string) {
    usePanelPickerStore.getState().choosePanel({ serverId, paneId: id });
    router.back();
  }

  async function openTask(task: CollaborationTask) {
    try {
      assertConnection();
      const current = await loadAgents(sessionId);
      assertConnection();
      if (!taskAgent(task, current)) throw new Error(t`Agent no longer present`);
      openPane(task.paneId);
    } catch (failure) {
      setNotice(describeGatewayFailure(failure, t`Agent no longer present`).message);
    }
  }

  async function assign() {
    if (submitting.current || (!prompt.trim() && !instructions)) return;
    submitting.current = true;
    setBusy(true);
    setNotice(null);
    setRecoveryPane(null);
    let dispatchAttempted = false;
    const destinationCurrent = capture();
    const referenceDraft = references.snapshot();
    const referencesCurrent = references.captureRevision();
    const isCurrent = () => destinationCurrent() && referencesCurrent();
    const sourceRecord = useGatewayConnectionStore.getState().record;
    const record = sourceRecord
      ? {
          ...sourceRecord,
          ...(sourceRecord.sshTunnel ? { sshTunnel: { ...sourceRecord.sshTunnel } } : {}),
        }
      : null;
    try {
      assertConnection();
      assertDeliveryCurrent(isCurrent);
      if (!record) throw new Error(t`Return to this server to continue.`);
      if (referenceDraft.images.length) {
        if (!newAgent)
          throw new Error(t`Reference images can be sent when starting a new assistant`);
        const gatewayName = record.label || record.serverId;
        const approved = await new Promise<boolean>((resolve) =>
          Alert.alert(
            t`Send reference images?`,
            t`Images will be uploaded to ${gatewayName} and shared with the new assistant. Its AI provider may process them. They are not automatically copied to other machines.`,
            [
              { text: t`Cancel`, style: 'cancel', onPress: () => resolve(false) },
              { text: t`Upload and send`, onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) }
          )
        );
        if (!approved) return;
        assertDeliveryCurrent(isCurrent);
      }
      const [health, sessions, current] = await Promise.all([
        loadHealth(),
        loadSessions(),
        loadAgents(sessionId),
      ]);
      assertConnection();
      assertDeliveryCurrent(isCurrent);
      const session = sessions.sessions?.find((item) => item.id === sessionId);
      if (!session || !supportsCollaboration(session.backend ?? 'herdr'))
        throw new Error(t`Agent collaboration is available in Herdr sessions.`);
      if (collaborationAvailability(health, sessionId, session.backend ?? 'herdr') !== 'ready') {
        throw new Error(t`Refresh to check Gateway and Herdr compatibility before assigning.`);
      }
      let text = collaborationTaskText(prompt, includeContext ? context : '', instructions);
      let destination = target;
      let name = selected?.name ?? target;
      let agentInstanceId: string | undefined;
      if (newAgent) {
        if (!kind || !health.capabilities?.includes('agent_spawn'))
          throw new Error(t`This server cannot start an assistant yet.`);
        if (referenceDraft.images.length) {
          if (!health.capabilities?.includes('file_uploads'))
            throw new Error(t`Update this Gateway to upload reference images`);
          const prepared = await references.prepare(record, isCurrent);
          assertDeliveryCurrent(isCurrent);
          text = agentCommandTextWithReferences(
            prompt,
            includeContext ? context : '',
            instructions,
            prepared,
            prepared.scope
          );
        }
        assertDeliveryCurrent(isCurrent);
        dispatchAttempted = true;
        const created = await spawnBoundAgent(
          record,
          sessionId,
          {
            agent: kind,
            cwd: params.cwd,
            tab_id: params.tabId,
            prompt: text,
          },
          isCurrent
        );
        const outcome = collaborationSpawnOutcome(created);
        if (outcome !== 'sent') {
          // Preserve recovery even when navigation changed after transmission;
          // never automatically create another assistant to replace this one.
          const saved = useAgentCollaboration.getState().drafts[scope];
          if (saved?.owner === draftOwner)
            useAgentCollaboration.getState().saveOwnedDraft(scope, draftOwner, {
              ...saved,
              recoveryPane: created.paneId,
              newAgent: false,
              target: created.paneId,
            });
          if (!isCurrent()) return;
          setRecoveryPane(created.paneId);
          setNewAgent(false);
          setTarget(created.paneId);
          setNotice(
            outcome === 'attention'
              ? t`The assistant needs your approval or input in its terminal. Your task has not been sent. Your instructions are still here.`
              : outcome === 'start-failed'
                ? t`The assistant could not start. Check its terminal before continuing. Your task has not been sent.`
                : outcome === 'start-unconfirmed'
                  ? t`The terminal was created, but the assistant is not confirmed ready. It may still be starting. Check its terminal before trying again. Your instructions are still here.`
                  : t`The assistant was created, but task delivery was not confirmed. Check its terminal before sending again. Your instructions are still here.`
          );
          setRefresh((value) => value + 1);
          return;
        }
        destination = created.paneId;
        name = kind;
        agentInstanceId = created.agentInstanceId;
      } else {
        const live = current.find((agent) => (field(agent, 'pane_id') || agent.id) === target);
        if (!live || target === paneId || !canAssignToAgent(live.status ?? 'unknown')) {
          throw new Error(t`This assistant is no longer ready. Refresh or choose another.`);
        }
        if (!selected?.instanceId || field(live, 'instance_id') !== selected.instanceId) {
          throw new Error(t`This assistant is no longer ready. Refresh or choose another.`);
        }
        // TODO: Send only through a backend-enforced instance-bound contract.
        // A fresh lookup cannot prevent this mutable target being reassigned
        // between verification and delivery. Keep the draft instead of guessing.
        throw new Error(
          t`Update Muqun Gateway to use Agent collaboration. Your terminals still work as usual.`
        );
      }
      const task: CollaborationTask = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        serverId,
        sessionId,
        sourcePaneId: paneId,
        paneId: destination,
        agentName: name,
        ...(agentInstanceId ? { agentInstanceId } : {}),
        prompt: command
          ? `${command.name}${prompt.trim() ? `: ${prompt.trim()}` : ''}`
          : prompt.trim(),
        createdAt: Date.now(),
      };
      useAgentCollaboration.getState().add(task);
      if (!isCurrent()) {
        const saved = useAgentCollaboration.getState().drafts[scope];
        if (saved?.owner === draftOwner) {
          useAgentCollaboration.getState().saveOwnedDraft(scope, draftOwner, {
            ...saved,
            recoveryPane: destination,
            newAgent: false,
            target: destination,
          });
        }
        return;
      }
      useAgentCollaboration.getState().saveOwnedDraft(scope, draftOwner, null);
      references.clear();
      Keyboard.dismiss();
      setForm(false);
      setPrompt('');
      setIncludeContext(false);
      setContext('');
      setNotice(t`Task sent. You can keep working in your current terminal.`);
      setRefresh((value) => value + 1);
      usePanelPickerStore.getState().choosePanel({ serverId, paneId });
      router.back();
    } catch (failure) {
      if (!isCurrent()) return;
      setNotice(
        describeGatewayFailure(failure, t`Could not send the task.`).message +
          (dispatchAttempted
            ? ` ${t`Check the assistant before sending again; it may have received the request.`}`
            : '')
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function statusLabel(status: string | undefined) {
    if (!checkedAt || !connectionMatches) return t`Status unavailable`;
    switch (status) {
      case 'working':
        return t`Working`;
      case 'blocked':
        return t`Needs your attention`;
      case 'idle':
      case 'done':
        return t`Ready for input`;
      case undefined:
        return t`Agent no longer present`;
      default:
        return t`Status unknown`;
    }
  }

  return {
    command,
    references,
    originCwd: params.cwd,
    tasks,
    connectionMatches,
    loading,
    error,
    setRefresh,
    requirement,
    notice,
    recoveryPane,
    setNotice,
    form,
    setForm,
    busy,
    supported,
    checkedAt,
    agents,
    statusLabel,
    detail,
    openPane,
    openTask,
    setDetail,
    ...outputState,
    newAgent,
    canSpawn,
    setNewAgent,
    profiles,
    kind,
    setKind,
    candidates,
    target,
    setTarget,
    selected,
    prompt,
    setPrompt,
    contextLoading,
    includeContext,
    shareContext,
    context,
    assign,
  };
}

/** Native events queued before the busy render must still invalidate old targets. */
function useOwnedSelection<T>(initial: T, ownership: DeliveryOwnership) {
  const [value, publish] = useState(initial);
  const [selection] = useState(() => new DeliverySelection(initial, Object.is, ownership));
  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      publish(selection.update(next));
    },
    [selection]
  );
  return [value, update] as const;
}
