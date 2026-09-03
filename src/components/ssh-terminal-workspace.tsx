import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Dialog, Input, Spinner, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { Keyboard as KeyboardIcon, PenLine, RefreshCw, Unplug, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  PixelRatio,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { TextDecoder } from 'react-native-nitro-text-decoder';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenHeader } from '@/components/screen-header';
import { SkiaTerminal, type TerminalCellMetrics } from '@/components/skia-terminal';
import { TerminalBoundary } from '@/components/terminal-boundary';
import { TerminalComposer } from '@/components/terminal-composer';
import { VirtualKeyboard } from '@/components/virtual-keyboard';
import { appChrome } from '@/constants/appearance';
import { useLatestRef, useLazyRef } from '@/hooks/use-render-refs';
import { useTerminalTheme } from '@/hooks/use-theme-pack';
import { editorActionDescription, terminalKeyDescription } from '@/i18n/labels';
import { withAlpha } from '@/lib/color';
import { connectDemoSsh, demoSshHost, isDemoSshHost } from '@/lib/demo-ssh';
import { dockPresentation } from '@/lib/dock-presentation';
import { feedback } from '@/lib/feedback';
import {
  connectSsh,
  describeSshFailure,
  type SshKeyboardInteractiveChallenge,
  type SshSessionHandle,
  type SshShellHandle,
} from '@/lib/ssh-client';
import {
  TERMINAL_GRID_DEFAULT,
  terminalGridChanged,
  terminalGridFor,
} from '@/lib/ssh-grid-metrics';
import { composerSubmitBytes } from '@/lib/ssh-composer';
import { sshEditorPane, sshNvimMode } from '@/lib/ssh-editor';
import {
  compareSshHostKey,
  sshHostAddress,
  type SshHostRecord,
  type SshTrustedHostKey,
} from '@/lib/ssh-hosts';
import { encodeTerminalKey, encodeTerminalText } from '@/lib/ssh-key-bytes';
import { sanitizeServerText, SERVER_LINE_LIMIT, sshFailureLine } from '@/lib/ssh-server-text';
import { SshTerminalSession } from '@/lib/ssh-terminal-session';
import {
  INSERT_MODE_KEYS,
  keyCap,
  terminalKeysForPane,
  withEditorActions,
  type TerminalKey,
} from '@/lib/terminal-keys';
import { terminalFontSize } from '@/lib/terminal-text-size';
import { useAppSettings } from '@/stores/app-settings';
import { useSshHostsStore } from '@/stores/ssh-hosts';
import type { TerminalFrame } from '@/terminal/types';

/**
 * A shell on an SSH host, drawn by the same canvas every gateway pane uses.
 *
 * The gateway screen is a workspace: tabs, panes, agents, approvals, files.
 * This is one shell on one machine, and it reuses exactly the pieces that
 * survive that reduction -- `SkiaTerminal` for the grid, the composer,
 * `VirtualKeyboard` and the terminal key row for input, the nav header and
 * glass for chrome -- and adds the two things a gateway used to do for the
 * app: turning key names and lines into bytes (`ssh-key-bytes`,
 * `ssh-composer`) and turning a byte stream into the frames the canvas draws
 * (`ssh-terminal-session`, a terminal emulator that lives as long as the
 * connection and hands `SkiaTerminal` a frame at most once per animation
 * frame).
 *
 * The dock is the gateway's, cut down: the same `dockPresentation` rule
 * decides what it shows, with no approval, one pane and no attachments. The
 * composer -- the phone's own keyboard, with its languages, swipe typing and
 * paste -- is what the screen opens with, and it sends a line at a time; the
 * on-screen keyboard behind the key row's toggle sends every key as it is
 * pressed, which is what a full-screen program wants. The key row stays
 * through both: on its own row beside the composer, inside the keyboard's
 * panel when that is up.
 *
 * An editor is treated as the gateway treats one -- the keyboard opens on
 * arrival, the row grows nvim's actions and collapses to Esc while nvim is
 * in Insert mode, a composer send carries no Enter -- but the facts come
 * from the emulator rather than from tmux: the alternate screen, the title
 * the program set, and the mode line on the screen (`ssh-editor`).
 *
 * The grid is sized twice over, on purpose: the PTY is told the columns and
 * rows that fit the viewport at the canvas's measured cell size, and the
 * emulator is resized to the same numbers, so what the program paints and
 * what the canvas draws are one grid. A rotation, a text-size change, the
 * keyboard rising -- anything that re-measures -- re-sizes both. The system
 * keyboard is the one that re-measures continuously: a spacer under the dock
 * follows its animated height, so the terminal shrinks with it, and the
 * viewport is committed once the layout has been still for a moment rather
 * than on each of the animation's frames, so the far side gets one window
 * change and not fifteen.
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

const KEY_ROW_HEIGHT = 36;

/**
 * How long the terminal's layout must hold still before the grid follows it.
 * The system keyboard animates over about a quarter of a second and the
 * viewport is re-measured on every frame of it; this is what turns those
 * frames into one resize, at the size the keyboard settled at.
 */
