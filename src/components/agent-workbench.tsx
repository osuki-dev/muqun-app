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
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Bot, PlusCircle, X } from 'lucide-react-native';
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
  type AgentSessionInfo,
  type TimelineItem,
  type PermissionRequest,
  type FormRequest,
  type ModelRef,
  type PermissionDecision,
  type AgentInfo,
  type SkillInfo,
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
import { AgentComposer } from './agent-composer';

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
  const theme = useThemeTokens();
  const { t } = useLingui();
  const surfaceBackground = useSurfaceBackground();
  const markdownStyle = usePaneChatMarkdownStyle();
  const listRef = useRef<LegendListRef>(null);

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

  // Sheets
  const [modelSheetVisible, setModelSheetVisible] = useState(false);
  const [modeSheetVisible, setModeSheetVisible] = useState(false);
  const [diffSheetVisible, setDiffSheetVisible] = useState(false);
  const [sessionsSheetVisible, setSessionsSheetVisible] = useState(false);
  const [tasksModalVisible, setTasksModalVisible] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelRef | undefined>(undefined);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>('build');
  const [skills, setSkills] = useState<SkillInfo[]>([]);

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

  // Poll for incremental events when session is active/running
  useEffect(() => {
    if (!activeAsid) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    const poll = async () => {
      try {
        const delta = await getAgentTimelineDelta(sessionId, activeAsid, lastSeq);
        if (!mounted) return;
        if (delta.items && delta.items.length > 0) {
          setTimeline((prev) => {
            const next = [...prev];
            const indexMap = new Map(next.map((it, idx) => [it.id, idx]));
            for (const item of delta.items!) {
              if (indexMap.has(item.id)) {
                next[indexMap.get(item.id)!] = item;
              } else {
                next.push(item);
                indexMap.set(item.id, next.length - 1);
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

    timer = setInterval(poll, 800);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [sessionId, activeAsid, lastSeq]);

  const handleSelectModel = (model: ModelRef) => {
    setSelectedModel(model);
    setModelSheetVisible(false);
    onModelChange?.(model);
    if (activeAsid) {
      void switchAgentModel(sessionId, activeAsid, model).catch((err) => {
        console.warn('Failed to switch agent model:', err);
      });
    }
  };

  const handleSendPrompt = async (text: string, attachments?: string[]) => {
    let currentAsid = activeAsid;
    if (!currentAsid) {
      try {
        const created = await createAgentSession(sessionId, {
          title: text.slice(0, 30) || t`New Session`,
          agent: selectedAgent,
          model: selectedModel,
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
      id: `usr_${Date.now()}`,
      message_id: `msg_${Date.now()}`,
      seq: lastSeq + 1,
      updated_ms: Date.now(),
      role: 'user',
      part: { type: 'text', text },
    };
    setTimeline((prev) => [...prev, tempUserItem]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      await sendAgentPrompt(sessionId, currentAsid, {
        text,
        model: selectedModel,
        attachments,
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
  }, [sessionId, selectedAgent, selectedModel, t, refreshSessions]);

  const renderTimelineItem = useCallback(
    ({ item }: LegendListRenderItemProps<TimelineItem>) => {
      if (item.role === 'user') {
        const text = item.part.type === 'text' ? item.part.text : '';
        return (
          <View key={item.id} style={styles.userBubbleRow}>
            <View
              style={[
                styles.userBubble,
                {
                  backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.16)),
                  borderColor: withAlpha(theme.colors.primary, 0.35),
                },
              ]}>
              <Text selectable variant="bodySmall" color={theme.colors.text}>
                {text}
              </Text>
            </View>
          </View>
        );
      }

      // Assistant or System item
      switch (item.part.type) {
        case 'text':
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

        case 'reasoning':
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
    [markdownStyle, surfaceBackground, theme.colors]
  );

  const listFooter = useMemo(() => {
    if (permissions.length === 0 && forms.length === 0) return null;
    return (
      <View style={styles.footerContainer}>
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
  }, [permissions, forms, handlePermissionDecision, handleFormSubmit]);

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

  const isRunning = sessionInfo?.status === 'running';

  return (
    <View style={styles.root}>
      {/* Main Content Stream */}
      {loading ? (
        <View style={[styles.centerContainer, { paddingTop: topInset }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text variant="caption" color={theme.colors.textMuted} style={styles.loadingText}>
            <Trans>Connecting to agent engine…</Trans>
          </Text>
        </View>
      ) : timeline.length === 0 && permissions.length === 0 && forms.length === 0 ? (
        <View
          style={[
            styles.emptyScrollWrapper,
            { paddingTop: topInset + 14, paddingBottom: bottomInset + 185 },
          ]}>
          <View
            style={[
              styles.emptyContainer,
              {
                backgroundColor: surfaceBackground(theme.colors.surface),
                borderColor: theme.colors.border,
              },
            ]}>
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
          ListFooterComponent={listFooter}
          style={styles.timelineScroll}
          contentContainerStyle={[
            styles.timelineContent,
            { paddingTop: topInset + 14, paddingBottom: bottomInset + 185 },
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
        onRefresh={loadSnapshot}
      />

      {/* All Sessions Sheet (roots + subagents, search, select) */}
      <AgentSessionsSheet
        visible={sessionsSheetVisible}
        sessions={sessions}
        activeAsid={activeAsid}
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
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    maxWidth: '100%',
  },
  markdownContainer: {
    flex: 1,
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
});
