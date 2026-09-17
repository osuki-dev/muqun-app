import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
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
  Sparkles,
  X,
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
  getAgentTimelineDelta,
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
  type AgentSessionInfo,
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
import { AgentTodoBlock } from './agent-todo-block';
import {
  AgentAssistantMessage,
  AgentUserMessage,
  buildTimelineGroups,
  type TimelineRenderGroup,
} from './agent-message-block';
import { AgentPermissionCard } from './agent-permission-card';
import { AgentFormCard } from './agent-form-card';
import { AgentModelSheet } from './agent-model-sheet';
import { AgentModeSheet } from './agent-mode-sheet';
import { AgentVcsDiffSheet } from './agent-vcs-diff-sheet';
import { AgentSessionsSheet } from './agent-sessions-sheet';
import { AgentContextSheet } from './agent-context-sheet';
import { AgentWorkspaceSheet } from './agent-workspace-sheet';
import { AgentComposer } from './agent-composer';

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
  onModelChange?: (model: ModelRef | undefined) => void;
  openModelSheetRef?: React.MutableRefObject<(() => void) | null>;
  onWorkspaceChange?: (directory?: string, project?: AgentProject) => void;
  openWorkspaceSheetRef?: React.MutableRefObject<(() => void) | null>;
  createNewSessionRef?: React.MutableRefObject<(() => void) | null>;
  /** Wired to the workbench's abort call so a header can expose a Stop control. */
  abortSessionRef?: React.MutableRefObject<(() => void) | null>;
  /** Notifies the host screen (e.g. the header) of the active session's run state. */
  onSessionStateChange?: (state: { running: boolean; title: string | undefined }) => void;
}

