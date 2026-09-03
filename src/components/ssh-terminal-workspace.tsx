import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Dialog, Input, Spinner, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { Keyboard as KeyboardIcon, RefreshCw, Unplug, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { TextDecoder } from 'react-native-nitro-text-decoder';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenHeader } from '@/components/screen-header';
import { SkiaTerminal, type TerminalCellMetrics } from '@/components/skia-terminal';
import { TerminalBoundary } from '@/components/terminal-boundary';
import { VirtualKeyboard } from '@/components/virtual-keyboard';
import { appChrome } from '@/constants/appearance';
import { useLatestRef, useLazyRef } from '@/hooks/use-render-refs';
import { useTerminalTheme } from '@/hooks/use-theme-pack';
import { terminalKeyDescription } from '@/i18n/labels';
import { withAlpha } from '@/lib/color';
import { connectDemoSsh, demoSshHost, isDemoSshHost } from '@/lib/demo-ssh';
import { feedback } from '@/lib/feedback';
import {
  connectSsh,
  describeSshFailure,
  type SshKeyboardInteractiveChallenge,
  type SshSessionHandle,
  type SshShellHandle,
} from '@/lib/ssh-client';
import { TERMINAL_GRID_DEFAULT, terminalGridChanged, terminalGridFor } from '@/lib/ssh-grid-metrics';
import { compareSshHostKey, sshHostAddress, type SshHostRecord, type SshTrustedHostKey } from '@/lib/ssh-hosts';
import { encodeTerminalKey, encodeTerminalText } from '@/lib/ssh-key-bytes';
import { sanitizeServerText, SERVER_LINE_LIMIT, sshFailureLine } from '@/lib/ssh-server-text';
import { SshTerminalSession } from '@/lib/ssh-terminal-session';
import { keyCap, terminalKeysForPane, type TerminalKey } from '@/lib/terminal-keys';
import { terminalFontSize } from '@/lib/terminal-text-size';
import { useAppSettings } from '@/stores/app-settings';
import { useSshHostsStore } from '@/stores/ssh-hosts';
import type { TerminalFrame } from '@/terminal/types';

/**
 * A shell on an SSH host, drawn by the same canvas every gateway pane uses.
 *
 * The gateway screen is a workspace: tabs, panes, agents, approvals, files.
 * This is one shell on one machine, and it reuses exactly the pieces that
 * survive that reduction -- `SkiaTerminal` for the grid, `VirtualKeyboard`
 * and the terminal key row for input, the nav header and glass for chrome --
 * and adds the two things a gateway used to do for the app: turning key
 * names into bytes (`ssh-key-bytes`) and turning a byte stream into the
 * frames the canvas draws (`ssh-terminal-session`, a terminal emulator that
 * lives as long as the connection and hands `SkiaTerminal` a frame at most
 * once per animation frame).
 *
 * The grid is sized twice over, on purpose: the PTY is told the columns and
 * rows that fit the viewport at the canvas's measured cell size, and the
 * emulator is resized to the same numbers, so what the program paints and
 * what the canvas draws are one grid. A rotation, a text-size change, the
 * keyboard rising -- anything that re-measures -- re-sizes both.
 *
 * Trust-on-first-use lives here rather than in the facade because it is a
 * conversation with the reader: an unknown key is shown and asked about, a
 * known key connects silently, and a *changed* key is refused with a warning
 * and an explicit "replace" -- the one decision the app must never make on
 * its own.
 *
 * Every string the far side writes -- a keyboard-interactive challenge's
 * name, instruction and prompts, the reason a transport gave for dropping,
 * the message inside a failure -- goes through `sanitizeServerText` before
 * it is shown, so a server cannot dress its words up as the app's own or
 * hide half of them (see `ssh-server-text.ts`). The terminal itself has its
 * own policy for the bytes it draws (`terminal-core.ts`).
 *
 * Every attempt to connect carries an `AbortController`. The header's
 * control while connecting, a dialog's Cancel, and leaving the screen all
 * abort it, and the library answers with `CANCELLED` -- which is the
 * reader's own act, so it is a neutral status and not a failure.
 */