const VIEWPORT_SETTLE_MS = 100;

export function SshTerminalWorkspace({ hostId }: { hostId: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const terminalTextSize = useAppSettings((state) => state.terminalTextSize);
  const showTerminalKeyRow = useAppSettings((state) => state.showTerminalKeyRow);
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
  /** The emulator's alternate-screen flag, as of the last published frame. */
  const [alternateScreen, setAlternateScreen] = useState(false);
  /** The editor verdict, latched per alternate screen -- see `sshEditorPane`. */
  const [editorPane, setEditorPane] = useState(false);
  // The key row's toggle swaps the composer for the app's own keyboard, the
  // way the gateway screen's does. Off by default: a shell prompt is a line
  // at a time, and the composer is the phone's own keyboard with its
  // languages and its paste. Remembered for as long as the screen is up.
  const [keyboardMode, setKeyboardMode] = useState(false);
  // Asked for, per visit to the keyboard: the composer stands down while the
  // keyboard is up, and this is the reader summoning it back for one line.
  // Cleared when the keyboard closes, which ends the visit it belongs to.
  const [composerRevealed, setComposerRevealed] = useState(false);
  const [draft, setDraft] = useState('');
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
  /** The settle timer behind `reportViewport`, and whether a first layout has landed. */
  const viewportSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportMeasuredRef = useRef(false);

  // The system keyboard's height, as the keyboard controller animates it. A
  // spacer under the dock takes it, so the dock rides up with the keyboard
  // and the terminal above shrinks by the same amount -- and re-measures,
  // which is what re-sizes the grid. The dock's own bottom padding is the
  // safe-area inset, which the keyboard covers, so that much is not doubled.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = insets.bottom;
  // No dependency list: reanimated 4.6 ignores one and warns per render that it
  // did, and the inset is read straight out of the worklet's closure anyway.
  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: Math.max(0, -keyboardHeight.value - bottomInset),
  }));

  useEffect(
    () => () => {
      if (viewportSettleRef.current) clearTimeout(viewportSettleRef.current);
    },
    []
  );

  // Leaving the keyboard ends the visit a revealed composer belonged to.
  useEffect(() => {
    if (!keyboardMode) setComposerRevealed(false);
  }, [keyboardMode]);

  // What the far side is running, as far as the emulator can tell. The title
  // rides the frame; the mode is read off its last rows; both only mean
  // anything on the alternate screen. The verdict latches while that screen
  // is held, because stock nvim in Normal mode shows nothing to read.
  const frameTitle = terminalFrame?.title ?? null;
  const nvimMode = useMemo(
    () => sshNvimMode(terminalFrame, alternateScreen),
    [alternateScreen, terminalFrame]
  );
  useEffect(() => {
    setEditorPane((previous) =>
      sshEditorPane(previous, { alternateScreen, title: frameTitle, nvimMode })
    );
  }, [alternateScreen, frameTitle, nvimMode]);

  // An editor opens straight into the keyboard, as it does on the gateway: it
  // is driven a keystroke at a time, and the composer is the wrong instrument.
  // Only on the way *in*, so closing the keyboard on an editor keeps it closed.
  const editorSeenRef = useRef(false);
  useEffect(() => {
    if (editorPane && !editorSeenRef.current) {
      Keyboard.dismiss();
      setKeyboardMode(true);
    }
    editorSeenRef.current = editorPane;
  }, [editorPane]);

  // The row follows what the shell is running: nvim's own actions on top of
  // the shell set while an editor is up, and only Esc and the basics while
  // nvim is typing every keystroke into the buffer -- where `dd` or `:w`
  // would be typed as letters. The same rule as the gateway's, minus the
  // usage ordering, which is keyed on a gateway profile this screen lacks.
  const terminalKeys = useMemo(() => {
    if (editorPane && nvimMode === 'insert') return INSERT_MODE_KEYS;
    const resolved = terminalKeysForPane(null, editorPane ? frameTitle : null);
    return editorPane ? withEditorActions(resolved) : resolved;
  }, [editorPane, frameTitle, nvimMode]);

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
    const unsubscribe = terminal.subscribe((frame) => {
      setTerminalFrame(frame);
      // The mode is read beside the frame it belongs to, so a render never
      // pairs a new screen with an old answer to "whose screen is it".
      setAlternateScreen(terminal.modes.alternateScreen);
    });
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
      previous &&
      previous.cellWidth === metrics.cellWidth &&
      previous.lineHeight === metrics.lineHeight
        ? previous
        : metrics
    );
  }

  /**
   * The terminal's measured size, committed once it has held still.
   *
   * The first measurement lands at once, so the PTY can open at the right
   * size; every later one waits out `VIEWPORT_SETTLE_MS`, because the system
   * keyboard re-measures on every frame of its animation and the far side
   * should hear about the size it ends at, not the fourteen on the way.
   */
  function reportViewport(width: number, height: number) {
    const commit = () =>
      setViewport((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    if (viewportSettleRef.current) clearTimeout(viewportSettleRef.current);
    if (!viewportMeasuredRef.current) {
      viewportMeasuredRef.current = true;
      commit();
      return;
    }
    viewportSettleRef.current = setTimeout(() => {
      viewportSettleRef.current = null;
      commit();
    }, VIEWPORT_SETTLE_MS);
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
    setAlternateScreen(false);
    setStatus({ phase: 'connecting' });

    const askHostKey = (
      verdict: 'unknown' | 'mismatch',
      key: SshTrustedHostKey,
      trusted?: SshTrustedHostKey
    ) =>
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
        session = await connectDemoSsh({
          verifyHostKey,
          onDisconnected,
          signal: controller.signal,
        });
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
          hostKeyAlgorithms: current.trustedHostKey
            ? [current.trustedHostKey.algorithm]
            : undefined,
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
      setStatus({
        phase: 'failed',
        code: sanitizeServerText(failure.code, 32),
        message: sshFailureLine(failure),
      });
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
      showToast({
        variant: 'danger',
        title: t`Could not send`,
        message: sshFailureLine(describeSshFailure(error)),
      });
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

  /**
   * The composer's line, run. The draft goes over exactly as typed with the
   * Enter that runs it -- and a pasted block goes between paste markers when
   * the program asked for them (`ssh-composer`). The field is cleared and
   * keeps its focus, so the next line can be typed straight away.
   */
  function submitDraft() {
    if (status.phase !== 'connected' || !draft.trim()) return;
    send(
      composerSubmitBytes(draft, {
        bracketedPaste: terminalRef.current.modes.bracketedPaste,
        // A shell needs Enter to run what was typed; an editor takes the text
        // into the buffer and leaves Enter on the key row.
        enter: !editorPane,
      })
    );
    setDraft('');
  }

  /** The key row's toggle: the app's own keyboard in place of the phone's. */
  function openVirtualKeyboard() {
    Keyboard.dismiss();
    setKeyboardMode(true);
  }

  const connected = status.phase === 'connected';
  const connecting = status.phase === 'connecting';
  const hasDraft = draft.trim().length > 0;
  // What the dock shows: the gateway's rule with the gateway's concerns
  // absent -- no approval can stand here, there is one pane, and a shell has
  // nothing to attach. The setting that hides the key row is honoured the same
  // way; with the row gone, its keyboard toggle moves in beside the composer.
  const dock = useMemo(
    () =>
      dockPresentation({
        approval: null,
        keyboardMode,
        paneCount: 1,
        showTerminalKeyRow,
        attachmentsAvailable: false,
        stagedAttachments: 0,
        screenOnTop: true,
        editorPane,
        composerRevealed,
      }),
    [composerRevealed, editorPane, keyboardMode, showTerminalKeyRow]
  );
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

  const keyboardToggle = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Open on-screen keyboard`}
      feedback="selection"
      pressedScale={0.9}
      onPress={openVirtualKeyboard}
      style={[styles.keyRowToggle, { backgroundColor: chromeGlass }]}>
      <KeyboardIcon size={16} color={theme.colors.primary} />
    </PressableScale>
  );

  const keyStrip = (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.keyList}>
      {terminalKeys.map((item) => (
        <TerminalKeyChip
          key={item.key}
          item={item}
          disabled={!connected}
          onPress={() => sendTerminalKey(item)}
          textColor={chromeText}
          background={chromeGlass}
          emphasisBorder={theme.colors.primary}
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
          reportViewport(width, height);
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
            // An editor's own colour scheme is drawn as it is rather than
            // resolved against the app theme -- the gateway's rule, on the
            // same predicate.
            ownsScreen={editorPane}
          />
        </TerminalBoundary>
      </View>

      <GlassChrome style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {dock.virtualKeyboard ? (
          <VirtualKeyboard
            disabled={!connected}
            onText={typeText}
            onKey={typeKey}
            onClose={() => setKeyboardMode(false)}
            shortcuts={
              dock.keysInKeyboard ? <View style={styles.keyRow}>{keyStrip}</View> : undefined
            }
          />
        ) : null}
        {/* The way back to the composer without putting the keyboard away:
            one control in the corner where Send would be, as on the gateway. */}
        {dock.composerEntry ? (
          <View style={styles.composerEntryRow}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Write a line`}
              feedback="selection"
              pressedScale={0.9}
              onPress={() => setComposerRevealed(true)}
              style={[styles.keyRowToggle, { backgroundColor: chromeGlass }]}>
              <PenLine size={16} color={chromeText} />
            </PressableScale>
          </View>
        ) : null}
        {dock.keyRow ? (
          <View style={styles.keyRow}>
            {keyboardToggle}
            {keyStrip}
          </View>
        ) : null}
        {dock.composer ? (
          <TerminalComposer
            // With the key row switched off there is no row to carry the
            // keyboard toggle, so it rides in front of the field instead --
            // the seat the gateway's paperclip has. Never over the keyboard
            // itself, which has its own way down.
            leading={dock.floatingActions ? keyboardToggle : null}
            inputProps={{
              testID: 'ssh-composer-input',
              accessibilityLabel: editorPane ? t`Type into this editor` : t`Run a terminal command`,
              value: draft,
              onChangeText: setDraft,
              editable: connected,
              maxLength: 64 * 1024,
              // A shell is case-sensitive and its commands are lower-case;
              // the phone's habit of capitalising a sentence is wrong here.
              autoCapitalize: 'none',
              placeholder: editorPane ? t`Type into this editor` : t`Run a terminal command`,
            }}
            send={{
              accessibilityLabel: t`Run command`,
              armed: connected && hasDraft,
              sending: false,
              disabled: !connected || !hasDraft,
              onPress: submitDraft,
            }}
          />
        ) : null}
      </GlassChrome>
      <Animated.View style={keyboardSpacerStyle} />

      <HostKeyDialog prompt={prompt} host={record.host} />
      {/* Mounted only while the server is asking, so the answers -- a
          password, a one-time code -- live in React state no longer than the
          dialog does. */}
      {prompt?.kind === 'keyboardInteractive' ? (
        <KeyboardInteractiveDialog prompt={prompt} />
      ) : null}
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
      <Text
        variant="caption"
        color={theme.colors.textMuted}
        numberOfLines={1}
        style={styles.statusText}>
        {text}
      </Text>
      {status.phase === 'disconnected' ||
      status.phase === 'failed' ||
      status.phase === 'cancelled' ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Reconnect`}
          onPress={onReconnect}
          style={[
            styles.pillButton,
            styles.statusAction,
            { backgroundColor: theme.colors.primary },
          ]}>
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
          ? {
              id: 'replace',
              label: t`Replace key`,
              tone: 'destructive',
              onPress: () => prompt.resolve(true),
            }
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
function KeyboardInteractiveDialog({
  prompt,
}: {
  prompt: Extract<Prompt, { kind: 'keyboardInteractive' }>;
}) {
  const { t } = useLingui();
  const [answers, setAnswers] = useState<string[]>([]);
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const { challenge } = prompt;
  const name = sanitizeServerText(challenge.name, 80);
  const instruction = sanitizeServerText(challenge.instruction);
  const prompts = challenge.prompts.map((item) => ({
    label: sanitizeServerText(item.prompt, SERVER_LINE_LIMIT),
    echo: item.echo === true,
  }));
  // Android draws this dialog behind the soft keyboard, so Continue can end up
  // out of reach, and the system back gesture -- the obvious way to get the
  // keyboard out of the way -- closes the dialog instead, which cancels the
  // sign-in. Two answers: the keyboard's own return key submits, and a close
  // request while the keyboard is up puts the keyboard away rather than
  // abandoning the connection.
  const submit = () => prompt.resolve(prompts.map((_item, index) => answers[index] ?? ''));

  return (
    <Dialog
      visible
      onClose={() => {
        if (keyboardUp) {
          Keyboard.dismiss();
          return;
        }
        prompt.resolve(undefined);
      }}
      title={name || t`Sign in`}
      message={instruction || t`The server is asking for more before it lets you in.`}
      actionLayout="row"
      actions={[
        { id: 'cancel', label: t`Cancel`, onPress: () => prompt.resolve(undefined) },
        {
          id: 'submit',
          label: t`Continue`,
          tone: 'primary',
          onPress: submit,
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
            returnKeyType={index === prompts.length - 1 ? 'go' : 'next'}
            onSubmitEditing={index === prompts.length - 1 ? submit : undefined}
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
  emphasisBorder,
}: {
  item: TerminalKey;
  disabled: boolean;
  onPress: () => void;
  textColor: string;
  background: string;
  /** The border on Insert mode's Esc, the row's one deliberate action. */
  emphasisBorder: string;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  // The editor actions have a sentence behind their identity (`nvim:w`);
  // everything else is keyed by its English label. Same two tables, same
  // order, as the gateway's row.
  const described =
    editorActionDescription[item.key] ?? terminalKeyDescription[item.accessibilityLabel];
  const spoken = described ? _(described) : item.accessibilityLabel;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Send ${spoken}`}
      disabled={disabled}
      pressedScale={0.94}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      onPress={onPress}
      style={[
        styles.terminalKey,
        { backgroundColor: background, opacity: disabled ? appChrome.opacity.disabled : 1 },
        item.emphasis ? [styles.terminalKeyEmphasis, { borderColor: emphasisBorder }] : null,
      ]}>
      <Text
        variant="caption"
        color={textColor}
        style={
          item.emphasis
            ? [styles.terminalKeyText, styles.terminalKeyEmphasisText]
            : styles.terminalKeyText
        }>
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
    gap: 8,
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
  /** Right-aligned, where the send button it stands in for would be. */
  composerEntryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
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
  terminalKeyEmphasis: {
    minWidth: 64,
    paddingHorizontal: 18,
    borderWidth: 2,
  },
  terminalKeyEmphasisText: {
    fontWeight: '700',
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
