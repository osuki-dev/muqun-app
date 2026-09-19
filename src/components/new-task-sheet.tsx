import { useSurfaceBackground } from '@/hooks/use-surface-background';
/** Start an agent with the shared terminal composer and attachment pipeline.
 * The full-height sheet keeps input reachable with long host catalogs.
 */
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { TerminalComposer, composerStyles } from '@/components/terminal-composer';
import { AttachmentMenu } from '@/components/attachment-menu';
import { AttachmentStrip } from '@/components/attachment-strip';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import { LogoLoader } from '@/components/logo-loader';
import { useAttachmentUploads } from '@/hooks/use-attachment-uploads';
import { useInterfaceFontFamily, useMonoFontFamily } from '@/hooks/use-user-fonts';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import {
  pickAttachments,
  describePickerFailure,
  isImageAttachment,
  type AttachmentSource,
} from '@/lib/attachments';
import { Trans, useLingui } from '@lingui/react/macro';
import { Bot, Check, FolderOpen, Paperclip } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import {
  SheetScene,
  SheetSceneAction,
  SheetSceneField,
  SHEET_LADDER,
  sheetSceneStyles,
  useSheetSceneInputStyle,
} from '@/components/sheet-scene';
import { LADDER } from '@/components/settings-chrome';
import {
  agentSpawnRequest,
  canSpawnAgent,
  loadAgentProfiles,
  loadRecentCwds,
  spawnAgent,
  type AgentProfile,
  type SpawnedAgent,
} from '@/lib/gateway-client';
import { listLayout, riseIn, STAGGER } from '@/lib/motion';
import { describeGatewayFailure } from '@/lib/network-error';
import { useRenderTally } from '@/lib/render-tally';
import { FontedTextInput } from '@/components/fonted-text-input';

/**
 * How many recent directories the sheet will draw.
 *
 * A cap, because this sheet is sized to its contents: a session that has been
 * everywhere would otherwise turn a three-question form into a scrolling list
 * of places, with the questions pushed off the bottom. Five is the most that
 * fits above the field without the sheet becoming the whole screen, and the
 * sixth-most-recent directory is not a shortcut anybody was going to take.
 */
const RECENT_CWD_LIMIT = 5;

/** Leave the focused field clear of the keyboard without an extra toolbar. */
const KEYBOARD_BOTTOM_OFFSET = 24;