type Phase =
  | { phase: 'connecting' }
  | { phase: 'connected' }
  | { phase: 'disconnected'; reason: string }
  /** The reader called the attempt off; nothing went wrong. */
  | { phase: 'cancelled' }
  | { phase: 'failed'; code: string; message: string };

/** What the screen is waiting on the reader for, if anything. */
type Prompt =
  | { kind: 'trust'; key: SshTrustedHostKey; resolve: (accept: boolean) => void }
  | {
      kind: 'mismatch';
      key: SshTrustedHostKey;
      trusted: SshTrustedHostKey;
      resolve: (accept: boolean) => void;
    }
  | {
      kind: 'keyboardInteractive';
      challenge: SshKeyboardInteractiveChallenge;
      resolve: (answers: string[] | undefined) => void;
    };

/** The shell row: prompt keys, line editing, arrows. No agent, no editor. */
const SHELL_KEYS = terminalKeysForPane(null);

const KEY_ROW_HEIGHT = 36;

export function SshTerminalWorkspace({ hostId }: { hostId: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const terminalTextSize = useAppSettings((state) => state.terminalTextSize);
  const terminalTheme = useTerminalTheme();

  const hosts = useSshHostsStore((state) => state.hosts);
  const loading = useSshHostsStore((state) => state.loading);
  const hydrate = useSshHostsStore((state) => state.hydrate);
  const credentialFor = useSshHostsStore((state) => state.credentialFor);
  const setTrustedHostKey = useSshHostsStore((state) => state.setTrustedHostKey);
  const markConnected = useSshHostsStore((state) => state.markConnected);

  useEffect(() => {
    if (loading) void hydrate();
  }, [hydrate, loading]);

  const demo = isDemoSshHost({ id: hostId });
  const record: SshHostRecord | null = demo
    ? demoSshHost()
    : (hosts.find((item) => item.id === hostId) ?? null);
  // The trusted key can change under a live connect (the reader just accepted
  // one), and the connect effect must see the latest without re-running.
  const recordRef = useLatestRef(record);
  // The copy the connect effect may need, translated on the render that has
  // the hook's `t` and read off a ref so a language switch does not re-run
  // the effect and tear the session down. The macro only expands a `t` it
  // can trace back to `useLingui()`, so these cannot be `t` calls inside the
  // effect itself.
  const notifyRef = useLatestRef({
    showToast,
    noCredential: t`No password or key is saved for this host.`,
    shellExited: t`The shell exited.`,
    connectionDropped: t`The connection dropped.`,
    couldNotConnect: t`Could not connect`,
  });

  const [status, setStatus] = useState<Phase>({ phase: 'connecting' });
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  /** The last frame the emulator published; undefined until the first output. */
  const [terminalFrame, setTerminalFrame] = useState<TerminalFrame | undefined>(undefined);
  const [cellMetrics, setCellMetrics] = useState<TerminalCellMetrics | null>(null);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [stickBottomNonce, setStickBottomNonce] = useState(0);
  /** Bumped to reconnect; `wanted` false is a deliberate disconnect. */
  const [attempt, setAttempt] = useState(0);
  const [wanted, setWanted] = useState(true);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const terminalRef = useLazyRef(
    () =>
      new SshTerminalSession({
        decoder: new TextDecoder(),
        columns: TERMINAL_GRID_DEFAULT.cols,
        rows: TERMINAL_GRID_DEFAULT.rows,
        theme: terminalTheme,
      })
  );
  const sessionRef = useLazyRef<{ session: SshSessionHandle | null; shell: SshShellHandle | null }>(
    () => ({ session: null, shell: null })
  );
  /** The attempt in flight, so the header and the dialogs can call it off. */
  const attemptRef = useRef<AbortController | null>(null);

  const fontSize = terminalFontSize(terminalTextSize);
  // The canvas's own cell size, once it has measured its font. Until then the
  // advance ratio stands in; the first report re-sizes the grid once.
  const grid = useMemo(
    () =>
      viewport.width > 0 && viewport.height > 0
        ? terminalGridFor({
            width: viewport.width,
            height: viewport.height,
            fontSize,
            cellWidth: cellMetrics?.cellWidth,
            lineHeight: cellMetrics?.lineHeight,
            pixelRatio: PixelRatio.get(),
          })
        : TERMINAL_GRID_DEFAULT,
    [cellMetrics, fontSize, viewport.height, viewport.width]
  );
  const gridRef = useLatestRef(grid);

  // Frames come off the emulator on its own schedule -- at most one per
  // animation frame, however many chunks landed in it -- and each is a new
  // object, which is what `SkiaTerminal` keys its picture on.
  useEffect(() => {
    const terminal = terminalRef.current;
    const unsubscribe = terminal.subscribe((frame) => setTerminalFrame(frame));
    return () => {
      unsubscribe();
      terminal.dispose();
    };
  }, [terminalRef]);

  // The palette follows the theme pack for everything printed from now on;
  // cells already on screen keep the colours they were printed in.
  useEffect(() => {
    terminalRef.current.setTheme(terminalTheme);
  }, [terminalRef, terminalTheme]);

  // Both grids follow the viewport: the emulator's, so the frame is laid out
  // in the columns the canvas will draw, and the PTY's, so the program on the
  // far side paints for the same ones. A rotation, a text-size change, the
  // keyboard rising -- anything that re-measures the viewport re-sizes both.
  useEffect(() => {
    terminalRef.current.resize(grid.cols, grid.rows);
    const shell = sessionRef.current.shell;
    if (!shell) return;
    try {
      shell.resize(grid.cols, grid.rows);
    } catch {
      // A shell that is already gone reports that through onClosed.
    }
  }, [grid.cols, grid.rows, sessionRef, terminalRef]);

  function reportCellMetrics(metrics: TerminalCellMetrics) {
    setCellMetrics((previous) =>
      previous && previous.cellWidth === metrics.cellWidth && previous.lineHeight === metrics.lineHeight
        ? previous
        : metrics
    );
  }

  // Everything that identifies *which* connection to make, as one string, so a
  // rename or an accepted host key does not tear the session down.
  const connectKey = record
    ? `${record.id}|${record.host}|${record.port}|${record.username}|${record.auth.type}`
    : null;

  useEffect(() => {
    if (connectKey === null || !wanted) return;
    let cancelled = false;
    const terminal = terminalRef.current;
    const handles = sessionRef.current;
    // One controller per attempt. Aborting it is how the header's control,
    // a dialog's Cancel and the screen going away all end the attempt; the
    // library answers with `CANCELLED`, and `catch` below reads that as the
    // reader's own act rather than a failure.
    const controller = new AbortController();
    attemptRef.current = controller;
    /** Closes whichever dialog is up, as a Cancel would, when the attempt is aborted from outside it. */
    let dismissPrompt: (() => void) | null = null;
    controller.signal.addEventListener('abort', () => dismissPrompt?.(), { once: true });
    terminal.reset();
    setTerminalFrame(undefined);
    setStatus({ phase: 'connecting' });

    const askHostKey = (verdict: 'unknown' | 'mismatch', key: SshTrustedHostKey, trusted?: SshTrustedHostKey) =>
      new Promise<boolean>((resolve) => {
        if (cancelled || controller.signal.aborted) {
          resolve(false);
          return;
        }
        let settled = false;
        const once = (accept: boolean) => {
          if (settled) return;
          settled = true;
          dismissPrompt = null;
          setPrompt(null);
          // Declining is calling the attempt off, not just this key: the
          // library would otherwise go on to fail with HOST_KEY_REJECTED.
          if (!accept) controller.abort();
          resolve(accept);
        };
        dismissPrompt = () => once(false);
        setPrompt(
          verdict === 'mismatch' && trusted
            ? { kind: 'mismatch', key, trusted, resolve: once }
            : { kind: 'trust', key, resolve: once }
        );
      });

    const askKeyboardInteractive = (challenge: SshKeyboardInteractiveChallenge) =>
      new Promise<string[] | undefined>((resolve) => {
        if (cancelled || controller.signal.aborted) {
          resolve(undefined);
          return;
        }
        let settled = false;
        const once = (answers: string[] | undefined) => {
          if (settled) return;
          settled = true;
          dismissPrompt = null;
          setPrompt(null);
          if (answers === undefined) controller.abort();
          resolve(answers);
        };
        dismissPrompt = () => once(undefined);
        setPrompt({ kind: 'keyboardInteractive', challenge, resolve: once });
      });

    const verifyHostKey = async (key: SshTrustedHostKey) => {
      const current = recordRef.current;
      if (!current) return false;
      const verdict = compareSshHostKey(current.trustedHostKey, key);
      if (verdict === 'match') return true;
      const accepted = await askHostKey(verdict, key, current.trustedHostKey);
      if (accepted && !isDemoSshHost(current)) await setTrustedHostKey(current.id, key);
      return accepted;
    };

    const onDisconnected = (reason: string) => {
      if (cancelled) return;
      // The reason is the transport's, and the transport's far end wrote it.
      const plain = sanitizeServerText(reason, SERVER_LINE_LIMIT);
      setStatus({ phase: 'disconnected', reason: plain || notifyRef.current.connectionDropped });
    };

    (async () => {
      const current = recordRef.current;
      if (!current) return;
      let session: SshSessionHandle;
      if (isDemoSshHost(current)) {
        session = await connectDemoSsh({ verifyHostKey, onDisconnected, signal: controller.signal });
      } else {
        const credential = await credentialFor(current);
        if (!credential) {
          throw Object.assign(new Error(notifyRef.current.noCredential), {
            name: 'SshError',
            code: 'KEY',
          });
        }
        session = await connectSsh({
          host: current.host,
          port: current.port,
          username: current.username,
          credential,
          verifyHostKey,
          onKeyboardInteractive: askKeyboardInteractive,
          onDisconnected,
          signal: controller.signal,
          // A pinned key names its type, and asking for that type first is
          // what keeps a multi-key server from presenting a different valid
          // key that this screen would then have to call a mismatch.
          hostKeyAlgorithms: current.trustedHostKey ? [current.trustedHostKey.algorithm] : undefined,
        });
      }
      if (cancelled || controller.signal.aborted) {
        // Aborted in the moment between the handshake finishing and this
        // line: the library may have closed it already; closing twice is safe.
        void session.disconnect().catch(() => {});
        if (!cancelled) setStatus({ phase: 'cancelled' });
        return;
      }
      handles.session = session;
      const size = gridRef.current;
      // The emulator opens at the size the PTY opens at, so the banner lands
      // in the grid the canvas is about to draw.
      terminal.resize(size.cols, size.rows);
      const shell = await session.openShell(
        { cols: size.cols, rows: size.rows, term: 'xterm-256color' },
        {
          onData: (bytes) => {
            if (cancelled) return;
            terminal.push(bytes);
          },
          onClosed: () => {
            if (cancelled) return;
            handles.shell = null;
            terminal.end();
            setStatus({ phase: 'disconnected', reason: notifyRef.current.shellExited });
          },
        }
      );
      if (cancelled) {
        void shell.close().catch(() => {});
        void session.disconnect().catch(() => {});
        return;
      }
      handles.shell = shell;
      // The viewport may have been measured while the handshake ran.
      const latest = gridRef.current;
      if (terminalGridChanged(latest, size)) {
        terminal.resize(latest.cols, latest.rows);
        shell.resize(latest.cols, latest.rows);
      }
      setStatus({ phase: 'connected' });
      if (!isDemoSshHost(current)) void markConnected(current.id);
    })().catch((error: unknown) => {
      if (cancelled) return;
      const failure = describeSshFailure(error);
      if (controller.signal.aborted || failure.code === 'CANCELLED') {
        setStatus({ phase: 'cancelled' });
        return;
      }
      setStatus({ phase: 'failed', code: sanitizeServerText(failure.code, 32), message: sshFailureLine(failure) });
      const { showToast: toast, couldNotConnect } = notifyRef.current;
      toast({
        variant: 'danger',
        title: couldNotConnect,
        message: sshFailureLine(failure),
      });
    });

    return () => {
      cancelled = true;
      // Leaving the screen, or starting the next attempt, ends this one
      // wherever it is -- a handshake in flight, a dialog waiting on the
      // reader -- rather than leaving it to run on to its own conclusion.
      controller.abort();
      if (attemptRef.current === controller) attemptRef.current = null;
      setPrompt(null);
      const shell = handles.shell;
      const session = handles.session;
      handles.shell = null;
      handles.session = null;
      if (shell) void shell.close().catch(() => {});
      if (session) void session.disconnect().catch(() => {});
    };
  }, [
    attempt,
    connectKey,
    credentialFor,
    gridRef,
    markConnected,
    notifyRef,
    recordRef,
    sessionRef,
    setTrustedHostKey,
    terminalRef,
    wanted,
  ]);

  function reconnect() {
    setWanted(true);
    setAttempt((value) => value + 1);
  }

  function disconnect() {
    setWanted(false);
    setStatus({ phase: 'disconnected', reason: t`Disconnected.` });
  }

  /**
   * Calls the attempt in flight off. The status follows from the library's
   * `CANCELLED` rejection rather than being set here, so the screen never
   * says "cancelled" over a connection that in fact went through.
   */
  function cancelConnect() {
    attemptRef.current?.abort();
  }

  function send(bytes: Uint8Array) {
    const shell = sessionRef.current.shell;
    if (!shell || status.phase !== 'connected') return;
    try {
      shell.write(bytes);
      setStickBottomNonce((value) => value + 1);
    } catch (error) {
      showToast({ variant: 'danger', title: t`Could not send`, message: sshFailureLine(describeSshFailure(error)) });
    }
  }

  function typeKey(name: string) {
    // The program on the far side decides how an arrow is spelled: an editor
    // or a pager sets DECCKM, the emulator sees it go by, and the encoder is
    // told at the moment the key is sent.
    const bytes = encodeTerminalKey(name, {
      applicationCursorKeys: terminalRef.current.modes.applicationCursorKeys,
    });
    if (bytes) send(bytes);
  }

  function typeText(text: string) {
    send(encodeTerminalText(text));
  }

  function sendTerminalKey(item: TerminalKey) {
    void feedback('selection');
    if (item.text !== undefined) {
      typeText(item.text);
      if (item.submit) typeKey('enter');
      return;
    }
    typeKey(item.key);
  }

  const connected = status.phase === 'connected';
  const connecting = status.phase === 'connecting';
  const chromeText = theme.colors.text;
  const chromeGlass = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);

  if (!record) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={t`SSH`} />
        <View style={styles.missing}>
          {loading ? (
            <Spinner />
          ) : (
            <>
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centered}>
                <Trans>This host is no longer saved.</Trans>
              </Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Back to SSH hosts`}
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/ssh'))}
                style={[styles.pillButton, { backgroundColor: theme.colors.primary }]}>
                <Text variant="caption" color={theme.colors.onPrimary}>
                  <Trans>Back</Trans>
                </Text>
              </PressableScale>
            </>
          )}
        </View>
      </View>
    );
  }

  const keyStrip = (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.keyList}>
      {SHELL_KEYS.map((item) => (
        <TerminalKeyChip
          key={item.key}
          item={item}
          disabled={!connected}
          onPress={() => sendTerminalKey(item)}
          textColor={chromeText}
          background={chromeGlass}
        />
      ))}
    </ScrollView>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title={record.label}
        right={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              connecting
                ? t`Cancel connecting to ${record.label}`
                : connected
                  ? t`Disconnect from ${record.label}`
                  : t`Reconnect to ${record.label}`
            }
            onPress={connecting ? cancelConnect : connected ? disconnect : reconnect}
            style={styles.headerButton}>
            {connecting ? (
              <X size={19} color={theme.colors.text} strokeWidth={2} />
            ) : connected ? (
              <Unplug size={19} color={theme.colors.text} strokeWidth={2} />
            ) : (
              <RefreshCw size={19} color={theme.colors.text} strokeWidth={2} />
            )}
          </PressableScale>
        }
      />

      <StatusLine status={status} address={sshHostAddress(record)} onReconnect={reconnect} />

      <View
        style={styles.terminal}
        onLayout={(event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          setViewport((previous) =>
            previous.width === width && previous.height === height ? previous : { width, height }
          );
        }}>
        <TerminalBoundary
          resetKey={`${record.id}:${attempt}`}
          background={theme.colors.background}
          textColor={theme.colors.text}>
          <SkiaTerminal
            frame={terminalFrame}
            onCellMetrics={reportCellMetrics}
            terminalId={`ssh:${record.id}:${attempt}`}
            textSize={terminalTextSize}
            stickBottomNonce={stickBottomNonce}
          />
        </TerminalBoundary>
      </View>

      <GlassChrome style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {keyboardMode ? (
          <VirtualKeyboard
            disabled={!connected}
            onText={typeText}
            onKey={typeKey}
            onClose={() => setKeyboardMode(false)}
            shortcuts={<View style={styles.keyRow}>{keyStrip}</View>}
          />
        ) : (
          <View style={styles.keyRow}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Show keyboard`}
              feedback="selection"
              pressedScale={0.9}
              onPress={() => setKeyboardMode(true)}
              style={[styles.keyRowToggle, { backgroundColor: chromeGlass }]}>
              <KeyboardIcon size={16} color={theme.colors.primary} />
            </PressableScale>
            {keyStrip}
          </View>
        )}
      </GlassChrome>

      <HostKeyDialog prompt={prompt} host={record.host} />
      {/* Mounted only while the server is asking, so the answers -- a
          password, a one-time code -- live in React state no longer than the
          dialog does. */}
      {prompt?.kind === 'keyboardInteractive' ? <KeyboardInteractiveDialog prompt={prompt} /> : null}
    </View>
  );
}

