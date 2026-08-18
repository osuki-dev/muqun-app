/**
 * Start a new agent task from the phone.
 *
 * Three questions, in the order they get answered: which agent, where, and what
 * to ask for. Then Go, and the phone lands in the pane the agent came up in --
 * the whole point of doing this from a sofa rather than walking to the desk.
 *
 * The shape is argued from what each question actually is. The agent is a small
 * closed set the host reported, so it is pills that can all be seen at once
 * rather than a menu that hides the answer behind a tap. The directory is one
 * of a handful of places this session has recently worked -- so those are rows,
 * with the field under them for the case they do not cover, not the other way
 * around: typing a path on a phone is the fallback, not the interface. The
 * prompt is the only free text, so it is the only thing here that is a box.
 *
 * There is no microphone button and there will not be one. The keyboard already
 * has dictation on both platforms, everyone already knows where it is, and a
 * second one drawn by this app would be a worse copy that also has to ask for
 * the microphone permission. The prompt field simply says so.
 *
 * The sheet is sized to its contents. Everything in it is a closed list or a
 * field; nothing scrolls forever, and a sheet that reserved a session's worth
 * of height for four questions would be lying about how long this takes.
 */
import { Button, Input, KeyboardToolbar, Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { Bot, Check, FolderOpen, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
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

/** The focused field's clearance above the keyboard and its toolbar. */
const KEYBOARD_BOTTOM_OFFSET = 88;

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
  useRenderTally('NewTaskSheet');

  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [agent, setAgent] = useState('');
  const [cwd, setCwd] = useState(initialCwd ?? '');
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (starting || !canSpawnAgent({ agent })) return;
    setStarting(true);
    setError(null);
    try {
      const spawned = await spawnAgent(
        sessionId,
        agentSpawnRequest({ agent, cwd, tabId, prompt })
      );
      onStarted(spawned);
    } catch (failure) {
      // Reported in the sheet rather than by closing it. An unknown agent kind
      // and a directory outside the session's workspaces are both refusals of
      // one field, and the reader needs the other two answers still on screen
      // to fix it.
      setError(describeGatewayFailure(failure, t`Could not start the task.`).message);
      setStarting(false);
    }
  }

  return (
    // Two subviews, which is the most a native form sheet will lay out around a
    // scroll view -- and the toolbar is worth one of them. This sheet is sized
    // to its contents, so when the keyboard comes up there is no room left to
    // scroll the Go button clear of it: the last field ends where the keyboard
    // begins. A Done above the keyboard is the platform's own answer to that,
    // it is already in the design system, and it costs nothing when the
    // keyboard is down because it is not drawn at all.
    <>
    <KeyboardAwareScrollView
      // Clearance for the focused field above the keyboard and the toolbar
      // sitting on top of it, so the line being typed is never the line under
      // the Done button.
      bottomOffset={KEYBOARD_BOTTOM_OFFSET}
      keyboardShouldPersistTaps="handled"
      style={[styles.sheet, { backgroundColor: theme.colors.surface }]}
      contentContainerStyle={styles.content}>
      {/* iOS draws the grabber itself; Android's form sheet does not, and a
          sheet with no handle reads as a screen that arrived from the wrong
          direction. Every sheet in this app carries the same two lines. */}
      {process.env.EXPO_OS === 'android' ? <View style={styles.handle} /> : null}

      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text variant="bodySmall" style={styles.title}>
            <Trans>New task</Trans>
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>Start an agent and send it the first thing to do.</Trans>
          </Text>
        </View>
        <GlassChrome face="sheet" style={styles.closeButton}>
          <PressableScale
            accessibilityLabel={t`Close new task`}
            onPress={onClose}
            style={styles.closeHit}>
            <X size={18} color={theme.colors.text} />
          </PressableScale>
        </GlassChrome>
      </View>

      <View style={styles.section}>
        <Text variant="caption" color={theme.colors.textMuted} style={styles.sectionLabel}>
          <Trans>AGENT</Trans>
        </Text>
        {loadingProfiles ? (
          <View style={styles.loadingRow}>
            <Spinner size="sm" color={theme.colors.primary} />
            <Text variant="caption" color={theme.colors.textMuted}>
              <Trans>Asking the server what it can run…</Trans>
            </Text>
          </View>
        ) : profiles.length === 0 ? (
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>This server did not name any agents it can start.</Trans>
          </Text>
        ) : (
          <View style={styles.pills}>
            {profiles.map((profile, index) => (
              <Animated.View key={profile.kind} entering={riseIn(index * STAGGER.row)}>
                <AgentPill
                  profile={profile}
                  selected={profile.kind === agent}
                  onSelect={() => setAgent(profile.kind)}
                />
              </Animated.View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text variant="caption" color={theme.colors.textMuted} style={styles.sectionLabel}>
          <Trans>DIRECTORY</Trans>
        </Text>
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
                  onSelect={() => setCwd(path)}
                />
              </Animated.View>
            ))}
          </View>
        ) : null}
        {/* Under the list, not instead of it, and always present: the recent
            answers are a shortcut, and a shortcut that hides the long way round
            is a trap the first time it does not have the place you meant. */}
        <Input
          label={t`Path`}
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
        <Text variant="caption" color={theme.colors.textMuted} style={styles.sectionLabel}>
          <Trans>FIRST PROMPT</Trans>
        </Text>
        <Input
          value={prompt}
          onChangeText={setPrompt}
          multiline
          numberOfLines={3}
          placeholder={t`Review the failing test and fix it.`}
          variant="outline"
          // The keyboard's own dictation is the answer to "I do not want to
          // type this on a phone", on both platforms. Said once, here, instead
          // of drawn as a button this app would have to own.
          helper={t`Type it, or use your keyboard's dictation key.`}
        />
      </View>

      <Button onPress={() => void start()} disabled={starting || !canSpawnAgent({ agent })}>
        {starting ? t`Starting…` : t`Start task`}
      </Button>

      {error ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          layout={listLayout('short')}>
          <Text selectable variant="caption" color={theme.colors.danger}>
            {error}
          </Text>
        </Animated.View>
      ) : null}
    </KeyboardAwareScrollView>
    {/* One field at a time here, so the arrows would only ever point at
        themselves. */}
    <KeyboardToolbar showArrows={false} doneText={t`Done`} />
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

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={
        profile.available
          ? profile.kind
          : t`${profile.kind}, not found on this server's PATH`
      }
      onPress={onSelect}
      style={[
        styles.pill,
        {
          backgroundColor: selected ? theme.colors.primarySubtle : theme.colors.surfaceRaised,
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

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={path}
      onPress={onSelect}
      style={[styles.recentRow, { backgroundColor: theme.colors.surfaceRaised }]}>
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
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap,
    paddingBottom: LADDER.section,
    gap: LADDER.gutter,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
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
  sectionLabel: { marginLeft: LADDER.tight },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: LADDER.gap },
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
