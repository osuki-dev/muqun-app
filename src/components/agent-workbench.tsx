import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  FolderGit2,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  Zap,
} from 'lucide-react-native';
import {
  LegendList,
  type LegendListRenderItemProps,
  type LegendListRef,
} from '@legendapp/list/react-native';
import { PressableScale } from '@/components/pressable-scale';
import { GlassChrome } from '@/components/glass-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import Animated from 'react-native-reanimated';
import { withAlpha } from '@/lib/color';
import { fadeIn, fadeOut, listLayout } from '@/lib/motion';
import { TerminalNotice, terminalNoticeStyles } from '@/components/terminal-notice';
import { StatusDot } from '@/components/status-dot';
import {
  getAgentSessionSnapshot,
  listAgentSessions,
  createAgentSession,
  sendAgentPrompt,
  abortAgentSession,
  switchAgentModel,
  replyAgentPermission,
  replyAgentForm,
  getAgentVcsDiff,
  getAgentCatalog,
  getAgentProjects,
  openAgentSessionStream,
  sortTimeline,
  isBusyStatus,
  type AgentDomainEvent,
  type AgentSessionInfo,
  type CompactionReason,
  type InboxItem,
  type TimelineItem,
  type PermissionRequest,
  type FormRequest,
  type ModelRef,
  type PermissionDecision,
  type AgentInfo,
  type SkillInfo,
  type AgentProject,
} from '@/lib/agent-session';
import { dangerousPermissionReason, yoloDecision } from '@/lib/agent-permission-safety';
import { useAgentSessionState } from '@/stores/agent-session-state';
import {
  EMPTY_TODOS,
  useAgentSheetBridge,
  type AgentSheetActions,
  type AgentSheetSnapshot,
} from '@/stores/agent-sheet-bridge';
import { ImagePreviewModal, type PreviewImage } from '@/components/image-preview-modal';
import { AgentAssistantMessage, AgentUserMessage } from './agent-message-block';
import {
  buildTimelineGroupsCached,
  createTimelineGroupCache,
  type TimelineRenderGroup,
} from '@/lib/agent-timeline-groups';
import { AgentPermissionCard } from './agent-permission-card';
import { AgentFormCard } from './agent-form-card';
import { AgentComposer } from './agent-composer';
import { ThinkingIndicator } from './agent-thinking-indicator';

/**
 * How many history timeline items the workbench reveals per page. The gateway
 * timeline only supports forward deltas, so history is paged on the client by
 * growing the rendered window downwards from the latest page.
 */
const HISTORY_PAGE_SIZE = 40;

/**
 * Distance from the bottom, in pixels, within which streaming output may keep
 * the list pinned to the latest message. Beyond it, the reader is browsing
 * history and new output must not move their viewport.
 */
const NEAR_BOTTOM_PX = 120;

function formatAgentErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const str = err instanceof Error ? err.message : String(err);
  if (
    str.includes('agent_engine_error') ||
    str.includes('agent_unavailable') ||
    str.includes('502') ||
    str.includes('503') ||
    str.includes('Connection refused') ||
    str.includes('Network error communicating with agent engine') ||
    str.includes('error sending request')
  ) {
    return 'OpenCode service is offline on the host. Please run "opencode serve --service" to start it.';
  }
  return str;
}

export interface AgentWorkbenchProps {
  sessionId: string;
  initialAsid?: string;
  topInset?: number;
  bottomInset?: number;
  createNewSessionRef?: React.MutableRefObject<(() => void) | null>;
  /** Wired to the workbench's abort call so a header can expose a Stop control. */
  abortSessionRef?: React.MutableRefObject<(() => void) | null>;
}

