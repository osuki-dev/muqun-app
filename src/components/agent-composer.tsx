import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TextInputSelectionChangeEventData,
  View,
} from 'react-native';
import { Spinner, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Bot,
  CheckSquare,
  ChevronDown,
  Cpu,
  GitCommit,
  GitFork,
  Inbox,
  Layers,
  Paperclip,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

import { PressableScale } from '@/components/pressable-scale';
import { TerminalComposer, composerStyles } from '@/components/terminal-composer';
import { AttachmentMenu } from '@/components/attachment-menu';
import { AgentModeMenu } from '@/components/agent-mode-menu';
import { AttachmentStrip } from '@/components/attachment-strip';
import { GlassChrome } from '@/components/glass-chrome';
import { EdgeFade } from '@/components/edge-fade';
import { FileMentionPanel } from '@/components/file-mention-panel';
import { ComposerPopup } from '@/components/composer-popup';
import { useComposerPopup } from '@/hooks/use-composer-popup';
import { slashCommandTrigger, type PaneSlashCommand } from '@/lib/pane-composer';
import {
  findFileMentionTrigger,
  insertFileMention,
  FILE_MENTION_LIMIT,
  type FileMentionHit,
  type FileMentionTrigger,
} from '@/lib/file-mentions';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useAttachmentUploads } from '@/hooks/use-attachment-uploads';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { pickAttachments, describePickerFailure, type AttachmentSource } from '@/lib/attachments';
import { fadeIn, fadeOut, fadeOutDown } from '@/lib/motion';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import {
  formatModelName,
  listAgentFiles,
  type AgentInfo,
  type AgentProject,
  type AgentSessionInfo,
  type ModelRef,
  type SkillInfo,
  type TodoItem,
  type TokensUsage,
} from '@/lib/agent-session';

function resolveSessionTitle(session: AgentSessionInfo | undefined, fallback: string): string {
  if (!session) return fallback;
  const raw = session.title;
  if (!raw || raw.startsWith('ses_') || raw === session.asid) {
    return fallback;
  }
  return raw;
}

export interface AgentComposerProps {
  running: boolean;
  sessions?: AgentSessionInfo[];
  availableAgents?: AgentInfo[];
  skills?: SkillInfo[];
  sessionId?: string;
  activeAsid?: string;
  activeDirectory?: string;
  activeProject?: AgentProject;
  selectedAgent?: string;
  selectedModel?: ModelRef;
  hasDiffs?: boolean;
  bottomInset?: number;
  tasks?: TodoItem[];
  tokens?: TokensUsage;
  cost?: number;
  sessionTitle?: string;
  onSend: (text: string, attachments?: string[], delivery?: 'steer' | 'queue') => Promise<void>;
  onAbort: () => Promise<void>;
  onSelectSession?: (asid: string) => void;
  onSelectAgentMode?: (agent: string) => void;
  onCreateNewSession?: () => void;
  onOpenModelSheet?: () => void;
  onOpenModeSheet?: () => void;
  onOpenDiffSheet: () => void;
  disabled?: boolean;
  onOpenSessionsSheet?: () => void;
  onOpenTasksSheet?: () => void;
  onPressTokens?: () => void;
  onRefresh?: () => void;
  injectDraftRef?: React.MutableRefObject<((text: string) => void) | null>;
}

