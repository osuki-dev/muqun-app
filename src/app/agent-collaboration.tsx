import { Button, Input, KeyboardToolbar, Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  X,
} from 'lucide-react-native';
import { Keyboard, ScrollView, StyleSheet, Switch, View } from 'react-native';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import { PressableScale } from '@/components/pressable-scale';
import { useAgentCollaborationController } from '@/hooks/use-agent-collaboration';
import {
  canAssignToAgent,
  partitionCollaborationTasks,
  taskAgent,
  type CollaborationContext,
} from '@/lib/agent-collaboration';
import { useAgentCollaboration } from '@/stores/agent-collaboration';
import { AgentCommandSummary } from '@/components/agent-command-summary';
import { AgentReferenceEditor } from '@/components/agent-reference-editor';

export default function AgentCollaborationScreen() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const router = useRouter();
  const params = useLocalSearchParams<CollaborationContext>();
  const [showOtherProfiles, setShowOtherProfiles] = useState(false);
  const [choosingProfile, setChoosingProfile] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [management, setManagement] = useState<string | null>(null);
  const {
    command,
    references,
    originCwd,
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
    outputLoading,
    output,
    outputError,
    hasNewOutput,
    refreshOutput,
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
  } = useAgentCollaborationController(params);
  const muted = theme.colors.textMuted;
  const { current, history } = partitionCollaborationTasks(tasks, agents);
  const currentIds = new Set(current.map((task) => task.id));
  const ready = !loading && supported && connectionMatches && Boolean(checkedAt);
  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [form]);
  return (
    <>
      <Stack.Screen
        options={{ title: form ? t`Assign a task` : t`Agent collaboration`, gestureEnabled: !busy }}
      />
      <KeyboardAwareScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        bottomOffset={88}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: theme.colors.surface }}
        contentContainerStyle={styles.content}>
        <View style={styles.header}>
          {form ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Back to assigned tasks`}
              disabled={busy}
              onPress={() => {
                Keyboard.dismiss();
                setForm(false);
              }}
              style={styles.icon}>
              <ArrowLeft size={20} color={theme.colors.text} />
            </PressableScale>
          ) : null}
          <View style={styles.grow}>
            <Text variant="heading">{form ? t`Assign a task` : t`Agent collaboration`}</Text>
            {!form ? (
              <Text variant="caption" color={muted}>
                {t`Assignments on this device · current session`}
              </Text>
            ) : null}
          </View>
          <PressableScale
            testID="collaboration-close"
            accessibilityRole="button"
            accessibilityLabel={t`Close agent collaboration`}
            disabled={busy}
            onPress={() => router.back()}
            style={styles.icon}>
            <X size={20} color={theme.colors.text} />
          </PressableScale>
        </View>
        {!connectionMatches ? (
          <Text color={theme.colors.danger}>{t`Return to this server to continue.`}</Text>
        ) : null}
        {loading && connectionMatches ? <Spinner size="sm" /> : null}
        {error ? (
          <View style={styles.section}>
            <Text color={theme.colors.danger} variant="bodySmall">
              {error}
            </Text>
            <Button
              variant="secondary"
              onPress={() => setRefresh((value) => value + 1)}>{t`Refresh`}</Button>
          </View>
        ) : null}
        {!loading && requirement ? <Text color={muted}>{requirement}</Text> : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" variant="bodySmall" color={theme.colors.primary}>
            {notice}
          </Text>
        ) : null}
        {recoveryPane ? (
          <Button
            variant="secondary"
            onPress={() => openPane(recoveryPane)}>{t`Open terminal`}</Button>
        ) : null}
        {!form ? (
          <>
            <Button
              testID="collaboration-assign"
              disabled={!ready}
              onPress={() => {
                setForm(true);
                setNotice(null);
              }}>
              {t`Assign a task`}
            </Button>
            {tasks.length === 0 ? (
              <View style={styles.empty}>
                <Text variant="heading">{t`An extra pair of hands`}</Text>
                <Text
                  color={muted}
                  variant="bodySmall">{t`Ask another agent to review a change, investigate a bug, or run tests. Follow its status here while you keep working.`}</Text>
              </View>
            ) : null}
            {history.length > 0 ? (
              <Button
                testID="collaboration-history"
                variant="ghost"
                onPress={() => setShowHistory((value) => !value)}>
                {showHistory
                  ? t`Hide assignment history`
                  : t`Assignment history (${history.length})`}
              </Button>
            ) : null}
            {[...current, ...(showHistory ? history : [])].map((task) => {
              const index = tasks.indexOf(task);
              const historical = !currentIds.has(task.id);
              if (historical && !showHistory) return null;
              const agent = taskAgent(task, agents);
              const needsAttention =
                !historical && agent?.status === 'blocked' && Boolean(checkedAt);
              return (
                <View
                  key={task.id}
                  style={[
                    styles.card,
                    { borderColor: needsAttention ? theme.colors.warning : theme.colors.border },
                  ]}>
                  <View style={styles.row}>
                    <Text variant="bodySmall" style={styles.grow}>
                      {task.agentName}
                    </Text>
                    <Text variant="caption" color={needsAttention ? theme.colors.warning : muted}>
                      {historical
                        ? task.reviewed
                          ? t`Reviewed by you`
                          : t`Assignment history`
                        : statusLabel(agent?.status)}
                    </Text>
                    <PressableScale
                      testID={`collaboration-task-${index}-options`}
                      accessibilityRole="button"
                      accessibilityLabel={t`Assignment options`}
                      accessibilityState={{ expanded: management === task.id }}
                      onPress={() => setManagement(management === task.id ? null : task.id)}
                      style={styles.icon}>
                      <Ellipsis size={20} color={muted} />
                    </PressableScale>
                  </View>
                  <Text variant="bodySmall" numberOfLines={management === task.id ? undefined : 3}>
                    {task.prompt}
                  </Text>
                  <Text variant="caption" color={muted}>
                    {new Date(task.createdAt).toLocaleString()}
                  </Text>
                  {management === task.id ? (
                    <View style={styles.row}>
                      <Button
                        variant="ghost"
                        disabled={task.reviewed}
                        onPress={() => useAgentCollaboration.getState().review(task.id)}>
                        {task.reviewed ? t`Reviewed by you` : t`Mark reviewed`}
                      </Button>
                      <Button
                        testID="collaboration-remove"
                        variant="ghost"
                        onPress={() => useAgentCollaboration.getState().remove(task.id)}>
                        {t`Remove from history`}
                      </Button>
                    </View>
                  ) : null}
                  {!historical ? (
                    <View style={styles.row}>
                      <Button
                        testID={`collaboration-task-${index}-output`}
                        variant="secondary"
                        disabled={!ready || !agent}
                        onPress={() => setDetail(detail === task.id ? null : task.id)}>
                        {detail === task.id ? t`Hide output` : t`Recent output`}
                      </Button>
                      <Button
                        testID={`collaboration-task-${index}-terminal`}
                        variant={needsAttention ? 'secondary' : 'ghost'}
                        disabled={!connectionMatches || !agent}
                        onPress={() => void openTask(task)}>
                        {needsAttention ? t`Respond to agent` : t`Open terminal`}
                      </Button>
                    </View>
                  ) : null}
                  {!historical && detail === task.id ? (
                    <View style={styles.section}>
                      <Text
                        variant="caption"
                        color={muted}>{t`Terminal snapshot · refresh to see newer output`}</Text>
                      <Button
                        testID="collaboration-refresh-output"
                        variant="ghost"
                        disabled={outputLoading || !ready}
                        onPress={refreshOutput}>
                        {hasNewOutput ? t`New output available · refresh` : t`Refresh output`}
                      </Button>
                      {outputLoading ? (
                        <Spinner size="sm" />
                      ) : (
                        <Text testID="collaboration-output" selectable variant="caption">
                          {output || t`No visible output yet.`}
                        </Text>
                      )}
                      {outputError ? (
                        <Text variant="caption" color={theme.colors.danger}>
                          {outputError}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {tasks.length > 0 ? (
              <Text
                variant="caption"
                color={
                  muted
                }>{t`Status describes the agent, not task completion. Updates while connected; review its output to confirm the result. Removing history does not stop an agent.`}</Text>
            ) : null}
          </>
        ) : (
          <View style={styles.formLayout}>
            <View style={[styles.assistantSection, { borderColor: theme.colors.border }]}>
              <View style={styles.projectRow}>
                <Folder size={16} color={muted} />
                <Text
                  selectable
                  variant="caption"
                  color={muted}
                  numberOfLines={2}
                  style={styles.grow}>
                  {originCwd}
                </Text>
              </View>
              <View style={[styles.modeSwitch, { backgroundColor: theme.colors.surfaceRaised }]}>
                {[false, ...(canSpawn ? [true] : [])].map((create) => (
                  <PressableScale
                    key={String(create)}
                    testID={create ? 'collaboration-new' : 'collaboration-existing'}
                    accessibilityRole="button"
                    accessibilityState={{ selected: newAgent === create, disabled: busy }}
                    disabled={busy}
                    onPress={() => setNewAgent(create)}
                    style={[
                      styles.modeOption,
                      {
                        backgroundColor: newAgent === create ? theme.colors.surface : 'transparent',
                        borderColor: newAgent === create ? theme.colors.border : 'transparent',
                      },
                    ]}>
                    <Text
                      variant="bodySmall"
                      color={newAgent === create ? theme.colors.text : muted}>
                      {create ? t`New assistant` : t`Existing assistant`}
                    </Text>
                  </PressableScale>
                ))}
              </View>
              {newAgent ? (
                <View style={styles.section}>
                  <PressableScale
                    testID="collaboration-profile-picker"
                    accessibilityRole="button"
                    accessibilityLabel={t`New assistant`}
                    accessibilityState={{ expanded: choosingProfile, disabled: busy }}
                    disabled={busy}
                    onPress={() => setChoosingProfile((value) => !value)}
                    style={[
                      styles.selectedProfile,
                      {
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surfaceRaised,
                      },
                    ]}>
                    <Text variant="bodySmall" style={styles.grow}>
                      {kind || t`New assistant`}
                    </Text>
                    <ChevronDown size={18} color={muted} />
                  </PressableScale>
                  {choosingProfile ? (
                    <>
                      <ScrollView
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        style={styles.profileViewport}
                        contentContainerStyle={styles.profileGrid}>
                        {profiles
                          .filter((profile) => profile.available || showOtherProfiles)
                          .map((profile) => (
                            <PressableScale
                              key={profile.kind}
                              accessibilityRole="button"
                              accessibilityLabel={profile.kind}
                              accessibilityState={{
                                selected: kind === profile.kind,
                                disabled: busy,
                              }}
                              disabled={busy}
                              onPress={() => {
                                setKind(profile.kind);
                                setChoosingProfile(false);
                                setShowOtherProfiles(false);
                              }}
                              style={[
                                styles.profileOption,
                                {
                                  borderColor:
                                    kind === profile.kind
                                      ? theme.colors.primary
                                      : theme.colors.border,
                                  backgroundColor: theme.colors.surfaceRaised,
                                },
                              ]}>
                              <Text variant="bodySmall" style={styles.grow}>
                                {profile.kind}
                              </Text>
                              {kind === profile.kind ? (
                                <Check size={16} color={theme.colors.primary} />
                              ) : null}
                            </PressableScale>
                          ))}
                      </ScrollView>
                      {profiles.some((profile) => !profile.available) ? (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onPress={() => setShowOtherProfiles((value) => !value)}>
                          {showOtherProfiles ? t`Hide other agent types` : t`Other agent types`}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <Text
                    variant="caption"
                    color={muted}>{t`Starts beside this terminal in the same project.`}</Text>
                  {profiles.find((profile) => profile.kind === kind)?.available === false ? (
                    <Text
                      variant="caption"
                      color={
                        muted
                      }>{t`Not found on the Gateway's PATH. Herdr may still be able to start it.`}</Text>
                  ) : null}
                  {profiles.length === 0 ? (
                    <Text
                      variant="caption"
                      color={
                        muted
                      }>{t`No assistants available yet. Try an existing assistant or reopen this picker.`}</Text>
                  ) : null}
                </View>
              ) : (
                <View style={styles.section}>
                  {candidates.length === 0 ? (
                    <Text
                      color={muted}
                      variant="bodySmall">{t`No other agents in this session. Start a new assistant to collaborate.`}</Text>
                  ) : null}
                  {candidates.map((agent) => (
                    <PressableScale
                      key={agent.paneId}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: target === agent.paneId, disabled: busy }}
                      accessibilityLabel={`${agent.name}, ${statusLabel(agent.status)}`}
                      disabled={busy}
                      onPress={() => setTarget(agent.paneId)}
                      style={[
                        styles.card,
                        {
                          borderColor:
                            target === agent.paneId ? theme.colors.primary : theme.colors.border,
                        },
                      ]}>
                      <View style={styles.row}>
                        <Text variant="bodySmall" style={styles.grow}>
                          {agent.name}
                        </Text>
                        {target === agent.paneId ? (
                          <Check size={18} color={theme.colors.primary} />
                        ) : (
                          <ChevronRight size={18} color={muted} />
                        )}
                      </View>
                      <Text variant="caption" color={muted}>
                        {statusLabel(agent.status)}
                        {agent.sameWorkspace ? ` · ${t`Same workspace`}` : ''}
                      </Text>
                      {agent.cwd ? (
                        <Text numberOfLines={1} variant="caption" color={muted}>
                          {agent.cwd}
                        </Text>
                      ) : null}
                    </PressableScale>
                  ))}
                  {selected && !canAssignToAgent(selected.status) ? (
                    <View style={styles.section}>
                      <Text
                        color={muted}
                        variant="bodySmall">{t`This assistant is busy or needs attention. Open its terminal, choose a ready assistant, or start a new one.`}</Text>
                      {recoveryPane !== selected.paneId ? (
                        <Button
                          variant="secondary"
                          onPress={() => openPane(selected.paneId)}>{t`Open terminal`}</Button>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              )}
            </View>
            <View style={styles.taskSection}>
              {command ? (
                <AgentCommandSummary name={command.name} description={command.description} />
              ) : null}
              <Input
                testID="collaboration-instructions"
                accessibilityLabel={t`Task instructions`}
                label={t`What should they do?`}
                value={prompt}
                onChangeText={setPrompt}
                editable={!busy}
                multiline
                numberOfLines={4}
                maxLength={4000}
                placeholder={t`Describe the task and what a good result looks like.`}
                variant="outline"
              />
              {!command ? (
                <View style={styles.row}>
                  <Button
                    variant="ghost"
                    disabled={busy || Boolean(prompt)}
                    onPress={() =>
                      setPrompt(
                        t`Review the current changes. Report bugs and missing tests; do not edit files.`
                      )
                    }>{t`Review changes`}</Button>
                  <Button
                    variant="ghost"
                    disabled={busy || Boolean(prompt)}
                    onPress={() =>
                      setPrompt(
                        t`Run the relevant tests and report failures with reproduction steps.`
                      )
                    }>{t`Run tests`}</Button>
                </View>
              ) : null}
              <AgentReferenceEditor references={references} disabled={busy} newAgent={newAgent} />
              <View style={[styles.contextOption, { borderColor: theme.colors.border }]}>
                <View style={styles.grow}>
                  <Text variant="bodySmall">{t`Include current terminal output`}</Text>
                  <Text
                    variant="caption"
                    color={
                      muted
                    }>{t`Only the text below is shared. Conversation history is not shared automatically.`}</Text>
                </View>
                <Switch
                  accessibilityLabel={t`Include current terminal output`}
                  disabled={busy || contextLoading}
                  value={includeContext}
                  onValueChange={(value) => void shareContext(value)}
                />
              </View>
              {contextLoading ? (
                <Spinner size="sm" />
              ) : includeContext ? (
                <Text
                  selectable
                  variant="caption"
                  style={[styles.card, { borderColor: theme.colors.border }]}>
                  {context || t`No visible output yet.`}
                </Text>
              ) : null}
              <Button
                testID="collaboration-send"
                disabled={
                  !ready ||
                  busy ||
                  references.picking ||
                  contextLoading ||
                  (!prompt.trim() && !command?.instructions) ||
                  (newAgent ? !kind : !selected || !canAssignToAgent(selected.status))
                }
                onPress={() => void assign()}>
                {busy
                  ? references.draft.images.some((image) => image.upload?.status === 'uploading')
                    ? t`Uploading…`
                    : newAgent
                      ? t`Starting assistant and sending…`
                      : t`Sending task…`
                  : newAgent
                    ? t`Start assistant and send`
                    : t`Send task`}
              </Button>
              <Text
                variant="caption"
                color={
                  muted
                }>{t`You will stay in your current terminal. The assistant works independently.`}</Text>
            </View>
          </View>
        )}
      </KeyboardAwareScrollView>
      <KeyboardToolbar showArrows={false} doneText={t`Done`} />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
    padding: 20,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },
  formLayout: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 },
  assistantSection: {
    flexBasis: 280,
    flexGrow: 1,
    minWidth: 0,
    gap: 16,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  taskSection: { flexBasis: 340, flexGrow: 2, minWidth: 0, gap: 16 },
  projectRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  selectedProfile: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  contextOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
  },
  modeSwitch: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 14 },
  modeOption: {
    flex: 1,
    minHeight: 44,
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileViewport: { maxHeight: 192 },
  profileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 2 },
  profileOption: {
    flexBasis: '46%',
    flexGrow: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, borderCurve: 'continuous', padding: 16, gap: 10 },
  empty: { paddingVertical: 32, gap: 12 },
});