/** One line under the header: a light, a word, and the way back when it is needed. */
function StatusLine({
  status,
  address,
  onReconnect,
}: {
  status: Phase;
  address: string;
  onReconnect: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  // Cancelled is the reader's doing and is lit in no colour at all; the
  // others are the connection's state.
  const light =
    status.phase === 'connected'
      ? theme.colors.success
      : status.phase === 'connecting'
        ? theme.colors.warning
        : status.phase === 'cancelled'
          ? theme.colors.textMuted
          : theme.colors.danger;
  const text =
    status.phase === 'connected'
      ? t`Connected to ${address}`
      : status.phase === 'connecting'
        ? t`Connecting to ${address}`
        : status.phase === 'disconnected'
          ? t`Disconnected · ${status.reason}`
          : status.phase === 'cancelled'
            ? t`Cancelled`
            : t`Failed · ${status.code}`;

  return (
    <View style={styles.statusLine} accessibilityRole="text" accessibilityLabel={text}>
      <View style={[styles.statusDot, { backgroundColor: light }]} />
      <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1} style={styles.statusText}>
        {text}
      </Text>
      {status.phase === 'disconnected' || status.phase === 'failed' || status.phase === 'cancelled' ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Reconnect`}
          onPress={onReconnect}
          style={[styles.pillButton, styles.statusAction, { backgroundColor: theme.colors.primary }]}>
          <Text variant="caption" color={theme.colors.onPrimary}>
            <Trans>Reconnect</Trans>
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function HostKeyDialog({ prompt, host }: { prompt: Prompt | null; host: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  if (!prompt || (prompt.kind !== 'trust' && prompt.kind !== 'mismatch')) return null;
  const mismatch = prompt.kind === 'mismatch';
  return (
    <Dialog
      visible
      onClose={() => prompt.resolve(false)}
      tone={mismatch ? 'danger' : 'warning'}
      title={mismatch ? t`Host key changed` : t`New host key`}
      message={
        mismatch
          ? t`${host} presented a different key from the one saved for it. This happens after a reinstall, and it also happens when something is intercepting the connection. Do not replace it unless you know why it changed.`
          : t`${host} presented a key this app has not seen before. Compare the fingerprint with the server before trusting it.`
      }
      actionLayout="row"
      actions={[
        { id: 'cancel', label: t`Cancel`, onPress: () => prompt.resolve(false) },
        mismatch
          ? { id: 'replace', label: t`Replace key`, tone: 'destructive', onPress: () => prompt.resolve(true) }
          : { id: 'trust', label: t`Trust`, tone: 'primary', onPress: () => prompt.resolve(true) },
      ]}>
      <View style={styles.fingerprints}>
        {mismatch ? (
          <View style={styles.fingerprint}>
            <Text variant="caption" color={theme.colors.textMuted}>
              <Trans>Saved</Trans>
            </Text>
            <Text selectable variant="caption" style={styles.mono}>
              {`${sanitizeServerText(prompt.trusted.algorithm, 64)}\n${prompt.trusted.fingerprint}`}
            </Text>
          </View>
        ) : null}
        <View style={styles.fingerprint}>
          <Text variant="caption" color={theme.colors.textMuted}>
            {mismatch ? t`Presented now` : t`Fingerprint`}
          </Text>
          <Text selectable variant="caption" style={styles.mono}>
            {`${sanitizeServerText(prompt.key.algorithm, 64)}\n${prompt.key.fingerprint}`}
          </Text>
        </View>
      </View>
    </Dialog>
  );
}

/**
 * The server's own questions: a name, an instruction, one or more prompts.
 * All three are the server's words, shown as plain text and cut short (see
 * `sanitizeServerText`); a prompt with nothing left after that is labelled
 * by the app instead, so a field is never unlabelled.
 */
function KeyboardInteractiveDialog({ prompt }: { prompt: Extract<Prompt, { kind: 'keyboardInteractive' }> }) {
  const { t } = useLingui();
  const [answers, setAnswers] = useState<string[]>([]);
  const { challenge } = prompt;
  const name = sanitizeServerText(challenge.name, 80);
  const instruction = sanitizeServerText(challenge.instruction);
  const prompts = challenge.prompts.map((item) => ({
    label: sanitizeServerText(item.prompt, SERVER_LINE_LIMIT),
    echo: item.echo === true,
  }));
  return (
    <Dialog
      visible
      onClose={() => prompt.resolve(undefined)}
      title={name || t`Sign in`}
      message={instruction || t`The server is asking for more before it lets you in.`}
      actionLayout="row"
      actions={[
        { id: 'cancel', label: t`Cancel`, onPress: () => prompt.resolve(undefined) },
        {
          id: 'submit',
          label: t`Continue`,
          tone: 'primary',
          onPress: () => prompt.resolve(prompts.map((_item, index) => answers[index] ?? '')),
        },
      ]}>
      <View style={styles.prompts}>
        {prompts.map((item, index) => (
          <Input
            key={index}
            label={item.label || t`Answer`}
            value={answers[index] ?? ''}
            onChangeText={(value) =>
              setAnswers((previous) => {
                const next = [...previous];
                next[index] = value;
                return next;
              })
            }
            secureTextEntry={!item.echo}
            autoCapitalize="none"
            autoCorrect={false}
            variant="outline"
            size="compact"
          />
        ))}
      </View>
    </Dialog>
  );
}

function TerminalKeyChip({
  item,
  disabled,
  onPress,
  textColor,
  background,
}: {
  item: TerminalKey;
  disabled: boolean;
  onPress: () => void;
  textColor: string;
  background: string;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const described = terminalKeyDescription[item.accessibilityLabel];
  const spoken = described ? _(described) : item.accessibilityLabel;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Send ${spoken}`}
      disabled={disabled}
      pressedScale={0.94}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      onPress={onPress}
      style={[styles.terminalKey, { backgroundColor: background, opacity: disabled ? appChrome.opacity.disabled : 1 }]}>
      <Text variant="caption" color={textColor} style={styles.terminalKeyText}>
        {keyCap(item.key, item.cap)}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  centered: {
    textAlign: 'center',
  },
  headerButton: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
    minHeight: 28,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    flexShrink: 1,
  },
  statusAction: {
    marginLeft: 'auto',
  },
  pillButton: {
    minHeight: 30,
    paddingHorizontal: 14,
    borderRadius: 15,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminal: {
    flex: 1,
    overflow: 'hidden',
  },
  dock: {
    paddingTop: 8,
    paddingHorizontal: 10,
    borderTopLeftRadius: appChrome.radius.composerDock,
    borderTopRightRadius: appChrome.radius.composerDock,
    borderCurve: 'continuous',
  },
  keyRow: {
    flexDirection: 'row',
    height: KEY_ROW_HEIGHT,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 1,
  },
  keyRowToggle: {
    width: 40,
    height: KEY_ROW_HEIGHT,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyList: {
    gap: 6,
    paddingHorizontal: 1,
    alignItems: 'center',
  },
  terminalKey: {
    height: KEY_ROW_HEIGHT,
    minWidth: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontVariant: ['tabular-nums'],
  },
  fingerprints: {
    gap: 12,
  },
  fingerprint: {
    gap: 4,
  },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  prompts: {
    gap: 10,
  },
});
