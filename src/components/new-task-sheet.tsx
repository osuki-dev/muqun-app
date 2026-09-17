import { SheetHandle } from '@/components/sheet-route-frame';
import { Input } from '@/components/themed-input';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
/** Start an agent with the shared terminal composer and attachment pipeline.
 * The full-height sheet keeps input reachable with long host catalogs.
 */
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { TerminalComposer, composerStyles } from '@/components/terminal-composer';
import { AttachmentMenu } from '@/components/attachment-menu';
import { AttachmentStrip } from '@/components/attachment-strip';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import { LogoLoader } from '@/components/logo-loader';
import { SheetHeading } from '@/components/sheet-heading';
import { useAttachmentUploads } from '@/hooks/use-attachment-uploads';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import {
  pickAttachments,
  describePickerFailure,
  isImageAttachment,
  type AttachmentSource,
} from '@/lib/attachments';
import { Trans, useLingui } from '@lingui/react/macro';
import { Bot, Check, FolderOpen, Paperclip, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { LADDER, SectionLabel } from '@/components/settings-chrome';
import {
  agentSpawnRequest,
  canSpawnAgent,
  loadAgentProfiles,
  loadRecentCwds,
  spawnAgent,
  type AgentProfile,
  type SpawnedAgent,
} from '@/lib/gateway-client';
import { fadeIn, fadeOut, listLayout, riseIn, STAGGER } from '@/lib/motion';
import { describeGatewayFailure } from '@/lib/network-error';
import { useRenderTally } from '@/lib/render-tally';

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
  // The plate any text drawn straight onto the shell's wallpaper takes; empty
  // on every theme that has no picture there. Explicit, because this is the
  // component that renders the frame and so sits above its own tint provider:
  // everything *inside* the sheet reads the tint from the frame and calls this
  // with no argument at all.
  const plate = useSheetGroundPlate('surface');
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
            which is the shape `SettingsSheet` uses -- the content container
            carries no padding of its own, so the ground's `absoluteFill` covers
            the sheet's edges instead of stopping at the form's gutter. The
            route keeps the scroll view as its native root. */}
        <SheetFrame>
          <View style={styles.column}>
            {/* iOS draws the grabber itself; Android's form sheet does not, and a
          sheet with no handle reads as a screen that arrived from the wrong
          direction. Every sheet in this app carries the same two lines. */}
            <SheetHandle style={styles.handle} />

            <View style={styles.header}>
              <SheetHeading
                title={t`New task`}
                caption={t`Start an agent and send it the first thing to do.`}
              />
              <GlassChrome face="sheet" style={styles.closeButton}>
                <PressableScale
                  accessibilityLabel={t`Close new task`}
                  onPress={onClose}
                  disabled={starting}
                  style={styles.closeHit}>
                  <X size={18} color={theme.colors.text} />
                </PressableScale>
              </GlassChrome>
            </View>

            <View style={styles.section}>
              <SectionLabel title={<Trans>AGENT</Trans>} color={theme.colors.textMuted} />
              {loadingProfiles ? (
                <View style={[styles.loadingRow, plate]}>
                  <LogoLoader
                    size={36}
                    accessibilityLabel={t`Asking the server what it can run…`}
                  />
                  <Text
                    variant="caption"
                    color={theme.colors.textMuted}
                    style={{ textAlign: 'center' }}>
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
            </View>

            <View style={styles.section}>
              <SectionLabel title={<Trans>DIRECTORY</Trans>} color={theme.colors.textMuted} />
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
              {/* Under the list, not instead of it, and always present: the recent
                answers are a shortcut, and a shortcut that hides the long way
                round is a trap the first time it does not have the place you
                meant. */}
              <Input
                label={t`Path`}
                editable={!starting}
                value={cwd}
                onChangeText={setCwd}
                autoCapitalize="none"
                autoCorrect={false}
                // Not translated: a path is typed as it exists on the machine, and a
                // localized example would teach the wrong thing.
                placeholder="~/code/muqun"
                variant="outline"
                helper={t`Leave it empty to start where the session already is.`}
              />
            </View>

            <View style={styles.section}>
              <SectionLabel title={<Trans>FIRST PROMPT</Trans>} color={theme.colors.textMuted} />
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
                }}
                send={{
                  accessibilityLabel: starting ? t`Starting…` : t`Start task`,
                  armed: canSpawnAgent({ agent }),
                  sending: starting,
                  disabled: starting || !record || !canSpawnAgent({ agent }),
                  onPress: () => void start(),
                }}
              />
              <Text
                variant="caption"
                color={theme.colors.textMuted}
                style={plate}>{t`Type it, or use your keyboard's dictation key.`}</Text>
            </View>

            {previewId && previewImages.some((item) => item.id === previewId) ? (
              <ImagePreviewModal
                images={previewImages}
                initialIndex={previewImages.findIndex((item) => item.id === previewId)}
                onClose={() => setPreviewId(null)}
              />
            ) : null}

            {error ? (
              <Animated.View
                entering={fadeIn('micro')}
                exiting={fadeOut('micro')}
                layout={listLayout('short')}>
                <Text selectable variant="caption" color={theme.colors.danger} style={plate}>
                  {error}
                </Text>
              </Animated.View>
            ) : null}
          </View>
        </SheetFrame>
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
  column: {
    flexGrow: 1,
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap,
    paddingBottom: LADDER.section,
    gap: LADDER.gutter,
  },
  handle: {
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: LADDER.tight / 2 },
  // The panels sheet's title size, so every sheet agrees on how one announces
  // itself.
  title: { fontSize: 20, lineHeight: 25, includeFontPadding: false },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeHit: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: LADDER.gap },
  loadingRow: { alignItems: 'center', gap: LADDER.gap, paddingVertical: LADDER.gap },
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