export const AgentComposer = memo(function AgentComposer({
  running,
  sessions = [],
  availableAgents: availableAgentsProp,
  skills = [],
  sessionId,
  activeAsid,
  activeDirectory,
  activeProject,
  selectedAgent,
  selectedModel,
  hasDiffs = false,
  bottomInset = 0,
  tasks,
  tokens,
  cost,
  sessionTitle,
  onSend,
  onAbort,
  onSelectSession,
  onSelectAgentMode,
  onCreateNewSession,
  disabled,
  onOpenModelSheet,
  onOpenModeSheet,
  onOpenDiffSheet,
  onOpenSessionsSheet,
  onOpenTasksSheet,
  onPressTokens,
  onRefresh,
  injectDraftRef,
}: AgentComposerProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const surfaceBackground = useSurfaceBackground();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<'steer' | 'queue'>('steer');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const tokenDisplayStr = useMemo(() => {
    if (!tokens) return null;
    const total = tokens.input + tokens.output + (tokens.reasoning ?? 0);
    if (total <= 0) return null;
    let tokStr = `${total}`;
    if (total >= 1_000_000) tokStr = `${(total / 1_000_000).toFixed(1)}M`;
    else if (total >= 1_000) tokStr = `${(total / 1_000).toFixed(1)}k`;

    const costStr =
      cost === undefined || cost === null || cost === 0 ? t`Free` : `$${cost.toFixed(2)}`;
    return `${tokStr} • ${costStr}`;
  }, [tokens, cost, t]);

  const modelDisplayName = useMemo(() => formatModelName(selectedModel), [selectedModel]);

  const inputRef = useRef<TextInput>(null);
  const [caret, setCaret] = useState<number | undefined>(undefined);
  const [mentionHits, setMentionHits] = useState<FileMentionHit[]>([]);

  const chromeText = theme.colors.text;
  const chromeGlass = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);

  const record = useGatewayConnectionStore((state) => state.record);
  const attachmentUploads = useAttachmentUploads(record);

  // Slash commands and skills catalog
  const builtinCommands: PaneSlashCommand[] = useMemo(
    () => [
      {
        name: '/init',
        description: t`Analyze project and initialize AGENTS.md`,
        argsHint: '',
        source: 'builtin',
      },
      {
        name: '/compact',
        description: t`Compact session history to save context`,
        argsHint: '',
        source: 'builtin',
      },
      {
        name: '/clear',
        description: t`Clear context and start fresh`,
        argsHint: '',
        source: 'builtin',
      },
      {
        name: '/undo',
        description: t`Undo last message or action`,
        argsHint: '',
        source: 'builtin',
      },
      { name: '/redo', description: t`Redo last undone step`, argsHint: '', source: 'builtin' },
      {
        name: '/review',
        description: t`Review workspace changes`,
        argsHint: '',
        source: 'builtin',
      },
      { name: '/mode', description: t`Switch agent mode`, argsHint: '', source: 'builtin' },
      { name: '/model', description: t`Switch language model`, argsHint: '', source: 'builtin' },
      { name: '/help', description: t`Show command help`, argsHint: '', source: 'builtin' },
    ],
    [t]
  );

  const skillCommands: PaneSlashCommand[] = useMemo(
    () =>
      (skills ?? []).map((s) => ({
        name: `/${s.id}`,
        description: s.description || s.name,
        argsHint: '',
        source: 'workspace' as const,
      })),
    [skills]
  );

  const slashCatalog = useMemo(
    () => [...builtinCommands, ...skillCommands],
    [builtinCommands, skillCommands]
  );
  const slashTrigger = useMemo(() => slashCommandTrigger(slashCatalog), [slashCatalog]);

  const slashPopup = useComposerPopup({
    draft: text,
    onDraftChange: setText,
    trigger: slashTrigger,
  });

  // File mentions (@) trigger
  const effectiveCaret = caret ?? text.length;
  const mentionTrigger = useMemo<FileMentionTrigger | null>(
    () => findFileMentionTrigger(text, effectiveCaret),
    [effectiveCaret, text]
  );
  const mentionQuery = mentionTrigger?.query ?? null;

  useEffect(() => {
    if (mentionQuery === null) {
      setMentionHits([]);
      return;
    }
    let active = true;
    listAgentFiles(sessionId, activeAsid, mentionQuery, FILE_MENTION_LIMIT)
      .then((hits) => {
        if (active) setMentionHits(hits);
      })
      .catch(() => {
        if (active) setMentionHits([]);
      });
    return () => {
      active = false;
    };
  }, [mentionQuery, sessionId, activeAsid]);

  const chooseMention = useCallback(
    (hit: FileMentionHit) => {
      if (!mentionTrigger) return;
      const next = insertFileMention(text, mentionTrigger, hit.path);
      setText(next.text);
      setCaret(next.caret);
      setMentionHits([]);
    },
    [text, mentionTrigger]
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const next = event.nativeEvent.selection.start;
      setCaret(next);
      slashPopup.inputProps.onSelectionChange(event);
    },
    [slashPopup.inputProps]
  );

  const chooseAttachmentSource = useCallback(
    (source: AttachmentSource) => {
      setAttachmentMenuOpen(false);
      const picker = attachmentUploads.capturePicker();
      if (!picker.isCurrent()) return;
      void pickAttachments(source)
        .then(picker.addFiles)
        .catch((failure: unknown) => {
          if (!picker.isCurrent()) return;
          showToast({
            variant: 'danger',
            title: t`Could not add a file`,
            message: describePickerFailure(source, failure),
          });
        });
    },
    [attachmentUploads, showToast, t]
  );

  useEffect(() => {
    if (injectDraftRef) {
      injectDraftRef.current = (draftText: string) => {
        setText(draftText);
        setTimeout(() => inputRef.current?.focus(), 50);
      };
    }
  }, [injectDraftRef]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    const hasAttachments = attachmentUploads.attachments.length > 0;
    if ((!trimmed && !hasAttachments) || sending) return;

    setSending(true);
    try {
      let uploadedFilePaths: string[] = [];
      if (hasAttachments) {
        const paths = await attachmentUploads.awaitUploads();
        if (!paths) {
          showToast({
            variant: 'danger',
            title: t`Upload failed`,
            message: t`Please retry or remove failed attachments.`,
          });
          return;
        }
        uploadedFilePaths = paths;
      }
      await onSend(
        trimmed,
        uploadedFilePaths.length > 0 ? uploadedFilePaths : undefined,
        running ? deliveryMode : undefined
      );
      setText('');
      attachmentUploads.clearAttachments();
    } finally {
      setSending(false);
    }
  }, [text, attachmentUploads, sending, onSend, showToast, t, running, deliveryMode]);

  // Resolve available agents (workspace agents + defaults)
  const availableAgents =
    availableAgentsProp && availableAgentsProp.length > 0
      ? availableAgentsProp
      : [
          { id: 'build', name: 'build', description: t`The default agent. Executes tools.` },
          {
            id: 'general',
            name: 'general',
            description: t`General-purpose agent for researching complex tasks.`,
          },
          {
            id: 'explore',
            name: 'explore',
            description: t`Fast agent specialized for exploring codebases.`,
          },
        ];

  // Resolve sessions belonging strictly to the current workspace (root sessions)
  const workspaceSessions = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const roots = sessions.filter((s) => !s.parent_id);
    if (!activeDirectory && !activeProject) return [];

    const normActive = activeDirectory?.replace(/\/+$/, '');
    const normProj = activeProject?.canonical?.replace(/\/+$/, '');
    const projId = activeProject?.id;

    return roots.filter((s) => {
      // 1. If project_id matches activeProject
      if (projId && s.project_id && s.project_id === projId) return true;
      if (!s.directory) return false;
      const normDir = s.directory.replace(/\/+$/, '');
      // 2. Match activeDirectory exactly or as child directory
      if (normActive && (normDir === normActive || normDir.startsWith(`${normActive}/`)))
        return true;
      // 3. Match project canonical directory exactly or as child directory
      if (normProj && (normDir === normProj || normDir.startsWith(`${normProj}/`))) return true;
      return false;
    });
  }, [sessions, activeDirectory, activeProject]);

  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardOffset.value }],
  }));

  return (
    <Animated.View style={[styles.dockOuter, composerKeyboardStyle]}>
      <EdgeFade edge="bottom" color={theme.colors.background} style={styles.composerFade} />

      {/* Dismiss backdrop for popups */}
      {attachmentMenuOpen || modeMenuOpen ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            setAttachmentMenuOpen(false);
            setModeMenuOpen(false);
          }}
        />
      ) : null}

      {/* Attachment source popup */}
      {attachmentMenuOpen ? (
        <View style={styles.popupWrapper}>
          <AttachmentMenu onSelect={chooseAttachmentSource} textColor={chromeText} />
        </View>
      ) : null}

      {/* Agent mode popup */}
      {modeMenuOpen ? (
        <View style={styles.popupWrapper}>
          <AgentModeMenu
            agents={availableAgents}
            selectedAgent={selectedAgent}
            onSelectAgent={(agId) => {
              setModeMenuOpen(false);
              onSelectAgentMode?.(agId);
            }}
            textColor={chromeText}
          />
        </View>
      ) : null}

      {/* File mention (@) floating list */}
      {mentionTrigger && mentionHits.length > 0 ? (
        <View style={styles.composerFloatingContent}>
          <FileMentionPanel
            hits={mentionHits}
            query={mentionTrigger.query}
            onSelect={chooseMention}
          />
        </View>
      ) : null}

      {/* Slash command and skills (/) floating list */}
      {slashPopup.open ? (
        <View style={styles.composerPopup}>
          <ComposerPopup
            rows={slashPopup.rows}
            onPick={slashPopup.pick}
            testIDPrefix="slash-command"
          />
        </View>
      ) : null}

      <GlassChrome surface="composer" style={styles.composerDock}>
        <View style={[styles.composerInner, { paddingBottom: Math.max(10, bottomInset + 6) }]}>
          {/* Row 1: Workspace Sessions Horizontal Strip */}
          {workspaceSessions.length > 0 ? (
            <FlatList
              horizontal
              data={workspaceSessions}
              keyExtractor={(s) => s.asid}
              extraData={activeAsid}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sessionStripContent}
              style={styles.sessionStripViewport}
              renderItem={({ item: s }) => {
                const isSessActive = s.asid === activeAsid;
                const agentName = s.agent || selectedAgent || 'build';
                const displayTitle = resolveSessionTitle(s, t`New Session`);
                const sessSubagents = sessions.filter((sub) => sub.parent_id === s.asid);

                return (
                  <Fragment>
                    <PressableScale
                      testID={`agent-composer-session-chip-${s.asid}`}
                      onPress={() => {
                        if (s.asid !== activeAsid) {
                          onSelectSession?.(s.asid);
                        }
                      }}
                      accessibilityLabel={`${agentName}: ${displayTitle}`}
                      style={[
                        styles.sessionChip,
                        isSessActive
                          ? { backgroundColor: theme.colors.primary }
                          : {
                              backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                              borderColor: surfaceBackground(theme.colors.border),
                              borderWidth: StyleSheet.hairlineWidth,
                            },
                      ]}>
                      <Bot size={13} color={isSessActive ? '#fff' : theme.colors.primary} />
                      <Text
                        variant="caption"
                        weight="bold"
                        color={isSessActive ? '#fff' : theme.colors.primary}
                        style={styles.sessionChipAgentBadge}>
                        {agentName}
                      </Text>
                      <Text
                        variant="caption"
                        color={isSessActive ? 'rgba(255,255,255,0.6)' : theme.colors.textMuted}
                        style={styles.sessionChipDot}>
                        •
                      </Text>
                      <Text
                        variant="caption"
                        weight="medium"
                        numberOfLines={1}
                        color={isSessActive ? 'rgba(255,255,255,0.95)' : theme.colors.text}
                        style={styles.sessionChipTitle}>
                        {displayTitle}
                      </Text>
                    </PressableScale>

                    {/* Subagents of the active session */}
                    {isSessActive &&
                      sessSubagents.map((sub) => {
                        const isSubActive = sub.asid === activeAsid;
                        const subAgentName = sub.agent || 'subagent';
                        const subDisplayTitle = resolveSessionTitle(sub, subAgentName);
                        return (
                          <PressableScale
                            key={sub.asid}
                            onPress={() => onSelectSession?.(sub.asid)}
                            accessibilityLabel={subDisplayTitle}
                            style={[
                              styles.sessionChip,
                              isSubActive
                                ? { backgroundColor: theme.colors.primary }
                                : {
                                    backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                                    borderColor: surfaceBackground(theme.colors.border),
                                    borderWidth: StyleSheet.hairlineWidth,
                                  },
                            ]}>
                            <GitFork
                              size={13}
                              color={isSubActive ? '#fff' : theme.colors.primary}
                            />
                            <Text
                              variant="caption"
                              weight="bold"
                              color={isSubActive ? '#fff' : theme.colors.primary}
                              style={styles.sessionChipAgentBadge}>
                              {subAgentName}
                            </Text>
                            {subDisplayTitle !== subAgentName ? (
                              <>
                                <Text
                                  variant="caption"
                                  color={
                                    isSubActive ? 'rgba(255,255,255,0.6)' : theme.colors.textMuted
                                  }
                                  style={styles.sessionChipDot}>
                                  •
                                </Text>
                                <Text
                                  variant="caption"
                                  weight="medium"
                                  numberOfLines={1}
                                  color={
                                    isSessActive ? 'rgba(255,255,255,0.95)' : theme.colors.text
                                  }
                                  style={styles.sessionChipTitle}>
                                  {subDisplayTitle}
                                </Text>
                              </>
                            ) : null}
                          </PressableScale>
                        );
                      })}
                  </Fragment>
                );
              }}
            />
          ) : null}

          {/* Row 2: Function Keyboard / Toolbar (功能键盘) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionRowContent}
            style={styles.actionRowScroll}>
            {/* All Sessions Button (Icon-only) */}
            {onOpenSessionsSheet ? (
              <PressableScale
                testID="agent-composer-sessions-btn"
                onPress={onOpenSessionsSheet}
                accessibilityLabel={t`All Sessions`}
                style={[styles.actionBtn, { backgroundColor: surfaceBackground(chromeGlass) }]}>
                <Layers size={16} color={chromeText} />
              </PressableScale>
            ) : null}

            {/* Quick Agent Mode Popover Button */}
            <PressableScale
              testID="agent-composer-mode-btn"
              onPress={() => {
                setAttachmentMenuOpen(false);
                setModeMenuOpen(false);
                if (onOpenModeSheet) {
                  onOpenModeSheet();
                } else {
                  setModeMenuOpen((prev) => !prev);
                }
              }}
              accessibilityLabel={t`Select agent mode`}
              style={[
                styles.actionBtnWithLabel,
                modeMenuOpen && { borderColor: theme.colors.primary, borderWidth: 1 },
                { backgroundColor: surfaceBackground(chromeGlass) },
              ]}>
              <Sparkles size={14} color={theme.colors.primary} />
              <Text variant="caption" color={theme.colors.text} style={styles.actionBtnLabel}>
                {selectedAgent ?? 'build'}
              </Text>
            </PressableScale>

            {/* Quick Model Selector Button (placed right after agent mode, displayed in full) */}
            {onOpenModelSheet ? (
              <PressableScale
                testID="agent-composer-model-btn"
                onPress={onOpenModelSheet}
                accessibilityLabel={t`Select model: ${modelDisplayName}`}
                style={[
                  styles.actionBtnWithLabel,
                  { backgroundColor: surfaceBackground(chromeGlass) },
                ]}>
                <Text variant="caption" color={theme.colors.text} style={styles.actionBtnLabel}>
                  {modelDisplayName}
                </Text>
                <ChevronDown size={12} color={theme.colors.textMuted} />
              </PressableScale>
            ) : null}

            {/* OpenCode Tasks Button */}
            {onOpenTasksSheet || (tasks && tasks.length > 0) ? (
              <PressableScale
                testID="agent-composer-tasks-btn"
                onPress={onOpenTasksSheet}
                accessibilityLabel={t`Tasks progress`}
                style={[
                  styles.actionBtnWithLabel,
                  { backgroundColor: surfaceBackground(chromeGlass) },
                ]}>
                <CheckSquare
                  size={14}
                  color={
                    tasks && tasks.length > 0 && tasks.every((t) => t.done)
                      ? (theme.colors.success ?? '#22c55e')
                      : theme.colors.primary
                  }
                />
                <Text variant="caption" color={theme.colors.text} style={styles.actionBtnLabel}>
                  {tasks && tasks.length > 0
                    ? t`Tasks (${tasks.filter((t) => t.done).length}/${tasks.length})`
                    : t`Tasks`}
                </Text>
              </PressableScale>
            ) : null}

            {/* OpenCode Session Tokens & Cost Pill */}
            {tokenDisplayStr ? (
              <PressableScale
                testID="agent-composer-tokens-pill"
                onPress={() => {
                  if (onPressTokens) {
                    onPressTokens();
                  } else if (tokens) {
                    showToast({
                      variant: 'info',
                      title: t`Session Tokens`,
                      message: `Input: ${tokens.input.toLocaleString()} • Output: ${tokens.output.toLocaleString()}${tokens.reasoning ? ` • Reasoning: ${tokens.reasoning.toLocaleString()}` : ''}`,
                    });
                  }
                }}
                accessibilityLabel={t`Tokens usage and cost`}
                style={[
                  styles.actionBtnWithLabel,
                  { backgroundColor: surfaceBackground(chromeGlass) },
                ]}>
                <Cpu size={13} color={chromeText} />
                <Text
                  variant="caption"
                  color={theme.colors.textMuted}
                  style={styles.actionBtnLabel}>
                  {tokenDisplayStr}
                </Text>
              </PressableScale>
            ) : null}

            {/* VCS Diff Button: only rendered when hasDiffs is true */}
            {hasDiffs ? (
              <PressableScale
                onPress={onOpenDiffSheet}
                accessibilityLabel={t`View file changes`}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: withAlpha(theme.colors.primary, 0.18),
                  },
                ]}>
                <GitCommit size={15} color={theme.colors.primary} />
                <View style={[styles.diffIndicator, { backgroundColor: theme.colors.primary }]} />
              </PressableScale>
            ) : null}

            {running ? (
              <PressableScale
                testID="agent-composer-delivery-btn"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDeliveryMode((prev) => (prev === 'steer' ? 'queue' : 'steer'));
                }}
                accessibilityLabel={
                  deliveryMode === 'steer'
                    ? t`Delivery mode: Steer (real-time). Tap to switch to Queue.`
                    : t`Delivery mode: Queue. Tap to switch to Steer.`
                }
                style={[
                  styles.actionBtnWithLabel,
                  {
                    backgroundColor:
                      deliveryMode === 'steer'
                        ? withAlpha(theme.colors.warning, 0.2)
                        : withAlpha(theme.colors.primary, 0.2),
                    borderColor:
                      deliveryMode === 'steer'
                        ? withAlpha(theme.colors.warning, 0.5)
                        : withAlpha(theme.colors.primary, 0.5),
                    borderWidth: 1,
                  },
                ]}>
                {deliveryMode === 'steer' ? (
                  <>
                    <Zap size={13} color={theme.colors.warning} />
                    <Text
                      variant="caption"
                      weight="bold"
                      color={theme.colors.warning}
                      style={styles.actionBtnLabel}>
                      <Trans>Steer</Trans>
                    </Text>
                  </>
                ) : (
                  <>
                    <Inbox size={13} color={theme.colors.primary} />
                    <Text
                      variant="caption"
                      weight="bold"
                      color={theme.colors.primary}
                      style={styles.actionBtnLabel}>
                      <Trans>Queue</Trans>
                    </Text>
                  </>
                )}
              </PressableScale>
            ) : null}

            {running ? (
              <PressableScale
                onPress={onAbort}
                accessibilityLabel={t`Stop agent execution`}
                style={[
                  styles.actionBtnWithLabel,
                  styles.stopActionBtn,
                  { backgroundColor: theme.colors.danger },
                ]}>
                <Square size={12} color="#fff" />
                <Text variant="caption" color="#fff" style={styles.actionBtnLabel}>
                  <Trans>Stop</Trans>
                </Text>
              </PressableScale>
            ) : null}
          </ScrollView>

          {/* Attachment staged preview strip */}
          {attachmentUploads.attachments.length > 0 ? (
            <Animated.View
              entering={fadeIn('micro')}
              exiting={fadeOutDown('short')}
              style={styles.stripWrapper}>
              <AttachmentStrip
                attachments={attachmentUploads.attachments}
                onRemove={attachmentUploads.removeAttachment}
                onRetry={attachmentUploads.retryUpload}
                onPreview={() => {}}
                textColor={chromeText}
              />
            </Animated.View>
          ) : null}

          {/* Uploading wait banner */}
          {sending && attachmentUploads.uploading ? (
            <Animated.View
              entering={fadeIn('micro')}
              exiting={fadeOut('micro')}
              style={styles.uploadWait}>
              <Spinner size="sm" color={theme.colors.textMuted} />
              <Text variant="caption" color={theme.colors.textMuted}>
                <Trans>Waiting for uploads to finish…</Trans>
              </Text>
            </Animated.View>
          ) : null}

          {/* TerminalComposer reused for agent prompt */}
          <TerminalComposer
            inputRef={inputRef}
            leading={
              <PressableScale
                testID="agent-composer-attach"
                accessibilityLabel={
                  attachmentMenuOpen ? t`Close the attachment menu` : t`Attach a file`
                }
                disabled={sending || disabled}
                onPress={() => setAttachmentMenuOpen((open) => !open)}
                style={[
                  composerStyles.button,
                  { backgroundColor: surfaceBackground(chromeGlass) },
                  attachmentMenuOpen
                    ? { backgroundColor: surfaceBackground(theme.colors.primarySubtle) }
                    : null,
                  disabled ? { opacity: 0.5 } : null,
                ]}>
                <Paperclip
                  size={16}
                  color={attachmentMenuOpen ? theme.colors.primary : chromeText}
                />
              </PressableScale>
            }
            inputProps={{
              value: text,
              onChangeText: setText,
              placeholder: disabled
                ? t`OpenCode service offline`
                : t`Send a message, type / for commands, @ for files…`,
              editable: !sending && !disabled,
              testID: 'agent-composer-input',
              selection: slashPopup.inputProps.selection,
              onSelectionChange: handleSelectionChange,
              onKeyPress: slashPopup.inputProps.onKeyPress,
              onSubmitEditing: handleSend,
            }}
            send={{
              accessibilityLabel: running
                ? deliveryMode === 'steer'
                  ? t`Steer running agent`
                  : t`Queue message for agent`
                : t`Send message`,
              armed:
                (Boolean(text.trim()) || attachmentUploads.attachments.length > 0) &&
                !sending &&
                !disabled,
              sending,
              disabled:
                sending || disabled || (!text.trim() && attachmentUploads.attachments.length === 0),
              onPress: handleSend,
            }}
          />
        </View>
      </GlassChrome>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  dockOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  composerFade: {
    position: 'absolute',
    top: -36,
    left: 0,
    right: 0,
    height: 48,
    pointerEvents: 'none',
  },
  composerDock: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  composerInner: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  popupWrapper: {
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  composerFloatingContent: {
    width: '100%',
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  composerPopup: {
    width: '100%',
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  stripWrapper: {
    marginBottom: 6,
  },
  uploadWait: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  sessionStripViewport: {
    marginBottom: 6,
  },
  sessionStripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  sessionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  newSessionChip: {
    paddingHorizontal: 10,
    gap: 4,
  },
  sessionChipAgentBadge: {
    fontSize: 12,
    fontWeight: '700',
  },
  sessionChipDot: {
    fontSize: 10,
    opacity: 0.7,
  },
  sessionChipTitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionRowScroll: {
    marginBottom: 8,
  },
  actionRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 999,
    borderCurve: 'continuous',
    position: 'relative',
  },
  actionKeyBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  keyText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionBtnWithLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  actionBtnLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  stopActionBtn: {
    paddingHorizontal: 10,
  },
  diffIndicator: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