export const AgentWorkbench = memo(function AgentWorkbench({
  sessionId,
  initialAsid,
  topInset = 0,
  bottomInset = 0,
  onModelChange,
  openModelSheetRef,
  onWorkspaceChange,
  openWorkspaceSheetRef,
  createNewSessionRef,
  abortSessionRef,
  onSessionStateChange,
}: AgentWorkbenchProps) {
  const { t } = useLingui();
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
  const [lastSeq, setLastSeq] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [hasDiffs, setHasDiffs] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  // Whether the reader is browsing history, which is what shows the
  // jump-to-latest button.
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Attachment Image Preview Modal
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

  // Sheets
  const [modelSheetVisible, setModelSheetVisible] = useState(false);
  const [workspaceSheetVisible, setWorkspaceSheetVisible] = useState(false);
  const [modeSheetVisible, setModeSheetVisible] = useState(false);
  const [diffSheetVisible, setDiffSheetVisible] = useState(false);
  const [sessionsSheetVisible, setSessionsSheetVisible] = useState(false);
  const [contextSheetVisible, setContextSheetVisible] = useState(false);
  const [tasksModalVisible, setTasksModalVisible] = useState(false);
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

  const applySelectedModel = useCallback(
    (model: ModelRef | undefined) => {
      appliedModelRef.current = model;
      setSelectedModel(model);
      onModelChange?.(model);
    },
    [onModelChange]
  );
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

  useEffect(() => {
    if (openModelSheetRef) {
      openModelSheetRef.current = () => setModelSheetVisible(true);
    }
  }, [openModelSheetRef]);

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
      if (snap.info) {
        setSessionInfo(snap.info);
        if (snap.info.directory) setActiveDirectory(snap.info.directory);
      }
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
      setLastSeq(snap.seq);
      if (snap.info?.model) {
        applySelectedModel(snap.info.model);
      }
      if (snap.info?.agent) setSelectedAgent(snap.info.agent);

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
    (event: string, data: unknown) => {
      const payload = data as {
        items?: TimelineItem[];
        item?: TimelineItem;
        ids?: string[];
        status?: AgentSessionInfo['status'];
        info?: AgentSessionInfo;
        update?: AgentSessionInfo;
        request?: PermissionRequest | FormRequest;
        request_id?: string;
        form_id?: string;
        seq?: number;
      };

      if (event === 'agent.timeline.upsert') {
        const items: TimelineItem[] = payload?.items ?? (payload?.item ? [payload.item] : []);
        if (items.length > 0) {
          setTimeline((prev) => {
            const next = [...prev];
            for (const item of items) {
              const existingIdx = next.findIndex((it) => it.id === item.id);
              if (existingIdx >= 0) {
                next[existingIdx] = item;
              } else if (item.role === 'user' && item.part.type === 'text') {
                const userText = item.part.text.trim();
                const tempIdx = next.findIndex(
                  (it) =>
                    (it.id.startsWith('temp_') || it.id.startsWith('usr_')) &&
                    it.role === 'user' &&
                    it.part.type === 'text' &&
                    it.part.text.trim() === userText
                );
                if (tempIdx >= 0) {
                  next[tempIdx] = item;
                } else {
                  next.push(item);
                }
              } else {
                next.push(item);
              }
            }
            return next;
          });
          if (payload?.seq) {
            setLastSeq((prev) => Math.max(prev, payload.seq ?? 0));
          }
          // Only keep the reader pinned to the latest message while they are
          // at the bottom; new output must never yank them out of history.
          setTimeout(() => {
            if (isNearBottomRef.current) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }, 60);
        }
      } else if (event === 'agent.timeline.removed') {
        const removedIds = new Set(payload?.ids ?? []);
        if (removedIds.size > 0) {
          setTimeline((prev) => prev.filter((it) => !removedIds.has(it.id)));
        }
      } else if (event === 'agent.status.changed') {
        const status = payload?.status;
        if (status) {
          setSessionInfo((prev) => (prev ? { ...prev, status } : prev));
          if (status === 'idle') {
            // Unmark queued status on timeline items as they are now delivered/executed
            setTimeline((prev) => prev.map((it) => (it.queued ? { ...it, queued: false } : it)));
            // Refresh sessions list & active session snapshot to obtain the LLM-generated title
            refreshSessions();
            if (activeAsid) {
              void getAgentSessionSnapshot(sessionId, activeAsid)
                .then((snap) => {
                  if (snap.info) {
                    setSessionInfo(snap.info);
                    setSessions((prev) =>
                      prev.map((s) => (s.asid === snap.info.asid ? { ...s, ...snap.info } : s))
                    );
                  }
                })
                .catch(() => {});
            }
          }
        }
      } else if (event === 'agent.session.updated') {
        const info = payload?.info ?? payload?.update;
        if (info) {
          setSessionInfo((prev) => (prev ? { ...prev, ...info } : info));
          setSessions((prev) => prev.map((s) => (s.asid === info.asid ? { ...s, ...info } : s)));
        }
      } else if (event === 'agent.permission.pending') {
        const req = payload?.request as PermissionRequest | undefined;
        if (req) {
          if (yoloModeRef.current) {
            void handleAutoPermission(req);
          } else {
            setPermissions((prev) => {
              if (prev.some((p) => p.id === req.id)) return prev;
              return [...prev, req];
            });
          }
        }
      } else if (event === 'agent.permission.resolved') {
        const reqId = payload?.request_id;
        if (reqId) {
          setPermissions((prev) => prev.filter((p) => p.id !== reqId));
        }
      } else if (event === 'agent.form.pending') {
        const form = payload?.request as FormRequest | undefined;
        if (form) {
          setForms((prev) => {
            if (prev.some((f) => f.id === form.id)) return prev;
            return [...prev, form];
          });
        }
      } else if (event === 'agent.form.resolved') {
        const formId = payload?.form_id;
        if (formId) {
          setForms((prev) => prev.filter((f) => f.id !== formId));
        }
      } else if (event === 'agent.resync') {
        void loadSnapshot();
      }
    },
    [loadSnapshot, activeAsid, sessionId, refreshSessions, handleAutoPermission]
  );

  // Real-time SSE Stream subscription + gentle fallback heartbeat polling
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- scrollTimer is cleared on unmount in cleanup below.
  useEffect(() => {
    if (!activeAsid) return;
    let mounted = true;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    const closeStream = openAgentSessionStream({
      asid: activeAsid,
      sessionId,
      onEvent: (event, rawData) => {
        if (!mounted) return;
        handleStreamEvent(event, rawData);
      },
      onError: () => {
        // Quiet fail - fallback heartbeat will maintain synchronization
      },
    });

    const poll = async () => {
      try {
        const delta = await getAgentTimelineDelta(sessionId, activeAsid, lastSeq);
        if (!mounted) return;
        if (delta.items && delta.items.length > 0) {
          setTimeline((prev) => {
            const next = [...prev];
            for (const item of delta.items!) {
              const existingIdx = next.findIndex((it) => it.id === item.id);
              if (existingIdx >= 0) {
                next[existingIdx] = item;
              } else if (item.role === 'user' && item.part.type === 'text') {
                const userText = item.part.text.trim();
                const tempIdx = next.findIndex(
                  (it) =>
                    (it.id.startsWith('temp_') || it.id.startsWith('usr_')) &&
                    it.role === 'user' &&
                    it.part.type === 'text' &&
                    it.part.text.trim() === userText
                );
                if (tempIdx >= 0) {
                  next[tempIdx] = item;
                } else {
                  next.push(item);
                }
              } else {
                next.push(item);
              }
            }
            return next;
          });
          setLastSeq(delta.latest_seq);
          scrollTimer = setTimeout(() => {
            if (isNearBottomRef.current) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }, 100);
        }
        if (delta.status) {
          setSessionInfo((prev) => (prev ? { ...prev, status: delta.status! } : prev));
        }
      } catch {
        // quiet poll fail
      }
    };

    const timer = setInterval(poll, 3500);

    return () => {
      mounted = false;
      closeStream();
      clearInterval(timer);
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, [sessionId, activeAsid, lastSeq, handleStreamEvent]);

  const handleSelectModel = useCallback(
    (model: ModelRef) => {
      applySelectedModel(model);
      setModelSheetVisible(false);
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

  const handleSendPrompt = async (
    text: string,
    attachments?: string[],
    delivery?: 'steer' | 'queue'
  ) => {
    let currentAsid = activeAsid;
    if (!currentAsid) {
      try {
        const created = await createAgentSession(sessionId, {
          title: text.slice(0, 30) || t`New Session`,
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

    const isQueued = sessionInfo?.status === 'running' && delivery === 'queue';

    // Optimistically add user text item
    const tempUserItem: TimelineItem = {
      id: `temp_usr_${Date.now()}`,
      message_id: `msg_${Date.now()}`,
      seq: lastSeq + 1,
      updated_ms: Date.now(),
      role: 'user',
      part: { type: 'text', text },
      attachments,
      queued: isQueued,
    };
    setTimeline((prev) => [...prev, tempUserItem]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    // Optimistically update session title if current title is default/untitled
    const optimisticTitle = text.slice(0, 30);
    if (
      !sessionInfo?.title ||
      sessionInfo.title === t`New Session` ||
      sessionInfo.title.startsWith('ses_')
    ) {
      if (sessionInfo) {
        setSessionInfo({ ...sessionInfo, title: optimisticTitle, status: 'running' });
      }
      setSessions((prev) =>
        prev.map((s) => (s.asid === currentAsid ? { ...s, title: optimisticTitle } : s))
      );
    } else if (sessionInfo) {
      setSessionInfo({ ...sessionInfo, status: 'running' });
    }

    try {
      await sendAgentPrompt(sessionId, currentAsid, {
        text,
        model: selectedModel,
        attachments,
        delivery,
      });
    } catch (err) {
      console.warn('Failed to send prompt:', err);
    }
  };

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
      await replyAgentPermission(sessionId, activeAsid, permId, decision);
      setPermissions((prev) => prev.filter((p) => p.id !== permId));
    },
    [activeAsid, sessionId]
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
      await replyAgentForm(sessionId, activeAsid, formId, answers);
      setForms((prev) => prev.filter((f) => f.id !== formId));
    },
    [activeAsid, sessionId]
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
        title: t`New Session`,
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
      setLastSeq(0);
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
    if (openWorkspaceSheetRef) {
      openWorkspaceSheetRef.current = () => setWorkspaceSheetVisible(true);
    }
  }, [openWorkspaceSheetRef]);

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
      setWorkspaceSheetVisible(false);
      try {
        const created = await createAgentSession(sessionId, {
          title: project?.name || directory.split('/').filter(Boolean).pop() || t`New Session`,
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
        setLastSeq(0);
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

  const isRunning = sessionInfo?.status === 'running';

  // Surface the active session's run state and title to the host screen so its
  // header can react (Stop control, live session title) without owning any of
  // the session wiring itself.
  useEffect(() => {
    onSessionStateChange?.({ running: isRunning, title: sessionInfo?.title });
  }, [isRunning, sessionInfo?.title, onSessionStateChange]);

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
    onWorkspaceChange?.(activeDirectory, activeProject);
  }, [activeDirectory, activeProject, onWorkspaceChange]);

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
  const renderGroups = useMemo(() => buildTimelineGroups(visibleTimeline), [visibleTimeline]);

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
              <Sparkles size={13} color={theme.colors.primary} />
              <Text variant="caption" color={theme.colors.primary} weight="semibold">
                <Trans>Thinking…</Trans>
              </Text>
              <ActivityIndicator
                size="small"
                color={theme.colors.primary}
                style={styles.thinkingSpinner}
              />
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
              <Text variant="caption" weight="bold" color="#fff">
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
              onPress={() => setWorkspaceSheetVisible(true)}
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
                    onPress={() => setWorkspaceSheetVisible(true)}
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
          keyExtractor={(group) => group.key}
          renderItem={renderTimelineItem}
          recycleItems={false}
          estimatedItemSize={70}
          initialScrollAtEnd={true}
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
        onOpenModeSheet={() => setModeSheetVisible(true)}
        onOpenModelSheet={() => setModelSheetVisible(true)}
        onOpenDiffSheet={() => setDiffSheetVisible(true)}
        onOpenSessionsSheet={() => setSessionsSheetVisible(true)}
        onOpenTasksSheet={
          activeTodos && activeTodos.length > 0 ? () => setTasksModalVisible(true) : undefined
        }
        onPressTokens={() => setContextSheetVisible(true)}
        onRefresh={loadSnapshot}
        injectDraftRef={injectDraftRef}
      />

      {/* Context & Cost Sheet */}
      <AgentContextSheet
        visible={contextSheetVisible}
        session={sessionInfo ?? undefined}
        tokens={activeTokens}
        cost={sessionInfo?.cost}
        showReasoning={showReasoning}
        onToggleReasoning={() => setShowReasoning((prev) => !prev)}
        yoloMode={yoloMode}
        onToggleYolo={handleToggleYoloMode}
        onClose={() => setContextSheetVisible(false)}
        onCompact={() => handleSendPrompt('/compact')}
        onClear={() => handleSendPrompt('/clear')}
      />

      {/* All Sessions Sheet (roots + subagents, search, select) */}
      <AgentSessionsSheet
        visible={sessionsSheetVisible}
        sessions={sessions}
        activeAsid={activeAsid}
        knownProjects={knownProjects}
        activeDirectory={activeDirectory}
        onSelectSession={setActiveAsid}
        onCreateNewSession={handleCreateNewSession}
        onClose={() => setSessionsSheetVisible(false)}
      />

      {/* Mode Selection Sheet (Build, Explore, Plan, General) */}
      <AgentModeSheet
        visible={modeSheetVisible}
        selectedAgent={selectedAgent}
        onSelectAgent={(ag) => {
          setSelectedAgent(ag);
          setModeSheetVisible(false);
        }}
        onClose={() => setModeSheetVisible(false)}
      />

      {/* Model Selection Sheet (Real OpenCode models, compact, grouped by provider) */}
      <AgentModelSheet
        visible={modelSheetVisible}
        selectedModel={selectedModel}
        onSelectModel={handleSelectModel}
        onClose={() => setModelSheetVisible(false)}
      />

      {/* Workspace / Multi-Project Switcher Sheet */}
      <AgentWorkspaceSheet
        visible={workspaceSheetVisible}
        activeDirectory={activeDirectory}
        sessionId={sessionId}
        initialProjects={knownProjects}
        onSelectWorkspace={handleSelectWorkspace}
        onClose={() => setWorkspaceSheetVisible(false)}
      />

      {/* VCS Code Diff Sheet */}
      {activeAsid ? (
        <AgentVcsDiffSheet
          visible={diffSheetVisible}
          sessionId={sessionId}
          asid={activeAsid}
          onClose={() => setDiffSheetVisible(false)}
        />
      ) : null}

      {/* Tasks Overview Modal */}
      {activeTodos && activeTodos.length > 0 ? (
        <Modal
          visible={tasksModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setTasksModalVisible(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setTasksModalVisible(false)}>
            <Pressable
              testID="agent-tasks-modal"
              onPress={(e) => e.stopPropagation()}
              style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Text variant="heading" style={styles.modalTitle}>
                  <Trans>Tasks Progress</Trans>
                </Text>
                <PressableScale
                  testID="agent-tasks-close"
                  onPress={() => setTasksModalVisible(false)}
                  style={styles.modalCloseBtn}
                  accessibilityLabel={t`Close`}>
                  <X size={18} color={theme.colors.textMuted} />
                </PressableScale>
              </View>
              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <AgentTodoBlock items={activeTodos} defaultExpanded={true} />
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* Fullscreen Image Preview Modal */}
      {previewImageUri ? (
        <Modal
          visible={Boolean(previewImageUri)}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewImageUri(null)}>
          <Pressable style={styles.imagePreviewBackdrop} onPress={() => setPreviewImageUri(null)}>
            <PressableScale
              onPress={() => setPreviewImageUri(null)}
              style={styles.imagePreviewCloseBtn}>
              <X size={20} color="#fff" />
            </PressableScale>
            <Image
              source={{ uri: previewImageUri }}
              style={styles.imagePreviewFull}
              contentFit="contain"
            />
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
});

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
  thinkingSpinner: {
    transform: [{ scale: 0.75 }],
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: 34,
    paddingHorizontal: 16,
    maxHeight: '65%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.4)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 999,
  },
  modalBody: {
    maxHeight: 350,
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
  imagePreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewFull: {
    width: '94%',
    height: '80%',
  },
  imagePreviewCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