export function NewTaskSheet({
  sessionId,
  tabId,
  initialCwd,
  onClose,
  onStarted,
}: {
  sessionId: string;
  /**
   * The tab to put the new pane in, when the sheet was opened from one. Absent
   * from the home screen, where there is no tab on screen to mean anything --
   * and absent is a real answer: the gateway puts it wherever the session would
   * have.
   */
  tabId?: string;
  /** The directory the pane behind the sheet is in, when there is one. */
  initialCwd?: string;
  onClose: () => void;
  onStarted: (spawned: SpawnedAgent) => void;
}) {
  // `t` from the hook, never the global `t` from `@lingui/core/macro`: React
  // Compiler memoizes a global `t` call whose arguments have not changed and
  // has no way to know the result also depends on the active locale.
  const { t } = useLingui();
  const theme = useThemeTokens();
  const inputStyle = useSheetSceneInputStyle();
  /**
   * Two fields, two faces, because they hold two different kinds of thing.
   *
   * The directory is a path: it will be handed to the host verbatim, the
   * recent ones under it are compared against it character for character, and
   * the placeholder is already an untranslated `~/code/muqun` for that reason.
   * So it takes the monospace slot.
   *
   * The first prompt is a sentence -- "Review the failing test and fix it." --
   * and it takes the interface face. That is not the face it had: the prompt
   * is typed into `TerminalComposer`, which sets the monospace slot on its
   * field because the thing it was built for is a shell line. The component is
   * right and the reuse was what was wrong, so the correction belongs here, at
   * the call site that borrowed a terminal's field for prose -- which is why
   * the composer merges its own family *ahead* of `inputProps.style`.
   *
   * Both are a family and nothing more, layered last, so each field keeps the
   * metrics of the field it is.
   */
  const monoFontFamily = useMonoFontFamily();
  const interfaceFontFamily = useInterfaceFontFamily() ?? undefined;
  // The plate any text drawn straight onto the shell's wallpaper takes; empty
  // on every theme that has no picture there. Explicit, because this is the
  // component that renders the frame and so sits above its own tint provider:
  // everything *inside* the sheet reads the tint from the frame and calls this
  // with no argument at all.
  useRenderTally('NewTaskSheet');

  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [agent, setAgent] = useState('');
  const [cwd, setCwd] = useState(initialCwd ?? '');
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record = useGatewayConnectionStore((state) => state.record);
  const uploads = useAttachmentUploads(record);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const previewImages = uploads.attachments
    .filter((item) => isImageAttachment(item.mime))
    .map((item) => ({ id: item.id, uri: item.localUri }));
  function chooseAttachmentSource(source: AttachmentSource) {
    setAttachmentMenuOpen(false);
    const picker = uploads.capturePicker();
    if (!picker.isCurrent() || sending.current) return;
    void pickAttachments(source)
      .then(picker.addFiles)
      .catch((failure: unknown) => {
        if (picker.isCurrent()) setError(describePickerFailure(source, failure));
      });
  }

  // The catalog and the directory list are one question each, asked once when
  // the sheet opens. Neither is polled: what a host has installed and where it
  // has been working do not change while a sheet is up, and a picker whose
  // options move under a thumb is worse than a slightly stale one.
  useEffect(() => {
    let cancelled = false;
    setLoadingProfiles(true);
    void loadAgentProfiles()
      .then((value) => {
        if (cancelled) return;
        setProfiles(value);
        // Preselected, because there is nearly always one obvious answer and
        // making the reader tap it first would be ceremony. The first agent the
        // host can actually run, not simply the first listed.
        setAgent((current) => current || value.find((entry) => entry.available)?.kind || '');
        setLoadingProfiles(false);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setProfiles([]);
        setLoadingProfiles(false);
        setError(describeGatewayFailure(failure, t`Could not list this server's agents.`).message);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void loadRecentCwds(sessionId)
      .then((value) => {
        if (!cancelled) setRecentCwds(value.slice(0, RECENT_CWD_LIMIT));
      })
      // Silent on purpose: an absent list is not a failure of this sheet, it
      // is a sheet where the path gets typed. Saying so would report a problem
      // the reader cannot act on and does not have.
      .catch(() => {
        if (!cancelled) setRecentCwds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function start() {
    if (sending.current || !canSpawnAgent({ agent }) || !record) return;
    sending.current = true;
    const owner = record;
    setStarting(true);
    setError(null);
    try {
      const paths = await uploads.awaitUploads();
      if (!mounted.current || useGatewayConnectionStore.getState().record !== owner) return;
      if (paths === null) throw new Error(t`Could not add a file`);
      const firstPrompt = [prompt.trim(), ...paths].filter(Boolean).join(' ');
      const spawned = await spawnAgent(
        sessionId,
        agentSpawnRequest({ agent, cwd, tabId, prompt: firstPrompt })
      );
      if (mounted.current && useGatewayConnectionStore.getState().record === owner) {
        uploads.clearAttachments();
        onStarted(spawned);
      }
    } catch (failure) {
      // Reported in the sheet rather than by closing it. An unknown agent kind
      // and a directory outside the session's workspaces are both refusals of
      // one field, and the reader needs the other two answers still on screen
      // to fix it.
      setError(describeGatewayFailure(failure, t`Could not start the task.`).message);
    } finally {
      sending.current = false;
      if (mounted.current) setStarting(false);
    }
  }

  return (
    <>
      <KeyboardAwareScrollView
        // Keep the focused line visible above the system keyboard.
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        // Transparent: the ground below paints this sheet's floor, its surface
        // tint and the shell's wallpaper, in that order.
        style={[styles.sheet, styles.transparent]}
        contentContainerStyle={styles.canvas}>
        {/* The ground and the padded column are the scroller's two children,
            which is the shape a content-sized sheet uses -- the content container
            carries no padding of its own, so the ground's `absoluteFill` covers
            the sheet's edges instead of stopping at the form's gutter. The
            route keeps the scroll view as its native root. */}
        <SheetScene
          testID="new-task-sheet"
          title={t`New task`}
          caption={t`Start an agent and send it the first thing to do`}>
          <View style={sheetSceneStyles.column}>
            <SheetSceneField label={t`Agent`}>
              {loadingProfiles ? (
                <View style={styles.loadingRow}>
                  <LogoLoader
                    size={28}
                    accessibilityLabel={t`Asking the server what it can run…`}
                  />
                  <Text variant="caption" color={theme.colors.textMuted}>
                    <Trans>Asking the server what it can run…</Trans>
                  </Text>
                </View>
              ) : profiles.length === 0 ? (
                <Text variant="caption" color={theme.colors.textMuted}>
                  <Trans>This server did not name any agents it can start.</Trans>
                </Text>
              ) : (
                <ScrollView
                  horizontal
                  testID="new-task-agents"
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.pills}>
                  {profiles.map((profile, index) => (
                    <Animated.View
                      key={profile.kind}
                      entering={riseIn(Math.min(index, 7) * STAGGER.row)}>
                      <AgentPill
                        profile={profile}
                        selected={profile.kind === agent}
                        onSelect={() => {
                          if (!sending.current) setAgent(profile.kind);
                        }}
                      />
                    </Animated.View>
                  ))}
                </ScrollView>
              )}
            </SheetSceneField>

            <SheetSceneField
              label={t`Directory`}
              hint={t`Leave it empty to start where the session already is.`}>
              <FontedTextInput
                accessibilityLabel={t`Path`}
                editable={!starting}
                value={cwd}
                onChangeText={setCwd}
                autoCapitalize="none"
                autoCorrect={false}
                // Not translated: a path is typed as it exists on the machine,
                // and a localized example would teach the wrong thing.
                placeholder="~/code/muqun"
                placeholderTextColor={theme.colors.textSubtle}
                style={[inputStyle, { fontFamily: monoFontFamily }]}
              />
            </SheetSceneField>

            {/* Under the field, not instead of it, and always present: the
                recent answers are a shortcut, and a shortcut that hides the long
                way round is a trap the first time it does not have the place you
                meant. */}
            {recentCwds.length > 0 ? (
              <View style={styles.recentList}>
                {recentCwds.map((path, index) => (
                  <Animated.View
                    key={path}
                    entering={riseIn(index * STAGGER.row)}
                    layout={listLayout('short')}>
                    <RecentCwdRow
                      path={path}
                      selected={path === cwd.trim()}
                      onSelect={() => {
                        if (!sending.current) setCwd(path);
                      }}
                    />
                  </Animated.View>
                ))}
              </View>
            ) : null}

            <SheetSceneField
              label={t`First prompt`}
              hint={t`Type it, or use your keyboard's dictation key.`}
              error={error ?? undefined}>
              <View style={styles.promptColumn}>
                {attachmentMenuOpen && !starting ? (
                  <AttachmentMenu onSelect={chooseAttachmentSource} textColor={theme.colors.text} />
                ) : null}
                <View pointerEvents={starting ? 'none' : 'auto'}>
                  <AttachmentStrip
                    attachments={uploads.attachments}
                    onRemove={uploads.removeAttachment}
                    onRetry={uploads.retryUpload}
                    onPreview={setPreviewId}
                    textColor={theme.colors.text}
                  />
                </View>
                <TerminalComposer
                  leading={
                    <PressableScale
                      testID="new-task-attach"
                      accessibilityRole="button"
                      accessibilityLabel={t`Add attachment`}
                      disabled={starting || !record}
                      onPress={() => setAttachmentMenuOpen((open) => !open)}
                      style={composerStyles.button}>
                      <Paperclip size={18} color={theme.colors.text} />
                    </PressableScale>
                  }
                  inputProps={{
                    testID: 'new-task-prompt',
                    value: prompt,
                    onChangeText: setPrompt,
                    editable: !starting,
                    placeholder: t`Review the failing test and fix it.`,
                    style: { fontFamily: interfaceFontFamily },
                  }}
                  send={{
                    accessibilityLabel: starting ? t`Starting…` : t`Start task`,
                    armed: canSpawnAgent({ agent }),
                    sending: starting,
                    disabled: starting || !record || !canSpawnAgent({ agent }),
                    onPress: () => void start(),
                  }}
                />
              </View>
            </SheetSceneField>

            <SheetSceneAction
              testID="new-task-start"
              label={starting ? t`Starting…` : t`Start task`}
              busy={starting}
              disabled={!record || !canSpawnAgent({ agent })}
              onPress={() => void start()}
            />

            {previewId && previewImages.some((item) => item.id === previewId) ? (
              <ImagePreviewModal
                images={previewImages}
                initialIndex={previewImages.findIndex((item) => item.id === previewId)}
                onClose={() => setPreviewId(null)}
              />
            ) : null}
          </View>
        </SheetScene>
      </KeyboardAwareScrollView>
    </>
  );
}

/**
 * One agent kind.
 *
 * A kind the gateway could not find on `PATH` is dimmed rather than disabled.
 * Herdr resolves a kind to its own canonical executable, so `available: false`
 * is the gateway saying "I did not see this", not "this will not start" -- and
 * a picker that refused the tap would be wrong more often than the hint is.
 */
function AgentPill({
  profile,
  selected,
  onSelect,
}: {
  profile: AgentProfile;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={
        profile.available ? profile.kind : t`${profile.kind}, not found on this server's PATH`
      }
      onPress={onSelect}
      style={[
        styles.pill,
        {
          backgroundColor: surfaceBackground(
            selected ? theme.colors.primarySubtle : theme.colors.surfaceRaised
          ),
          borderColor: selected ? theme.colors.primary : 'transparent',
        },
      ]}>
      <Bot
        size={15}
        color={selected ? theme.colors.primary : theme.colors.textMuted}
        strokeWidth={2.2}
      />
      <Text
        variant="label"
        numberOfLines={1}
        color={
          selected
            ? theme.colors.primary
            : profile.available
              ? theme.colors.text
              : theme.colors.textSubtle
        }>
        {profile.kind}
      </Text>
    </PressableScale>
  );
}

/** One directory this session has worked in lately. */
function RecentCwdRow({
  path,
  selected,
  onSelect,
}: {
  path: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={path}
      onPress={onSelect}
      style={[
        styles.recentRow,
        { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
      ]}>
      <FolderOpen
        size={16}
        color={selected ? theme.colors.primary : theme.colors.textMuted}
        strokeWidth={2}
      />
      {/* The head is what gets dropped, so the end of the path always survives.
          Two checkouts under the same parent differ in their last segment, and
          `~/code/mu…` distinguishes nothing at all. */}
      <Text
        variant="bodySmall"
        numberOfLines={1}
        ellipsizeMode="head"
        style={styles.recentPath}
        color={selected ? theme.colors.primary : theme.colors.text}>
        {path}
      </Text>
      {selected ? <Check size={16} color={theme.colors.primary} strokeWidth={2.5} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // `flex: 1`, not `height: '100%'`: inside a native form sheet the container's
  // height is not resolved when a percentage is measured and the sheet renders
  // empty. Every other sheet in this app fills the same way.
  sheet: { flex: 1 },
  transparent: { backgroundColor: 'transparent' },
  // No padding here: the ground is laid out against this box, and a padded
  // content container would inset it away from the sheet's own edges.
  canvas: { flexGrow: 1, width: '100%' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SHEET_LADDER.gap },
  // The composer is its own control, so the field holds it in a column
  // rather than on the field's own baseline row.
  promptColumn: { flex: 1, gap: SHEET_LADDER.gap, paddingVertical: SHEET_LADDER.gap },
  pills: { flexDirection: 'row', gap: LADDER.gap, paddingVertical: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: LADDER.snug,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  recentList: { gap: 6 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
    minHeight: 42,
    paddingHorizontal: LADDER.snug,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  recentPath: { flex: 1, minWidth: 0, includeFontPadding: false },
});
