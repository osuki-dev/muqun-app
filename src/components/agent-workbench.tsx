import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import {
  Bot,
  ChevronDown,
  Copy,
  Edit3,
  FileText,
  FolderGit2,
  MoreHorizontal,
  PlusCircle,
  RotateCcw,
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
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { isSafeExternalLink } from '@/lib/safe-link';
import { withAlpha } from '@/lib/color';
import { DURATION } from '@/lib/motion';
import { TerminalNotice, terminalNoticeStyles } from '@/components/terminal-notice';
import { StatusDot } from '@/components/status-dot';
import {
  getAgentSessionSnapshot,
  getAgentTimelineDelta,
  listAgentSessions,
  createAgentSession,
  sendAgentPrompt,
  revertAgentSession,
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
import { EmbeddedTerminalToolBlock } from './embedded-terminal-tool-block';
import { AgentReasoningBlock } from './agent-reasoning-block';
import { AgentTodoBlock } from './agent-todo-block';
import { AgentPermissionCard } from './agent-permission-card';
import { AgentFormCard } from './agent-form-card';
import { AgentModelSheet } from './agent-model-sheet';
import { AgentModeSheet } from './agent-mode-sheet';
import { AgentVcsDiffSheet } from './agent-vcs-diff-sheet';
import { AgentSessionsSheet } from './agent-sessions-sheet';
import { AgentContextSheet } from './agent-context-sheet';
import { AgentWorkspaceSheet } from './agent-workspace-sheet';
import { AgentComposer } from './agent-composer';

const IMAGE_DATA_URI_PREFIX = 'data:image/';
function isImageAttachment(uri: string): boolean {
  return (
    uri.startsWith(IMAGE_DATA_URI_PREFIX) ||
    /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(uri)
  );
}

export interface AgentWorkbenchProps {
  sessionId: string;
  initialAsid?: string;
  topInset?: number;
  bottomInset?: number;
  onModelChange?: (model: ModelRef | undefined) => void;
  openModelSheetRef?: React.MutableRefObject<(() => void) | null>;
}

export const AgentWorkbench = memo(function AgentWorkbench({
  sessionId,
  initialAsid,
  topInset = 0,
  bottomInset = 0,
  onModelChange,
  openModelSheetRef,
}: AgentWorkbenchProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const surfaceBackground = useSurfaceBackground();
  const markdownStyle = usePaneChatMarkdownStyle();
  const listRef = useRef<LegendListRef>(null);
  const injectDraftRef = useRef<((text: string) => void) | null>(null);

  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);
  const [activeAsid, setActiveAsid] = useState<string | undefined>(initialAsid);
  const [sessionInfo, setSessionInfo] = useState<AgentSessionInfo | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [forms, setForms] = useState<FormRequest[]>([]);
  const [lastSeq, setLastSeq] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [hasDiffs, setHasDiffs] = useState(false);

  // Message Actions & Attachment Modals
  const [messageActionItem, setMessageActionItem] = useState<TimelineItem | null>(null);
  const [confirmRevertItem, setConfirmRevertItem] = useState<TimelineItem | null>(null);
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
        if (catalog?.models && catalog.models.length > 0 && !selectedModel) {
          const defaultModel =
            catalog.models.find((m) => m.id.includes('free') || m.id.includes('spark')) ||
            catalog.models[0];
          const ref: ModelRef = {
            provider_id: defaultModel.provider_id,
            model_id: defaultModel.id,
          };
          setSelectedModel(ref);
          onModelChange?.(ref);
        }
      })
      .catch((err) => {
        console.warn('Failed to load agent catalog:', err);
      });
    return () => {
      mounted = false;
    };
  }, [sessionId, selectedModel, onModelChange]);

  useEffect(() => {
    if (openModelSheetRef) {
      openModelSheetRef.current = () => setModelSheetVisible(true);
    }
  }, [openModelSheetRef]);

  // Load available sessions if no activeAsid
  const refreshSessions = useCallback(async () => {
    try {
      const list = await listAgentSessions(sessionId);
      if (list) {
        setSessions(list);
        if (list.length > 0 && !activeAsid) {
          setActiveAsid(list[0].asid);
          setSessionInfo(list[0]);
          if (list[0].model) {
            setSelectedModel(list[0].model);
            onModelChange?.(list[0].model);
          }
          if (list[0].agent) setSelectedAgent(list[0].agent);
        }
      }
    } catch (err) {
      console.warn('Failed to list agent sessions:', err);
    }
  }, [sessionId, activeAsid, onModelChange]);

  // Initial load
  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // Load full snapshot when activeAsid changes
  const loadSnapshot = useCallback(async () => {
    if (!activeAsid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const snap = await getAgentSessionSnapshot(sessionId, activeAsid);
      setSessionInfo(snap.info);
      if (snap.info?.directory) {
        setActiveDirectory(snap.info.directory);
      }
      setTimeline(snap.timeline);
      setPermissions(snap.permissions);
      setForms(snap.forms);
      setLastSeq(snap.seq);
      if (snap.info?.model) {
        setSelectedModel(snap.info.model);
        onModelChange?.(snap.info.model);
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
        setPermissions([]);
        setForms([]);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, activeAsid, onModelChange]);

  useEffect(() => {
    loadSnapshot();
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
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
        }
      } else if (event === 'agent.timeline.removed') {
        const ids = payload?.ids ?? [];
        if (ids.length > 0) {
          setTimeline((prev) => prev.filter((it) => !ids.includes(it.id)));
        }
      } else if (event === 'agent.status.changed') {
        const status = payload?.status;
        if (status) {
          setSessionInfo((prev) => (prev ? { ...prev, status } : prev));
        }
      } else if (event === 'agent.session.updated') {
        const info = payload?.info ?? payload?.update;
        if (info) {
          setSessionInfo((prev) => (prev ? { ...prev, ...info } : info));
        }
      } else if (event === 'agent.permission.pending') {
        const req = payload?.request as PermissionRequest | undefined;
        if (req) {
          setPermissions((prev) => {
            if (prev.some((p) => p.id === req.id)) return prev;
            return [...prev, req];
          });
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
    [loadSnapshot]
  );

  // Real-time SSE Stream subscription + gentle fallback heartbeat polling
  useEffect(() => {
    if (!activeAsid) return;
    let mounted = true;

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
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
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
    };
  }, [sessionId, activeAsid, lastSeq, handleStreamEvent]);

  const handleSelectModel = useCallback(
    (model: ModelRef) => {
      setSelectedModel(model);
      setModelSheetVisible(false);
      onModelChange?.(model);
      if (activeAsid) {
        void switchAgentModel(sessionId, activeAsid, model).catch((err) => {
          console.warn('Failed to switch agent model:', err);
        });
      }
    },
    [sessionId, activeAsid, onModelChange]
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

    // Optimistically add user text item
    const tempUserItem: TimelineItem = {
      id: `temp_usr_${Date.now()}`,
      message_id: `msg_${Date.now()}`,
      seq: lastSeq + 1,
      updated_ms: Date.now(),
      role: 'user',
      part: { type: 'text', text },
      attachments,
    };
    setTimeline((prev) => [...prev, tempUserItem]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      await sendAgentPrompt(sessionId, currentAsid, {
        text,
        model: selectedModel,
        attachments,
        delivery,
      });
      if (sessionInfo) {
        setSessionInfo({ ...sessionInfo, status: 'running' });
      }
    } catch (err) {
      console.warn('Failed to send prompt:', err);
    }
  };

  const handleAbort = async () => {
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
  };

  const handlePermissionDecision = useCallback(
    async (permId: string, decision: PermissionDecision) => {
      if (!activeAsid) return;
      await replyAgentPermission(sessionId, activeAsid, permId, decision);
      setPermissions((prev) => prev.filter((p) => p.id !== permId));
    },
    [activeAsid, sessionId]
  );

  const handleFormSubmit = useCallback(
    async (formId: string, answers: Record<string, unknown>) => {
      if (!activeAsid) return;
      await replyAgentForm(sessionId, activeAsid, formId, answers);
      setForms((prev) => prev.filter((f) => f.id !== formId));
    },
    [activeAsid, sessionId]
  );

  const handleCreateNewSession = useCallback(async () => {
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
      setPermissions([]);
      setForms([]);
      setLastSeq(0);
      refreshSessions();
    } catch (err) {
      console.warn('Failed to create session:', err);
    }
  }, [sessionId, selectedAgent, selectedModel, activeDirectory, sessionInfo, t, refreshSessions]);

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
        setPermissions([]);
        setForms([]);
        setLastSeq(0);
        refreshSessions();
      } catch (err) {
        console.warn('Failed to switch workspace session:', err);
      }
    },
    [sessionId, selectedAgent, selectedModel, t, refreshSessions]
  );

  const renderTimelineItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<TimelineItem>) => {
      if (item.role === 'user') {
        const text = item.part.type === 'text' ? item.part.text : '';
        const attachments = item.attachments ?? [];
        return (
          <View key={item.id} style={styles.userBubbleRow}>
            <Pressable
              testID={`user-bubble-${item.id}`}
              onLongPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setMessageActionItem(item);
              }}
              delayLongPress={260}
              style={[
                styles.userBubble,
                {
                  backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.16)),
                  borderColor: withAlpha(theme.colors.primary, 0.35),
                },
              ]}>
              {/* Attachment Preview Chips / Images */}
              {attachments.length > 0 ? (
                <View style={styles.bubbleAttachmentsGrid}>
                  {attachments.map((att, attIdx) => {
                    if (isImageAttachment(att)) {
                      return (
                        <PressableScale
                          key={`${att}-${attIdx}`}
                          onPress={() => setPreviewImageUri(att)}
                          style={styles.bubbleImageWrapper}>
                          <Image
                            source={{ uri: att }}
                            style={styles.bubbleImageThumbnail}
                            contentFit="cover"
                            transition={DURATION.short}
                          />
                        </PressableScale>
                      );
                    }
                    const fileName = att.split('/').filter(Boolean).pop() || t`Attachment`;
                    return (
                      <View
                        key={`${att}-${attIdx}`}
                        style={[
                          styles.bubbleFileChip,
                          {
                            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                            borderColor: theme.colors.border,
                          },
                        ]}>
                        <FileText size={13} color={theme.colors.primary} />
                        <Text
                          variant="caption"
                          color={theme.colors.text}
                          numberOfLines={1}
                          style={styles.bubbleFileName}>
                          {fileName}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {text ? (
                <Text selectable variant="bodySmall" color={theme.colors.text}>
                  {text}
                </Text>
              ) : null}

              <PressableScale
                testID={`user-bubble-more-${item.id}`}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setMessageActionItem(item);
                }}
                accessibilityLabel={t`Message options`}
                style={styles.userBubbleMoreBtn}>
                <MoreHorizontal size={13} color={theme.colors.textMuted} />
              </PressableScale>
            </Pressable>
          </View>
        );
      }

      // Assistant or System item
      switch (item.part.type) {
        case 'text': {
          const prevItem = index > 0 ? timeline[index - 1] : undefined;
          if (prevItem && prevItem.part.type === 'tool') {
            const cleanText = item.part.text
              .replace(/^```[\w]*\n/, '')
              .replace(/\n```$/, '')
              .replace(/Command exited with code \d+\.?/gi, '')
              .trim();
            const cleanOutput = (typeof prevItem.part.output === 'string' ? prevItem.part.output : '')
              .replace(/Command exited with code \d+\.?/gi, '')
              .trim();
            if (
              !cleanText ||
              cleanText === cleanOutput ||
              (cleanOutput && cleanText.includes(cleanOutput)) ||
              (cleanOutput && cleanOutput.includes(cleanText))
            ) {
              return null;
            }
          }

          return (
            <View
              key={item.id}
              style={[
                styles.assistantTextRow,
                {
                  backgroundColor: surfaceBackground(theme.colors.surface),
                  borderColor: theme.colors.border,
                },
              ]}>
              <EnrichedMarkdownText
                flavor="commonmark"
                markdown={item.part.text}
                markdownStyle={markdownStyle}
                containerStyle={styles.markdownContainer}
                selectable
                selectionColor={theme.colors.primary}
                selectionHandleColor={theme.colors.primary}
                streamingAnimation={false}
                textBreakStrategy="simple"
                md4cFlags={{ latexMath: true }}
                onLinkPress={({ url }) => {
                  if (isSafeExternalLink(url)) void Linking.openURL(url);
                }}
              />
            </View>
          );
        }

        case 'reasoning':
          if (!showReasoning) return null;
          return (
            <View key={item.id} style={styles.partRow}>
              <AgentReasoningBlock text={item.part.text} durationMs={item.part.duration_ms} />
            </View>
          );

        case 'todo':
          return (
            <View key={item.id} style={styles.partRow}>
              <AgentTodoBlock items={item.part.items} />
            </View>
          );

        case 'tool':
          return (
            <View key={item.id} style={styles.partRow}>
              <EmbeddedTerminalToolBlock
                toolId={item.part.id}
                toolName={item.part.name}
                input={item.part.input}
                output={item.part.output}
                status={item.part.status}
              />
            </View>
          );

        case 'status':
          return (
            <View key={item.id} style={styles.statusRow}>
              <Text variant="caption" color={theme.colors.textSubtle} style={styles.statusText}>
                • {item.part.text}
              </Text>
            </View>
          );

        default:
          return null;
      }
    },
    [markdownStyle, showReasoning, surfaceBackground, theme.colors, timeline, t]
  );

  const isRunning = sessionInfo?.status === 'running';

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

  const displayWorkspaceName =
    activeProject?.name ||
    (activeDirectory ? activeDirectory.split('/').filter(Boolean).pop() : undefined) ||
    t`Workspace`;
  const displayWorkspacePath = activeDirectory || activeProject?.canonical || '~/';

  const listHeader = useMemo(() => {
    return (
      <View style={styles.headerPillRow}>
        <PressableScale
          testID="agent-workspace-pill"
          onPress={() => setWorkspaceSheetVisible(true)}
          accessibilityLabel={t`Switch workspace: ${displayWorkspaceName}`}
          style={[
            styles.workspacePill,
            {
              backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
              borderColor: theme.colors.border,
            },
          ]}>
          <FolderGit2 size={13} color={theme.colors.primary} />
          <Text variant="caption" weight="bold" color={theme.colors.text} numberOfLines={1}>
            {displayWorkspaceName}
          </Text>
          <Text
            variant="caption"
            color={theme.colors.textSubtle}
            numberOfLines={1}
            style={styles.workspacePillPath}>
            {displayWorkspacePath}
          </Text>
          <ChevronDown size={12} color={theme.colors.textMuted} />
        </PressableScale>
      </View>
    );
  }, [displayWorkspaceName, displayWorkspacePath, surfaceBackground, theme.colors, t]);

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
          <View
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
            <Bot size={44} color={theme.colors.primary} />
            <Text variant="bodySmall" color={theme.colors.text} style={styles.emptyTitle}>
              <Trans>Welcome to OpenCode Agent</Trans>
            </Text>
            <Text variant="caption" color={theme.colors.textMuted} style={styles.emptySubtitle}>
              <Trans>Ask questions, inspect files, or run commands in your workspace.</Trans>
            </Text>
            <PressableScale
              onPress={handleCreateNewSession}
              style={[
                styles.emptyNewBtn,
                { backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.14)) },
              ]}>
              <PlusCircle size={14} color={theme.colors.primary} />
              <Text variant="caption" color={theme.colors.primary} style={styles.emptyNewBtnText}>
                <Trans>New Session</Trans>
              </Text>
            </PressableScale>
          </View>
        </View>
      ) : (
        <LegendList<TimelineItem>
          ref={listRef}
          data={timeline}
          keyExtractor={(item) => item.id}
          renderItem={renderTimelineItem}
          recycleItems={false}
          estimatedItemSize={70}
          maintainScrollAtEnd={true}
          maintainScrollAtEndThreshold={0.1}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          style={styles.timelineScroll}
          contentContainerStyle={[
            styles.timelineContent,
            { paddingTop: topInset + 20, paddingBottom: bottomInset + 185 },
          ]}
        />
      )}

      {/* Floating Glass Composer at Bottom */}
      <AgentComposer
        running={isRunning}
        sessions={sessions}
        availableAgents={availableAgents}
        skills={skills}
        sessionId={sessionId}
        activeAsid={activeAsid}
        selectedAgent={selectedAgent}
        hasDiffs={hasDiffs}
        bottomInset={bottomInset}
        tasks={activeTodos}
        tokens={activeTokens}
        cost={sessionInfo?.cost}
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

      {/* Message Action Sheet */}
      {messageActionItem ? (
        <Modal
          visible={Boolean(messageActionItem)}
          transparent
          animationType="fade"
          onRequestClose={() => setMessageActionItem(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setMessageActionItem(null)}>
            <Pressable
              testID="message-action-sheet"
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.actionSheetContent,
                { backgroundColor: surfaceBackground(theme.colors.surface) },
              ]}>
              <View style={styles.modalHandle} />
              <Text variant="caption" weight="bold" color={theme.colors.textMuted} style={styles.actionSheetTitle}>
                <Trans>Message Actions</Trans>
              </Text>

              {/* 1. Copy */}
              <PressableScale
                onPress={async () => {
                  const copyText =
                    messageActionItem.part.type === 'text' ? messageActionItem.part.text : '';
                  await Clipboard.setStringAsync(copyText);
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  showToast({
                    variant: 'info',
                    title: t`Copied`,
                    message: t`Message copied to clipboard`,
                  });
                  setMessageActionItem(null);
                }}
                style={[styles.actionSheetRow, { borderBottomColor: theme.colors.border }]}>
                <Copy size={16} color={theme.colors.text} />
                <Text variant="bodySmall" color={theme.colors.text} style={styles.actionSheetRowText}>
                  <Trans>Copy Text</Trans>
                </Text>
              </PressableScale>

              {/* 2. Edit & Reprompt */}
              <PressableScale
                onPress={() => {
                  const repromptText =
                    messageActionItem.part.type === 'text' ? messageActionItem.part.text : '';
                  injectDraftRef.current?.(repromptText);
                  setMessageActionItem(null);
                }}
                style={[styles.actionSheetRow, { borderBottomColor: theme.colors.border }]}>
                <Edit3 size={16} color={theme.colors.primary} />
                <Text variant="bodySmall" color={theme.colors.primary} style={styles.actionSheetRowText}>
                  <Trans>Edit & Reprompt</Trans>
                </Text>
              </PressableScale>

              {/* 3. Revert to here */}
              {activeAsid && messageActionItem.message_id ? (
                <PressableScale
                  onPress={() => {
                    const target = messageActionItem;
                    setMessageActionItem(null);
                    setConfirmRevertItem(target);
                  }}
                  style={styles.actionSheetRow}>
                  <RotateCcw size={16} color={theme.colors.danger} />
                  <Text variant="bodySmall" color={theme.colors.danger} style={styles.actionSheetRowText}>
                    <Trans>Revert Session to Here</Trans>
                  </Text>
                </PressableScale>
              ) : null}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* Revert Confirmation Modal */}
      {confirmRevertItem ? (
        <Modal
          visible={Boolean(confirmRevertItem)}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirmRevertItem(null)}>
          <Pressable style={styles.modalBackdropCenter} onPress={() => setConfirmRevertItem(null)}>
            <Pressable
              testID="confirm-revert-modal"
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.confirmModalCard,
                {
                  backgroundColor: surfaceBackground(theme.colors.surface),
                  borderColor: theme.colors.border,
                },
              ]}>
              <View
                style={[
                  styles.confirmModalIconWrap,
                  { backgroundColor: withAlpha(theme.colors.danger, 0.15) },
                ]}>
                <RotateCcw size={24} color={theme.colors.danger} />
              </View>
              <Text variant="body" weight="bold" color={theme.colors.text} style={styles.confirmModalTitle}>
                <Trans>Revert Session & Workspace?</Trans>
              </Text>
              <Text variant="caption" color={theme.colors.textMuted} style={styles.confirmModalBody}>
                <Trans>
                  Reverting to this checkpoint will roll back all subsequent turns and undo code modifications in the workspace.
                </Trans>
              </Text>
              <View style={styles.confirmModalActions}>
                <PressableScale
                  onPress={() => setConfirmRevertItem(null)}
                  style={[
                    styles.confirmBtn,
                    { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
                  ]}>
                  <Text variant="caption" weight="medium" color={theme.colors.text}>
                    <Trans>Cancel</Trans>
                  </Text>
                </PressableScale>
                <PressableScale
                  onPress={async () => {
                    const itemToRevert = confirmRevertItem;
                    setConfirmRevertItem(null);
                    if (!activeAsid || !itemToRevert.message_id) return;
                    try {
                      await revertAgentSession(sessionId, activeAsid, itemToRevert.message_id);
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      showToast({
                        variant: 'info',
                        title: t`Session Reverted`,
                        message: t`Rolled back to message checkpoint.`,
                      });
                      await loadSnapshot();
                    } catch (err) {
                      showToast({
                        variant: 'danger',
                        title: t`Revert Failed`,
                        message: err instanceof Error ? err.message : String(err),
                      });
                    }
                  }}
                  style={[styles.confirmBtn, { backgroundColor: theme.colors.danger }]}>
                  <Text variant="caption" weight="bold" color="#fff">
                    <Trans>Confirm Revert</Trans>
                  </Text>
                </PressableScale>
              </View>
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
  emptyNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
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
  userBubbleMoreBtn: {
    alignSelf: 'flex-end',
    marginTop: 4,
    padding: 2,
    opacity: 0.7,
  },
  modalBackdropCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  actionSheetContent: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    paddingTop: 10,
    paddingBottom: 36,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionSheetTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginHorizontal: 8,
  },
  actionSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionSheetRowText: {
    fontSize: 14,
    fontWeight: '500',
  },
  confirmModalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    borderCurve: 'continuous',
    padding: 22,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  confirmModalIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  confirmModalTitle: {
    fontSize: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmModalBody: {
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  confirmModalActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
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