export const AgentWorkbench = memo(function AgentWorkbench({
  sessionId,
  initialAsid,
  topInset = 0,
  bottomInset = 0,
  createNewSessionRef,
  abortSessionRef,
}: AgentWorkbenchProps) {
  const { t } = useLingui();
  const router = useRouter();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const surfaceBackground = useSurfaceBackground();
  const markdownStyle = usePaneChatMarkdownStyle();
  const listRef = useRef<LegendListRef>(null);
  const injectDraftRef = useRef<((text: string) => void) | null>(null);
  // Whether the reader is currently at (or near) the bottom of the timeline.
  // Streaming output may only re-pin the list to the latest message while this
  // is true; once the reader scrolls up into history, their viewport stays put.
  const isNearBottomRef = useRef(true);

  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);
  const [activeAsid, setActiveAsid] = useState<string | undefined>(initialAsid);
  const [sessionInfo, setSessionInfo] = useState<AgentSessionInfo | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  // Index into `timeline` where the rendered window starts; history above it is
  // paged in on demand so entering a session lands on the latest messages.
  const [windowStart, setWindowStart] = useState(0);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [forms, setForms] = useState<FormRequest[]>([]);
  // What is waiting behind the current turn, as the gateway last stated it.
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  // A compaction in flight, which is a pill above the composer rather than a
  // row: the row lands in the timeline when the boundary is reached.
  const [compaction, setCompaction] = useState<{
    status: 'running';
    reason: CompactionReason;
  } | null>(null);
  // Highest timeline sequence seen; `after=`-style bookkeeping. A ref, never
  // state: bumping it must not re-run the stream effect or re-render anything.
  const lastSeqRef = useRef<number>(0);
  const [loading, setLoading] = useState(true);
  const [hasDiffs, setHasDiffs] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  // Whether the reader is browsing history, which is what shows the
  // jump-to-latest button.
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Attachment image preview. The shared lightbox, not a second copy of it:
  // `ImagePreviewModal` already owns pinch, drag-to-dismiss and the paging.
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

  const [selectedModel, setSelectedModel] = useState<ModelRef | undefined>(undefined);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>('build');
  // YOLO mode: every permission request is answered automatically, `allow`
  // except for the irreversibly dangerous commands the safety list denies.
  // Mirrored in a ref so the stream handler sees the current value without
  // re-subscribing the SSE connection on every toggle.
  const yoloModeRef = useRef(false);
  const [yoloMode, setYoloModeState] = useState(false);
  const setYoloMode = useCallback((next: boolean) => {
    yoloModeRef.current = next;
    setYoloModeState(next);
  }, []);
  // The model the workbench has actually settled on, tracked in a ref so the
  // catalog's async default cannot clobber the session model the server
  // restored: whichever source writes first wins, but a session's own model
  // must never be overwritten by the catalog catch-all afterwards.
  const appliedModelRef = useRef<ModelRef | undefined>(undefined);

  const applySelectedModel = useCallback((model: ModelRef | undefined) => {
    appliedModelRef.current = model;
    setSelectedModel(model);
  }, []);
  const [showReasoning, setShowReasoning] = useState<boolean>(true);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [knownProjects, setKnownProjects] = useState<AgentProject[]>([]);
  const [activeDirectory, setActiveDirectory] = useState<string | undefined>(undefined);

  // Load workspace catalog (available agents, skills & models)
  useEffect(() => {
    let mounted = true;
    getAgentCatalog(sessionId)
      .then((catalog) => {
        if (!mounted) return;
        if (catalog?.agents && catalog.agents.length > 0) {
          setAvailableAgents(catalog.agents);
        }
        if (catalog?.skills && catalog.skills.length > 0) {
          setSkills(catalog.skills);
        }
        if (catalog?.models && catalog.models.length > 0 && !appliedModelRef.current) {
          const defaultModel =
            catalog.models.find((m) => m.id.includes('free') || m.id.includes('spark')) ||
            catalog.models[0];
          const ref: ModelRef = {
            provider_id: defaultModel.provider_id,
            model_id: defaultModel.id,
          };
          applySelectedModel(ref);
        }
      })
      .catch((err) => {
        console.warn('Failed to load agent catalog:', err);
      });
    return () => {
      mounted = false;
    };
  }, [sessionId, applySelectedModel]);

  const initialCheckDoneRef = useRef(Boolean(initialAsid));

  // Load available sessions if no activeAsid
  const refreshSessions = useCallback(async () => {
    try {
      const list = await listAgentSessions(sessionId);
      setIsOffline(false);
      if (list) {
        setSessions(list);
        if (list.length > 0 && !activeAsid) {
          setActiveAsid(list[0].asid);
          setSessionInfo(list[0]);
          if (list[0].model) {
            applySelectedModel(list[0].model);
          }
          if (list[0].agent) setSelectedAgent(list[0].agent);
        } else if (list.length === 0) {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.warn('Failed to list agent sessions:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('502') ||
        errMsg.includes('503') ||
        errMsg.includes('agent_engine_error') ||
        errMsg.includes('agent_unavailable') ||
        errMsg.includes('Network error')
      ) {
        setIsOffline(true);
      }
      setLoading(false);
    } finally {
      initialCheckDoneRef.current = true;
    }
  }, [sessionId, activeAsid, applySelectedModel]);

  const handleTimelineScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentSize.height <= 0) return;
    const distanceFromBottom = contentOffset.y + layoutMeasurement.height - contentSize.height;
    const nearBottom = distanceFromBottom < NEAR_BOTTOM_PX;
    isNearBottomRef.current = nearBottom;
    // Mirror into state for the jump-to-latest affordance; React bails out when
    // the value is unchanged, so streaming near the bottom costs nothing.
    setIsNearBottom(nearBottom);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    isNearBottomRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Initial load
  useEffect(() => {
    void refreshSessions().catch(() => {});
  }, [refreshSessions]);

  // YOLO answers every permission request itself: `allow` for anything the
  // safety list lets through, `deny` (with a report) for irreversibly
  // destructive commands — this is the only honesty YOLO mode has.
  const handleAutoPermission = useCallback(
    (req: PermissionRequest) => {
      if (!activeAsid) return;
      const decision = yoloDecision(req);
      void replyAgentPermission(sessionId, activeAsid, req.id, decision).catch((err) => {
        console.warn('YOLO permission reply failed:', err);
      });
      const danger = dangerousPermissionReason(req);
      if (danger) {
        showToast({
          variant: 'danger',
          title: t`Blocked by agent safety`,
          message: req.resources[0] ?? t`Unknown command`,
        });
      }
    },
    [activeAsid, sessionId, showToast, t]
  );

  // Load full snapshot when activeAsid changes
  const loadSnapshot = useCallback(async () => {
    if (!activeAsid) {
      if (initialCheckDoneRef.current) {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const snap = await getAgentSessionSnapshot(sessionId, activeAsid);
      const info = snap.info;
      if (info) {
        setSessionInfo(info);
        if (info.directory) setActiveDirectory(info.directory);
      }
      setInbox(snap.inbox);
      setTimeline(snap.timeline);
      // Enter every session on its latest page: only the newest slice is
      // rendered at first and older history loads on demand from the top.
      setWindowStart(Math.max(0, snap.timeline.length - HISTORY_PAGE_SIZE));
      isNearBottomRef.current = true;
      setIsNearBottom(true);
      if (yoloModeRef.current) {
        // Auto-answer everything the engine raised while we were away — the
        // safety list still denies its share.
        for (const perm of snap.permissions) void handleAutoPermission(perm);
        for (const item of snap.timeline) {
          if (item.part.type === 'approval') void handleAutoPermission(item.part.request);
        }
        setPermissions([]);
      } else {
        setPermissions(snap.permissions);
      }
      setForms(snap.forms);
      lastSeqRef.current = snap.seq;
      if (info?.model) {
        applySelectedModel(info.model);
      }
      if (info?.agent) setSelectedAgent(info.agent);

      // Check diffs
      try {
        const diffs = await getAgentVcsDiff(sessionId, activeAsid);
        setHasDiffs(diffs.length > 0);
      } catch {
        setHasDiffs(false);
      }
    } catch (err) {
      console.warn('Failed to load snapshot:', err);
      if (
        err instanceof Error &&
        (err.message.includes('404') || err.message.includes('session_not_found'))
      ) {
        setActiveAsid(undefined);
        setSessionInfo(null);
        setTimeline([]);
        setWindowStart(0);
        setPermissions([]);
        setForms([]);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, activeAsid, applySelectedModel, handleAutoPermission]);

  useEffect(() => {
    void loadSnapshot().catch(() => {});
  }, [loadSnapshot]);

  // Load known projects for workspace switcher
  useEffect(() => {
    let mounted = true;
    getAgentProjects(sessionId)
      .then((projs) => {
        if (mounted && projs) setKnownProjects(projs);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [sessionId]);

  const handleStreamEvent = useCallback(
    (event: AgentDomainEvent) => {
      // Every frame carries the sequence the gateway is at; a reconnect asks
      // for whatever landed after it rather than refetching the world.
      if (event.seq > lastSeqRef.current) lastSeqRef.current = event.seq;

      switch (event.type) {
        case 'agent.timeline.upsert':
          setTimeline((prev) => upsertTimelineItems(prev, event.items));
          // Pinning to the latest message while the reader is at the bottom is
          // LegendList's `maintainScrollAtEnd` job (threshold-guarded); a
          // manual scrollToEnd here would start a new animation on every
          // stream tick and fight the reader's own gesture.
          break;

        case 'agent.timeline.removed': {
          const removedIds = new Set(event.ids);
          setTimeline((prev) => prev.filter((it) => !removedIds.has(it.id)));
          break;
        }

        case 'agent.status.changed': {
          // The status the engine reports is the status shown -- `failed`
          // keeps its error, `interrupted` says so, and nothing here forces
          // idle on the way past.
          setSessionInfo((prev) =>
            prev
              ? { ...prev, status: event.status, ...(event.error ? { error: event.error } : {}) }
              : prev
          );
          setSessions((prev) =>
            prev.map((s) => (s.asid === event.asid ? { ...s, status: event.status } : s))
          );
          if (event.status === 'idle') {
            // Delivered: a queued row is now ordinary history.
            setTimeline((prev) => prev.map((it) => (it.queued ? { ...it, queued: false } : it)));
            void refreshSessions();
          }
          break;
        }

        case 'agent.session.updated': {
          const info = event.info;
          setSessionInfo((prev) =>
            prev && prev.asid !== info.asid ? prev : prev ? { ...prev, ...info } : info
          );
          setSessions((prev) =>
            prev.some((s) => s.asid === info.asid)
              ? prev.map((s) => (s.asid === info.asid ? { ...s, ...info } : s))
              : [...prev, info]
          );
          break;
        }

        case 'agent.permission.pending':
          if (yoloModeRef.current) {
            handleAutoPermission(event.request);
          } else {
            setPermissions((prev) =>
              prev.some((p) => p.id === event.request.id) ? prev : [...prev, event.request]
            );
          }
          break;

        case 'agent.permission.resolved':
          setPermissions((prev) => prev.filter((p) => p.id !== event.request_id));
          break;

        case 'agent.form.pending':
          setForms((prev) =>
            prev.some((f) => f.id === event.request.id) ? prev : [...prev, event.request]
          );
          break;

        case 'agent.form.resolved':
          setForms((prev) => prev.filter((f) => f.id !== event.form_id));
          break;

        case 'agent.inbox.changed':
          // The whole queue every time, so there is no diff to reconcile.
          setInbox(event.items);
          break;

        case 'agent.compaction.changed':
          setCompaction(
            event.status === 'completed' || event.status === 'failed'
              ? null
              : {
                  status: event.status === 'started' ? 'running' : event.status,
                  reason: event.reason,
                }
          );
          break;

        case 'agent.resync':
          void loadSnapshot();
          break;
      }
    },
    [loadSnapshot, refreshSessions, handleAutoPermission]
  );

  // Real-time SSE stream — the only sync channel. Engine output arrives over
  // it; a dropped connection reconnects with a short backoff instead of being
  // papered over by polling. `lastSeq` intentionally lives in a ref so events
  // never re-declare this effect and tear the connection down mid-run.
  useEffect(() => {
    if (!activeAsid) return;
    let mounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const connect = () => {
      const closeStream = openAgentSessionStream({
        asid: activeAsid,
        sessionId,
        onEvent: (event) => {
          if (!mounted) return;
          attempts = 0;
          handleStreamEvent(event);
        },
        onError: () => {
          if (!mounted) return;
          // Quiet reconnect. Mobile streams drop often; keep the gap short so
          // a dropped connection costs at most a couple of seconds, not a poll.
          const delay = Math.min(400 * 2 ** attempts, 5000);
          attempts += 1;
          reconnectTimer = setTimeout(connect, delay);
        },
      });
      return closeStream;
    };

    const closeCurrent = connect();

    return () => {
      mounted = false;
      closeCurrent();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [sessionId, activeAsid, handleStreamEvent]);

  const handleSelectModel = useCallback(
    (model: ModelRef) => {
      applySelectedModel(model);
      // The server owns the per-session model via this call; on next entry the
      // session's own model is restored from it (see loadSnapshot).
      if (activeAsid) {
        void switchAgentModel(sessionId, activeAsid, model).catch((err) => {
          console.warn('Failed to switch agent model:', err);
        });
      }
    },
    [applySelectedModel, sessionId, activeAsid]
  );

  // Held in a ref so the sheet actions that use it (compact, clear) stay
  // stable and do not re-publish the action object on every render.
  const handleSendPromptRef = useRef<
    ((text: string, attachments?: string[], delivery?: 'steer' | 'queue') => Promise<void>) | null
  >(null);

  const handleSendPrompt = async (
    text: string,
    attachments?: string[],
    delivery?: 'steer' | 'queue'
  ) => {
    let currentAsid = activeAsid;
    if (!currentAsid) {
      try {
        const created = await createAgentSession(sessionId, {
          agent: selectedAgent,
          model: selectedModel,
          directory: activeDirectory ?? sessionInfo?.directory,
        });
        currentAsid = created.asid;
        setActiveAsid(created.asid);
        setSessionInfo(created);
      } catch (err) {
        console.warn('Failed to create session on prompt send:', err);
        return;
      }
    }

    const isQueued = isBusyStatus(sessionInfo?.status) && delivery === 'queue';

    // Optimistically add user text item
    const tempUserItem: TimelineItem = {
      id: `temp_usr_${Date.now()}`,
      message_id: `msg_${Date.now()}`,
      ordinal: 0,
      seq: lastSeqRef.current + 1,
      updated_ms: Date.now(),
      role: 'user',
      part: { type: 'text', text },
      attachments,
      queued: isQueued,
    };
    setTimeline((prev) => [...prev, tempUserItem]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    // No optimistic title. Auto-titling happens on the engine's first turn and
    // arrives as `agent.session.updated`; a client-side guess made from the
    // first thirty characters was only ever replaced a few seconds later, and
    // it is what put a truncated prompt in the strip instead of a real title.
    if (sessionInfo) {
      setSessionInfo({ ...sessionInfo, status: 'busy' });
    }

    try {
      await sendAgentPrompt(sessionId, currentAsid, {
        text,
        attachments,
        delivery,
      });
    } catch (err) {
      console.warn('Failed to send prompt:', err);
    }
  };

  // Assigned in an effect rather than during render: a ref written while
  // rendering is a ref React may throw away under Strict Mode, and the rule
  // that forbids it is the same one `react/refs` enforces everywhere else.
  useEffect(() => {
    handleSendPromptRef.current = handleSendPrompt;
  });

  const handleAbort = useCallback(async () => {
    if (!activeAsid) return;
    try {
      await abortAgentSession(sessionId, activeAsid);
    } catch (err) {
      console.warn('Failed to abort session:', err);
    } finally {
      if (sessionInfo) {
        setSessionInfo({ ...sessionInfo, status: 'idle' });
      }
    }
  }, [activeAsid, sessionId, sessionInfo]);

  const handlePermissionDecision = useCallback(
    async (permId: string, decision: PermissionDecision) => {
      if (!activeAsid) return;
      try {
        await replyAgentPermission(sessionId, activeAsid, permId, decision);
      } catch (err) {
        console.warn('Failed to reply permission:', err);
        showToast({
          variant: 'danger',
          title: t`Could not reply`,
          message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
        });
        return;
      }
      setPermissions((prev) => prev.filter((p) => p.id !== permId));
    },
    [activeAsid, sessionId, showToast, t]
  );

  const handleToggleYoloMode = useCallback(() => {
    const next = !yoloModeRef.current;
    setYoloMode(next);
    if (next) {
      showToast({
        variant: 'info',
        title: t`YOLO mode on`,
        message: t`Agent actions are auto-approved; dangerous commands stay blocked.`,
      });
    }
  }, [setYoloMode, showToast, t]);

  const handleFormSubmit = useCallback(
    async (formId: string, answers: Record<string, unknown>) => {
      if (!activeAsid) return;
      try {
        await replyAgentForm(sessionId, activeAsid, formId, answers);
      } catch (err) {
        console.warn('Failed to reply form:', err);
        showToast({
          variant: 'danger',
          title: t`Could not reply`,
          message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
        });
        return;
      }
      setForms((prev) => prev.filter((f) => f.id !== formId));
    },
    [activeAsid, sessionId, showToast, t]
  );

  const handleCreateNewSession = useCallback(async () => {
    if (isOffline) {
      showToast({
        variant: 'danger',
        title: t`OpenCode Service Offline`,
        message: t`Please start OpenCode on the server: opencode serve --service`,
      });
      return;
    }
    try {
      const created = await createAgentSession(sessionId, {
        agent: selectedAgent,
        model: selectedModel,
        directory: activeDirectory ?? sessionInfo?.directory,
      });
      setActiveAsid(created.asid);
      setSessionInfo(created);
      setTimeline([]);
      setWindowStart(0);
      setPermissions([]);
      setForms([]);
      lastSeqRef.current = 0;
      refreshSessions();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        variant: 'info',
        title: t`New Session`,
        message: t`Started a new session with clean context.`,
      });
    } catch (err) {
      console.warn('Failed to create session:', err);
      setIsOffline(true);
      showToast({
        variant: 'danger',
        title: t`Could not create session`,
        message: formatAgentErrorMessage(err, t`Failed to create agent session`),
      });
    }
  }, [
    isOffline,
    sessionId,
    selectedAgent,
    selectedModel,
    activeDirectory,
    sessionInfo,
    t,
    refreshSessions,
    showToast,
  ]);

  useEffect(() => {
    if (createNewSessionRef) {
      createNewSessionRef.current = handleCreateNewSession;
    }
  }, [createNewSessionRef, handleCreateNewSession]);

  useEffect(() => {
    if (abortSessionRef) {
      abortSessionRef.current = () => {
        void handleAbort();
      };
    }
  }, [abortSessionRef, handleAbort]);

  const handleSelectWorkspace = useCallback(
    async (directory: string, project?: AgentProject) => {
      setActiveDirectory(directory);
      try {
        const created = await createAgentSession(sessionId, {
          agent: selectedAgent,
          model: selectedModel,
          directory,
        });
        setActiveAsid(created.asid);
        setSessionInfo(created);
        setTimeline([]);
        setWindowStart(0);
        setPermissions([]);
        setForms([]);
        lastSeqRef.current = 0;
        refreshSessions();
      } catch (err) {
        console.warn('Failed to switch workspace session:', err);
        setIsOffline(true);
        showToast({
          variant: 'danger',
          title: t`Could not create session`,
          message: formatAgentErrorMessage(err, t`Failed to switch workspace session`),
        });
      }
    },
    [sessionId, selectedAgent, selectedModel, t, refreshSessions, showToast]
  );

  /**
   * Opening a picker is a navigation, not a boolean.
   *
   * Each of these used to flip a `visible` flag on a `<Modal>` that was in the
   * tree either way -- six components, six `useSafeAreaInsets` subscriptions
   * and, for the model and mode sheets, an effect watching that flag so it
   * could fetch the catalog. As routes they are mounted by the navigator when
   * the reader arrives and unmounted when they leave, so none of that work
   * exists until it is asked for. Identity travels as a param; what the sheet
   * reads while it is open comes from `stores/agent-sheet-bridge.ts`.
   */
  const openSessionsSheet = useCallback(() => {
    router.push('/agent-sessions');
  }, [router]);

  const openModelSheet = useCallback(() => {
    router.push({ pathname: '/agent-model', params: { sessionId } });
  }, [router, sessionId]);

  const openModeSheet = useCallback(() => {
    router.push({ pathname: '/agent-mode', params: { sessionId } });
  }, [router, sessionId]);

  const openWorkspaceSheet = useCallback(() => {
    router.push({ pathname: '/agent-workspace', params: { sessionId } });
  }, [router, sessionId]);

  const openContextSheet = useCallback(() => {
    router.push('/agent-context');
  }, [router]);

  const openTasksSheet = useCallback(() => {
    router.push('/agent-tasks');
  }, [router]);

  const openDiffSheet = useCallback(() => {
    if (!activeAsid) return;
    router.push({ pathname: '/agent-vcs-diff', params: { sessionId, asid: activeAsid } });
  }, [router, sessionId, activeAsid]);

  const handleToggleReasoning = useCallback(() => {
    setShowReasoning((prev) => !prev);
  }, []);

  const handleCompactContext = useCallback(() => {
    void handleSendPromptRef.current?.('/compact');
  }, []);

  const handleClearContext = useCallback(() => {
    void handleSendPromptRef.current?.('/clear');
  }, []);

  const handleEditQueuedItem = useCallback((itemId: string, text: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    injectDraftRef.current?.(text);
    setTimeline((prev) => prev.filter((it) => it.id !== itemId));
  }, []);

  const handleCancelQueuedItem = useCallback((itemId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeline((prev) => prev.filter((it) => it.id !== itemId));
  }, []);

  const renderTimelineItem = useCallback(
    ({ item: group }: LegendListRenderItemProps<TimelineRenderGroup>) => {
      if (group.role === 'user') {
        return (
          <View key={group.key}>
            {group.items.map((item) => (
              <AgentUserMessage
                key={item.id}
                item={item}
                onPreviewImage={setPreviewImageUri}
                onEditQueued={handleEditQueuedItem}
                onCancelQueued={handleCancelQueuedItem}
              />
            ))}
          </View>
        );
      }
      return (
        <AgentAssistantMessage
          key={group.key}
          group={group}
          showReasoning={showReasoning}
          markdownStyle={markdownStyle}
        />
      );
    },
    [showReasoning, markdownStyle, handleEditQueuedItem, handleCancelQueuedItem]
  );

  const isRunning = isBusyStatus(sessionInfo?.status);

  // Surface the active session's run state and title where the header can read
  // it without the workbench owning the header's render. A store write, not a
  // prop callback: both sides read the same value.
  useEffect(() => {
    useAgentSessionState.getState().setSessionStatus({
      running: isRunning,
      title: sessionInfo?.title,
    });
  }, [isRunning, sessionInfo?.title]);

  const isOverloaded = useMemo(() => {
    if (!isRunning && timeline.length > 0) {
      const lastItem = timeline[timeline.length - 1];
      if (lastItem && lastItem.role === 'assistant') {
        const text = lastItem.part.type === 'text' ? lastItem.part.text : '';
        const lower = text.toLowerCase();
        if (
          text.includes('负载太高') ||
          text.includes('负载过高') ||
          lower.includes('overload') ||
          lower.includes('rate limit') ||
          lower.includes('capacity') ||
          lower.includes('service unavailable') ||
          lower.includes('temporarily unavailable')
        ) {
          return true;
        }
      }
    }
    return false;
  }, [isRunning, timeline]);

  const activeProject = useMemo(() => {
    if (!activeDirectory) return undefined;
    return knownProjects.find(
      (p) => p.canonical === activeDirectory || activeDirectory.startsWith(p.canonical)
    );
  }, [activeDirectory, knownProjects]);

  useEffect(() => {
    useAgentSessionState.getState().setWorkspace(activeDirectory, activeProject);
  }, [activeDirectory, activeProject]);

  const displayWorkspaceName =
    activeProject?.name ||
    (activeDirectory ? activeDirectory.split('/').filter(Boolean).pop() : undefined) ||
    t`Workspace`;
  const displayWorkspacePath = activeDirectory || activeProject?.canonical || '~/';

  // Rendered window over the full timeline: entering a session shows the
  // latest page; earlier pages are prepended on demand.
  const visibleTimeline = useMemo(
    () => (windowStart > 0 ? timeline.slice(windowStart) : timeline),
    [timeline, windowStart]
  );

  // Group the window back into whole messages, the shape OpenCode's own UI
  // renders: reasoning and tool calls fold into the message they belong to.
  //
  // Through the cache, so a group whose items have not changed comes back as
  // the *same object*. That is what `itemsAreEqual` below is asserting, and
  // it is why one message streaming costs one cell re-render rather than the
  // whole visible list. The builder was already written to do this; nothing
  // was passing it the previous render's groups.
  const groupCache = useMemo(() => createTimelineGroupCache(), []);
  const renderGroups = useMemo(
    () => buildTimelineGroupsCached(groupCache, visibleTimeline),
    [groupCache, visibleTimeline]
  );

  // The group the reader is looking at when an earlier page is requested, so
  // the prepend can be anchored to it instead of jumping the viewport.
  const pendingAnchorRef = useRef<string | null>(null);

  const handleLoadEarlier = useCallback(() => {
    const anchorKey = renderGroups[0]?.key;
    if (anchorKey) {
      pendingAnchorRef.current = anchorKey;
    }
    setWindowStart((prev) => Math.max(0, prev - HISTORY_PAGE_SIZE));
  }, [renderGroups]);

  // After an earlier page is prepended, restore the viewport onto the message it
  // was showing so history loads in place.
  useEffect(() => {
    const anchorKey = pendingAnchorRef.current;
    if (!anchorKey) return;
    const anchorIndex = renderGroups.findIndex((g) => g.key === anchorKey);
    if (anchorIndex < 0) {
      pendingAnchorRef.current = null;
      return;
    }
    if (anchorIndex === 0) return; // The window has not grown yet.
    pendingAnchorRef.current = null;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: anchorIndex, animated: false, viewPosition: 0 });
    }, 60);
    return () => clearTimeout(timer);
  }, [renderGroups]);

  const listHeader = useMemo(() => {
    if (windowStart <= 0) return null;
    return (
      <PressableScale
        testID="agent-load-earlier-btn"
        onPress={handleLoadEarlier}
        accessibilityRole="button"
        accessibilityLabel={t`Load earlier messages`}
        style={[styles.loadEarlierBtn, { borderColor: theme.colors.border }]}>
        <ChevronUp size={13} color={theme.colors.textMuted} />
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Load earlier messages (${windowStart})`}
        </Text>
      </PressableScale>
    );
  }, [windowStart, handleLoadEarlier, theme.colors.border, theme.colors.textMuted, t]);

  const listFooter = useMemo(() => {
    const hasFormsOrPerms = permissions.length > 0 || forms.length > 0;
    if (!hasFormsOrPerms && !isRunning && !isOverloaded) return null;
    return (
      <View style={styles.footerContainer}>
        {isRunning ? (
          <View style={styles.thinkingRow}>
            <View
              style={[
                styles.thinkingPill,
                {
                  backgroundColor: surfaceBackground(theme.colors.surface),
                  borderColor: theme.colors.border,
                },
              ]}>
              <ThinkingIndicator size={13} color={theme.colors.primary} />
              <Text variant="caption" color={theme.colors.primary} weight="semibold">
                <Trans>Thinking…</Trans>
              </Text>
            </View>
          </View>
        ) : null}
        {isOverloaded ? (
          <View
            style={[
              styles.overloadBanner,
              {
                backgroundColor: surfaceBackground(withAlpha(theme.colors.warning, 0.12)),
                borderColor: withAlpha(theme.colors.warning, 0.35),
              },
            ]}>
            <View style={styles.overloadBannerContent}>
              <Zap size={15} color={theme.colors.warning} />
              <View style={styles.overloadBannerTextWrapper}>
                <Text variant="caption" weight="semibold" color={theme.colors.text}>
                  <Trans>Service is experiencing high load.</Trans>
                </Text>
                <Text variant="caption" color={theme.colors.textMuted}>
                  <Trans>Switch to Union Alpha (Fast & Free) for immediate response.</Trans>
                </Text>
              </View>
            </View>
            <PressableScale
              testID="agent-overload-fallback-btn"
              onPress={() => {
                const fallbackModel: ModelRef = {
                  provider_id: 'opencode',
                  model_id: 'union-alpha',
                };
                handleSelectModel(fallbackModel);
              }}
              style={[styles.overloadBannerBtn, { backgroundColor: theme.colors.primary }]}>
              <Text variant="caption" weight="bold" color={theme.colors.onPrimary}>
                <Trans>Switch & Retry</Trans>
              </Text>
            </PressableScale>
          </View>
        ) : null}
        {permissions.map((p) => (
          <AgentPermissionCard
            key={p.id}
            request={p}
            onDecision={(dec) => handlePermissionDecision(p.id, dec)}
          />
        ))}
        {forms.map((f) => (
          <AgentFormCard
            key={f.id}
            request={f}
            onSubmit={(answers) => handleFormSubmit(f.id, answers)}
          />
        ))}
      </View>
    );
  }, [
    permissions,
    forms,
    isRunning,
    isOverloaded,
    handlePermissionDecision,
    handleFormSubmit,
    handleSelectModel,
    surfaceBackground,
    theme.colors,
  ]);

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.asid === activeAsid) ?? sessionInfo;
  }, [sessions, activeAsid, sessionInfo]);

  const activeTokens = currentSession?.tokens ?? sessionInfo?.tokens;

  const activeTodos = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const it = timeline[i];
      if (it.part.type === 'todo' && it.part.items.length > 0) {
        return it.part.items;
      }
    }
    return undefined;
  }, [timeline]);

  /**
   * What the sheet routes read, published rather than passed.
   *
   * A store write, not a prop: the sheets are mounted by the navigator above
   * this screen, so there is nowhere to pass a prop to. `publish` commits
   * nothing when every field is unchanged, so a stream tick that only grows
   * the timeline never re-renders an open sheet -- and the workbench does not
   * subscribe to the bridge at all, so nothing a sheet writes back re-renders
   * the workbench either. Each sheet route selects only the fields it reads.
   */
  useEffect(() => {
    const snapshot: Partial<AgentSheetSnapshot> = {
      sessionId,
      activeAsid,
      sessions,
      knownProjects,
      activeDirectory,
      sessionInfo: sessionInfo ?? undefined,
      tokens: activeTokens,
      cost: sessionInfo?.cost,
      selectedModel,
      selectedAgent,
      showReasoning,
      yoloMode,
      todos: activeTodos ?? EMPTY_TODOS,
      inbox,
      compaction,
    };
    useAgentSheetBridge.getState().publish(snapshot);
  }, [
    sessionId,
    activeAsid,
    sessions,
    knownProjects,
    activeDirectory,
    sessionInfo,
    activeTokens,
    selectedModel,
    selectedAgent,
    showReasoning,
    yoloMode,
    activeTodos,
    inbox,
    compaction,
  ]);

  const sheetActions = useMemo<AgentSheetActions>(
    () => ({
      selectSession: setActiveAsid,
      createSession: () => {
        void handleCreateNewSession();
      },
      selectModel: handleSelectModel,
      selectAgentMode: setSelectedAgent,
      selectWorkspace: (directory, project) => {
        void handleSelectWorkspace(directory, project);
      },
      toggleReasoning: handleToggleReasoning,
      toggleYolo: handleToggleYoloMode,
      compactContext: handleCompactContext,
      clearContext: handleClearContext,
    }),
    [
      handleCreateNewSession,
      handleSelectModel,
      handleSelectWorkspace,
      handleToggleReasoning,
      handleToggleYoloMode,
      handleCompactContext,
      handleClearContext,
    ]
  );

  useEffect(() => {
    useAgentSheetBridge.getState().setActions(sheetActions);
  }, [sheetActions]);

  // A sheet outliving the workbench would be holding a closure over a session
  // that is gone. Emptying the bridge on unmount makes every handler a no-op
  // again rather than a stale one.
  useEffect(() => {
    return () => {
      useAgentSheetBridge.getState().reset();
    };
  }, []);

  /**
   * The one image the reader tapped, in the shape the shared lightbox takes.
   * Memoised so opening the viewer does not hand it a new array on every
   * stream tick, which would reset its pager.
   */
  const previewImages = useMemo<PreviewImage[] | null>(
    () => (previewImageUri ? [{ id: previewImageUri, uri: previewImageUri }] : null),
    [previewImageUri]
  );

  return (
    <View style={styles.root}>
      {/* Main Content Stream */}
      {loading ? (
        <View style={[styles.centerContainer, { paddingTop: topInset + 20 }]}>
          <TerminalNotice>
            <StatusDot color={theme.colors.primary} filled pulse size={7} />
            <Text variant="caption" numberOfLines={1} style={terminalNoticeStyles.label}>
              <Trans>Connecting to agent engine…</Trans>
            </Text>
          </TerminalNotice>
        </View>
      ) : timeline.length === 0 && permissions.length === 0 && forms.length === 0 ? (
        <View
          style={[
            styles.emptyScrollWrapper,
            { paddingTop: topInset + 20, paddingBottom: bottomInset + 185 },
          ]}>
          <Animated.View
            entering={fadeIn()}
            layout={listLayout()}
            style={[
              styles.emptyContainer,
              {
                backgroundColor: surfaceBackground(theme.colors.surface),
                borderColor: theme.colors.border,
              },
            ]}>
            <PressableScale
              testID="agent-empty-workspace-pill"
              onPress={openWorkspaceSheet}
              accessibilityLabel={t`Switch workspace: ${displayWorkspaceName}`}
              style={[
                styles.workspacePill,
                {
                  backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.08)),
                  borderColor: withAlpha(theme.colors.primary, 0.25),
                  marginBottom: 6,
                },
              ]}>
              <FolderGit2 size={13} color={theme.colors.primary} />
              <Text variant="caption" weight="bold" color={theme.colors.primary} numberOfLines={1}>
                {displayWorkspaceName}
              </Text>
              <Text
                variant="caption"
                color={theme.colors.textMuted}
                numberOfLines={1}
                style={styles.workspacePillPath}>
                {displayWorkspacePath}
              </Text>
              <ChevronDown size={12} color={theme.colors.primary} />
            </PressableScale>
            {isOffline ? (
              <>
                <Bot size={44} color={theme.colors.textMuted} />
                <Text variant="subheading" color={theme.colors.text} style={styles.emptyTitle}>
                  <Trans>OpenCode Service Offline</Trans>
                </Text>
                <Text variant="caption" color={theme.colors.textMuted} style={styles.emptySubtitle}>
                  <Trans>
                    OpenCode agent daemon is not running on this host. Run `opencode serve
                    --service` to start it.
                  </Trans>
                </Text>
                <PressableScale
                  testID="agent-offline-retry-btn"
                  onPress={async () => {
                    setCheckingHealth(true);
                    await refreshSessions();
                    setCheckingHealth(false);
                  }}
                  style={[
                    styles.emptyNewBtn,
                    { backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.14)) },
                  ]}>
                  {checkingHealth ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <RefreshCw size={14} color={theme.colors.primary} />
                  )}
                  <Text variant="label" color={theme.colors.primary} style={styles.emptyNewBtnText}>
                    <Trans>Check Again</Trans>
                  </Text>
                </PressableScale>
              </>
            ) : (
              <>
                <Bot size={44} color={theme.colors.primary} />
                <Text variant="subheading" color={theme.colors.text} style={styles.emptyTitle}>
                  <Trans>Welcome to OpenCode Agent</Trans>
                </Text>
                <Text variant="caption" color={theme.colors.textMuted} style={styles.emptySubtitle}>
                  <Trans>Ask questions, inspect files, or run commands in your workspace.</Trans>
                </Text>
                <View style={styles.emptyActionsRow}>
                  <PressableScale
                    testID="agent-empty-new-session-btn"
                    onPress={handleCreateNewSession}
                    style={[
                      styles.emptyNewBtn,
                      { backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.14)) },
                    ]}>
                    <PlusCircle size={14} color={theme.colors.primary} />
                    <Text
                      variant="label"
                      color={theme.colors.primary}
                      style={styles.emptyNewBtnText}>
                      <Trans>New Session</Trans>
                    </Text>
                  </PressableScale>
                  <PressableScale
                    testID="agent-empty-choose-project-btn"
                    onPress={openWorkspaceSheet}
                    style={[
                      styles.emptySecondaryBtn,
                      {
                        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                        borderColor: theme.colors.border,
                      },
                    ]}>
                    <FolderGit2 size={14} color={theme.colors.text} />
                    <Text variant="label" color={theme.colors.text} style={styles.emptyNewBtnText}>
                      <Trans>Choose Project</Trans>
                    </Text>
                  </PressableScale>
                </View>
              </>
            )}
          </Animated.View>
        </View>
      ) : (
        <LegendList<TimelineRenderGroup>
          ref={listRef}
          data={renderGroups}
          keyExtractor={keyOfGroup}
          renderItem={renderTimelineItem}
          /*
            Never, and this one is load-bearing rather than a preference. An
            assistant cell renders `EnrichedMarkdownText`, whose native view
            compares the incoming markdown against the last string it drew and
            re-parses when they differ -- which a recycle always makes them.
            Turning this on for "performance" would silently put a native
            markdown parse on every cell of every scroll.
            See docs/git-diff-viewer.md:362-380.
          */
          recycleItems={false}
          /*
            The other half of the identity deal, stated to the list itself: a
            group whose object has not changed has not changed.
            `buildTimelineGroupsCached` guarantees exactly that, so the
            strictest comparison is also the correct one, and the cheapest.
          */
          itemsAreEqual={groupsAreEqual}
          /*
            A user bubble, an assistant card carrying six tool shells and a diff
            block are wildly different heights, and one flat average across all
            of them is what makes a virtualised list jump when content lands
            above the viewport. The role is already the right bucket, so the
            list learns a size per kind instead.
          */
          getItemType={groupTypeOf}
          estimatedItemSize={70}
          initialScrollAtEnd={true}
          /*
            The reader's place across a change of *data* -- which is what
            "Load earlier messages" is here: the window comes back longer at the
            top, and the message they were reading has to stay under their eyes.
            The default covers rows changing size and skips that case.
          */
          maintainVisibleContentPosition={MAINTAIN_TIMELINE_POSITION}
          /*
            Follow the newest message, but only for a reader already at it --
            that is the threshold's job. New output must never move the viewport
            of someone who has scrolled up, which is also why there is no manual
            `scrollToEnd` on a stream tick.
          */
          maintainScrollAtEnd={true}
          maintainScrollAtEndThreshold={0.1}
          onScroll={handleTimelineScroll}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          style={styles.timelineScroll}
          contentContainerStyle={[
            styles.timelineContent,
            { paddingTop: topInset + 10, paddingBottom: bottomInset + 185 },
          ]}
        />
      )}

      {/* Jump back to the latest message while browsing history */}
      {!loading && timeline.length > 0 && !isNearBottom ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={[styles.jumpToLatestWrap, { bottom: bottomInset + 196 }]}>
          <GlassChrome surface="navigation" style={styles.jumpToLatestCircle}>
            <PressableScale
              testID="agent-jump-to-latest-btn"
              accessibilityRole="button"
              accessibilityLabel={t`Scroll to latest message`}
              onPress={handleJumpToLatest}
              style={styles.jumpToLatestInner}>
              <ChevronDown size={18} color={theme.colors.text} strokeWidth={2.2} />
            </PressableScale>
          </GlassChrome>
        </Animated.View>
      ) : null}

      {/* YOLO mode indicator — tap to switch auto-approval off again */}
      {!loading && yoloMode ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={[styles.yoloBannerWrap, { bottom: bottomInset + 196 }]}>
          <PressableScale
            testID="agent-yolo-indicator"
            accessibilityRole="button"
            accessibilityLabel={t`YOLO mode on — tap to turn off`}
            onPress={() => setYoloMode(false)}
            style={[
              styles.yoloBanner,
              {
                backgroundColor: surfaceBackground(withAlpha(theme.colors.danger, 0.16)),
                borderColor: withAlpha(theme.colors.danger, 0.45),
              },
            ]}>
            <ShieldAlert size={13} color={theme.colors.danger} />
            <Text variant="caption" weight="bold" color={theme.colors.danger}>
              YOLO
            </Text>
            <Text
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={1}
              style={styles.yoloBannerHint}>
              <Trans>auto-approving actions</Trans>
            </Text>
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* Floating Glass Composer at Bottom */}
      <AgentComposer
        disabled={isOffline}
        running={isRunning}
        sessions={sessions}
        availableAgents={availableAgents}
        skills={skills}
        sessionId={sessionId}
        activeAsid={activeAsid}
        activeDirectory={activeDirectory}
        activeProject={activeProject}
        selectedAgent={selectedAgent}
        selectedModel={selectedModel}
        hasDiffs={hasDiffs}
        bottomInset={bottomInset}
        tasks={activeTodos}
        tokens={activeTokens}
        cost={sessionInfo?.cost}
        sessionTitle={sessionInfo?.title}
        onSend={handleSendPrompt}
        onAbort={handleAbort}
        onSelectSession={setActiveAsid}
        onSelectAgentMode={setSelectedAgent}
        onCreateNewSession={handleCreateNewSession}
        onOpenModeSheet={openModeSheet}
        onOpenModelSheet={openModelSheet}
        onOpenDiffSheet={openDiffSheet}
        onOpenSessionsSheet={openSessionsSheet}
        onOpenTasksSheet={activeTodos && activeTodos.length > 0 ? openTasksSheet : undefined}
        onPressTokens={openContextSheet}
        onRefresh={loadSnapshot}
        injectDraftRef={injectDraftRef}
      />

      {/*
        The only overlay the workbench still mounts, and only while an image is
        open. Every picker is a route under `src/app/agent-*.tsx` now, so none
        of them is in this tree -- or fetching a catalog, or parsing a diff --
        unless the reader has actually navigated to it.
      */}
      {previewImages ? (
        <ImagePreviewModal
          images={previewImages}
          initialIndex={0}
          onClose={() => setPreviewImageUri(null)}
        />
      ) : null}
    </View>
  );
});

/**
 * Rows are addressed by `id` -- upsert, do not append -- and the result is put
 * back in the timeline's own `(message_id, ordinal)` order.
 *
 * The one exception is the optimistic user row: it carries a `temp_` id that
 * the server has never seen, so it is matched on its text and replaced in
 * place. Without that the reader's own message appears twice for a moment.
 */
function upsertTimelineItems(
  previous: readonly TimelineItem[],
  incoming: readonly TimelineItem[]
): TimelineItem[] {
  if (incoming.length === 0) return previous as TimelineItem[];
  const next = [...previous];
  let dirty = false;
  for (const item of incoming) {
    const existing = next.findIndex((it) => it.id === item.id);
    if (existing >= 0) {
      next[existing] = item;
      dirty = true;
      continue;
    }
    if (item.role === 'user' && item.part.type === 'text') {
      const text = item.part.text.trim();
      const optimistic = next.findIndex(
        (it) =>
          it.id.startsWith('temp_') &&
          it.role === 'user' &&
          it.part.type === 'text' &&
          it.part.text.trim() === text
      );
      if (optimistic >= 0) {
        next[optimistic] = item;
        dirty = true;
        continue;
      }
    }
    next.push(item);
    dirty = true;
  }
  return dirty ? sortTimeline(next) : (previous as TimelineItem[]);
}

function keyOfGroup(group: TimelineRenderGroup): string {
  return group.key;
}

/** The role is the size bucket: see `getItemType` above. */
function groupTypeOf(group: TimelineRenderGroup): string {
  return group.role;
}

function groupsAreEqual(previous: TimelineRenderGroup, next: TimelineRenderGroup): boolean {
  return previous === next;
}

/** Anchor on a change of data, not only on rows changing size. */
const MAINTAIN_TIMELINE_POSITION = { data: true, size: true } as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
  },
  timelineScroll: {
    flex: 1,
  },
  timelineContent: {
    paddingHorizontal: 14,
    gap: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
    marginHorizontal: 8,
    marginTop: 30,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  emptyTitle: {
    fontWeight: '700',
    fontSize: 16,
  },
  emptySubtitle: {
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },
  emptyActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  emptyNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  emptySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyNewBtnText: {
    fontWeight: '600',
    fontSize: 12,
  },
  userBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginVertical: 4,
  },
  userBubble: {
    maxWidth: '85%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  assistantTextRow: {
    marginVertical: 4,
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  markdownContainer: {
    alignSelf: 'flex-start',
  },
  thinkingRow: {
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  thinkingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  partRow: {
    marginVertical: 4,
  },
  statusRow: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  statusText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  emptyScrollWrapper: {
    flex: 1,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  headerPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    marginBottom: 4,
  },
  workspacePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '85%',
  },
  workspacePillPath: {
    fontSize: 11,
    flexShrink: 1,
  },
  overloadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    marginVertical: 4,
  },
  overloadBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  overloadBannerTextWrapper: {
    flex: 1,
    gap: 2,
  },
  overloadBannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  footerContainer: {
    gap: 10,
    marginTop: 4,
  },
  loadEarlierBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    marginVertical: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  jumpToLatestWrap: {
    position: 'absolute',
    right: 14,
    zIndex: 5,
  },
  jumpToLatestCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpToLatestInner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  yoloBannerWrap: {
    position: 'absolute',
    left: 14,
    zIndex: 5,
  },
  yoloBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  yoloBannerHint: {
    flexShrink: 1,
    fontSize: 11,
  },
  bubbleAttachmentsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  bubbleImageWrapper: {
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  bubbleImageThumbnail: {
    width: 160,
    height: 110,
    borderRadius: 14,
  },
  bubbleFileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
  },
  bubbleFileName: {
    fontSize: 12,
    flexShrink: 1,
  },
  queuedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  queuedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  queuedPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  queuedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queuedActionBtn: {
    padding: 3,
  },
});
