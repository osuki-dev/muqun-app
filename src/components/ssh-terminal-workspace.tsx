import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Spinner, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
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
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditorControls } from '@/components/editor-controls';
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenHeader } from '@/components/screen-header';
import { SshHostKeyDialog, SshKeyboardInteractiveDialog } from '@/components/ssh-host-key-dialog';
import { SkiaTerminal, type TerminalCellMetrics } from '@/components/skia-terminal';
import {
  TERMINAL_TOUCH_MODES_OFF,
  terminalTouchModesOf,
  type TerminalTouchModes,
} from '@/terminal/touch-input';
import { TerminalBoundary } from '@/components/terminal-boundary';
import { TerminalComposer } from '@/components/terminal-composer';
import { VirtualKeyboard } from '@/components/virtual-keyboard';
import { appChrome } from '@/constants/appearance';
import { useLatestRef, useLazyRef } from '@/hooks/use-render-refs';
import { useSettledHeight } from '@/hooks/use-settled-height';
import { useTerminalTheme } from '@/hooks/use-theme-pack';
import { editorActionDescription, terminalKeyDescription } from '@/i18n/labels';
import { withAlpha } from '@/lib/color';
import { connectDemoSsh, demoSshHost, isDemoSshHost } from '@/lib/demo-ssh';
import { dockPresentation } from '@/lib/dock-presentation';
import { feedback } from '@/lib/feedback';
import { fadeIn, fadeOutDown } from '@/lib/motion';
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
  /**
   * The modes the terminal's touch translation reads, as of the last published
   * frame. A separate piece of state from `alternateScreen` above, and a
   * separate one from the emulator's own live `modes` object, because this one
   * has to be a NEW object whenever it differs: the terminal takes it as a prop
   * and mirrors it onto the UI thread, and a live object mutated in place would
   * never tell React there was anything to mirror.
   */
  const [touchModes, setTouchModes] = useState<TerminalTouchModes>(TERMINAL_TOUCH_MODES_OFF);
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

  /*
    The system keyboard's height, as the keyboard controller animates it.

    This used to be a spacer *under* the dock: a view in normal flow whose
    height followed this value frame by frame, so the dock rode up with the
    keyboard and the terminal above it shrank by the same amount. That worked,
    and it cost more than it was worth. Every frame of the keyboard's animation
    changed the terminal's box, every change reached `onLayout`, and everything
    downstream of `viewport` -- the grid arithmetic, the emulator resize, the
    PTY's window size -- was re-derived from it. Measured on the emulator, eight
    raise/dismiss cycles of the demo shell: 73.89% janky frames, a 90th
    percentile of 150ms, and 65 missed vsyncs.

    The gateway screen never had that problem, because its dock is an
    absolutely positioned overlay that *translates* with the keyboard while the
    terminal's box holds still. This screen is now the same shape, and the
    translation below is exactly the spacer's old height expressed as a
    transform: the keyboard's height, less the safe-area inset the dock already
    pads itself by and the keyboard covers. Same geometry on the screen, no
    layout at all.
  */
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = insets.bottom;
  // No dependency list: reanimated 4.6 ignores one and warns per render that it
  // did, and the inset is read straight out of the worklet's closure anyway.
  const dockKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, -keyboardHeight.value - bottomInset) }],
  }));
  /*
    What the dock takes off the bottom of the terminal, throttled.

    The dock is over the grid now rather than beside it, so the rows it covers
    have to be accounted for by hand -- and there are two answers depending on
    what is on screen. An ordinary dock is permanent chrome: a program painting
    into the rows behind it would never have them read, so those rows come out
    of the PTY's size outright. An editor has no dock at all, and what is left
    of the bottom is the system's own safe area.

    Why it is throttled rather than written straight through is the whole of
    `useSettledHeight`; the short version is that a measurement written from
    `onLayout` is a nested update, and the dock's padding can alternate while
    the keyboard animates.
  */
  const [dockHeight, measureDockHeight] = useSettledHeight(96);

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

  /*
    An editor arrives bare, and every control on the screen gets out of its way.

    This used to open the keyboard on arrival, on the argument that an editor is
    driven a keystroke at a time and the reader would want one. Both halves of
    that were true and the conclusion was still wrong: what it produced was nvim
    in the top third of the phone with the app's QWERTY under it, on a screen
    the reader had opened *to read a file*. The keys are still one tap away --
    they are behind the floating handle now (`EditorControls`) -- and the file
    has the screen until they are asked for.

    Only on the way *in*, so a reader who opened the panel keeps it open while
    they work.
  */
  const editorSeenRef = useRef(false);
  useEffect(() => {
    if (editorPane && !editorSeenRef.current) {
      Keyboard.dismiss();
      setKeyboardMode(false);
    }
    editorSeenRef.current = editorPane;
  }, [editorPane]);

  /**
   * Where the reader dragged the floating cluster, kept here rather than in the
   * component so it outlives a trip out of nvim and back into it.
   */
  const editorControlsOffset = useSharedValue(0);

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
  /*
    What permanently covers the bottom of the terminal, and therefore comes out
    of the PTY's size.

    The dock when there is one, the safe area when there is not -- and never the
    keyboard. That last word is the deliberate part. The keyboard is up for as
    long as it takes to type one line, and sizing the PTY to it means a
    `SIGWINCH` and a full repaint on the way up and another on the way down,
    every line. The canvas absorbs it instead, by scrolling the tail clear of it
    (`keyboardOffset` on `SkiaTerminal`, which is how the gateway screen has
    always handled the same question). The dock and the safe area are different
    in kind: they are there for as long as the screen is, so a program painting
    behind them is painting where nobody will ever read.

    Read off `editorPane` rather than `dock.editorMode` because the grid is
    needed long before the dock's rule is evaluated -- and on this screen the
    two are the same answer, since no approval can stand on an SSH shell.
  */
  const bottomChrome = editorPane ? insets.bottom : dockHeight;
  // The canvas's own cell size, once it has measured its font. Until then the
  // advance ratio stands in; the first report re-sizes the grid once.
  const grid = useMemo(
    () =>
      viewport.width > 0 && viewport.height > 0
        ? terminalGridFor({
            width: viewport.width,
            height: Math.max(1, viewport.height - bottomChrome),
            fontSize,
            cellWidth: cellMetrics?.cellWidth,
            lineHeight: cellMetrics?.lineHeight,
            pixelRatio: PixelRatio.get(),
          })
        : TERMINAL_GRID_DEFAULT,
    [bottomChrome, cellMetrics, fontSize, viewport.height, viewport.width]
  );
  const gridRef = useLatestRef(grid);

  /**
   * The terminal's way to reach the shell with a finger.
   *
   * Held stable across renders, because the component mirrors it onto the UI
   * thread and a new object every render would mean a new mirror every render.
   * `send` is reached through a ref for the same reason -- it closes over the
   * connection status and is therefore a different function on each pass --
   * and it goes out with `stickBottom: false`, which is the whole reason
   * `send` grew an option: a wheel event is not a keystroke and must not haul
   * the reader to the bottom sixty times a second.
   */
  const sendRef = useLatestRef(send);
  const touchInputChannel = useMemo(
    () => ({
      modes: touchModes,
      rows: grid.rows,
      send: (bytes: Uint8Array) => sendRef.current(bytes, { stickBottom: false }),
    }),
    [grid.rows, sendRef, touchModes]
  );

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
      // Same reading, for the finger rather than for the chrome. Compared
      // before it is stored: these change a handful of times in a session --
      // once when vim starts, once when it exits -- and a fresh object on every
      // frame would re-render the whole screen at output rate.
      setTouchModes((previous) => terminalTouchModesOf(previous, terminal.modes));
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

  /**
   * Bytes to the shell.
   *
   * `stickBottom` is what a typed key wants and what a touch does not. Every
   * send used to snap the view to the newest line, which is right for a reader
   * who just pressed Enter and wrong sixty times a second: a drag translated
   * into wheel events would bump that counter on every frame of the drag, and
   * each bump is a state change through the whole screen. The program's own
   * repaint is what the reader is watching in that case, and it needs no help
   * from us to arrive.
   */
  function send(bytes: Uint8Array, options?: { stickBottom?: boolean }) {
    const shell = sessionRef.current.shell;
    if (!shell || status.phase !== 'connected') return;
    try {
      shell.write(bytes);
      if (options?.stickBottom !== false) setStickBottomNonce((value) => value + 1);
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

  /** The app's own keyboard, wherever it is standing: in the dock, or floating. */
  const virtualKeyboard = (
    <VirtualKeyboard
      disabled={!connected}
      onText={typeText}
      onKey={typeKey}
      onClose={() => setKeyboardMode(false)}
      shortcuts={dock.keysInKeyboard ? <View style={styles.keyRow}>{keyStrip}</View> : undefined}
    />
  );

  /** The way to the composer from a surface that has stood it down. */
  const composerEntry = (
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
  );

  const composer = (
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
        // Summoned into the editor panel, the field arrives *instead of* the
        // app's keyboard rather than on top of it, so a reader who had to tap
        // it before typing would have gained nothing by asking for it.
        autoFocus: dock.editorMode && composerRevealed,
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
  );

  /*
    What floats over an editor, in the order it is read from the top: the way to
    move it (the panel's own grip), the keys, and the input.

    The key row appears here only when the composer has taken the app's keyboard
    away -- the keys were riding inside it, and they are the reason the panel
    exists. Its toggle is the inverse of the pen: it puts the field away and
    brings the keyboard back, which on the dock is what closing the composer
    would do and here has to be a control of its own.
  */
  const editorPanelBody = (
    <>
      {dock.virtualKeyboard ? virtualKeyboard : null}
      {dock.keyRow ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOutDown('short')}
          style={styles.keyRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Back to the on-screen keyboard`}
            feedback="selection"
            pressedScale={0.9}
            onPress={() => {
              Keyboard.dismiss();
              setComposerRevealed(false);
            }}
            style={[styles.keyRowToggle, { backgroundColor: chromeGlass }]}>
            <KeyboardIcon size={16} color={theme.colors.primary} />
          </PressableScale>
          {keyStrip}
        </Animated.View>
      ) : null}
      {dock.composerEntry ? composerEntry : null}
      {dock.composer ? composer : null}
    </>
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
            // What the dock covers, so the canvas rests the live rows above it
            // rather than behind it. The box no longer shrinks for the dock, so
            // this is what replaces the height the dock used to take.
            bottomInset={bottomChrome}
            // And what the keyboard covers, on the UI thread, without anything
            // being re-laid-out for it. This is the gateway's answer to the
            // same question and it is the reason the PTY is never resized for
            // the phone's keyboard.
            keyboardOffset={keyboardHeight}
            // An editor's own colour scheme is drawn as it is rather than
            // resolved against the app theme -- the gateway's rule, on the
            // same predicate.
            ownsScreen={editorPane}
            // What turns a finger into the program's own input. The three-layer
            // rule and its argument are in `@/terminal/touch-input`; what this
            // screen contributes is the channel and the two facts the rule
            // needs -- what the program has asked for, and how many rows of the
            // frame are its live screen rather than the scrollback above it.
            touchInput={touchInputChannel}
          />
        </TerminalBoundary>
        {/*
          Inside the terminal's box and absolutely positioned within it, which
          is the whole of how this avoids resizing the grid: the box does not
          change, so `onLayout` above does not fire, so `reportViewport` is
          never called and the PTY is never told a new size. A dock could not
          be written this way -- a dock is height taken out of the terminal --
          which is why an editor gets this instead of a smaller dock.
        */}
        {dock.editorMode ? (
          <EditorControls
            expanded={dock.editorPanel}
            onExpand={openVirtualKeyboard}
            onCollapse={() => setKeyboardMode(false)}
            offset={editorControlsOffset}
            keyboardOffset={keyboardHeight}
            // The terminal's box runs to the bottom of the screen now that the
            // dock is out of its flow, so the safe area is the cluster's to
            // clear -- the same inset the grid already leaves nvim.
            bottomInset={insets.bottom}
            disabled={!connected}>
            {editorPanelBody}
          </EditorControls>
        ) : null}
      </View>

      {/*
        The dock, over the terminal rather than beside it.

        Absolutely positioned and translated by the keyboard, which is the
        gateway's shape and the whole of why this screen stopped re-laying the
        terminal out fifteen times per keyboard animation. Nothing here is in
        the terminal's flow; what it covers is accounted for by `bottomChrome`
        and `keyboardOffset` above.

        An editor has no dock at all -- what floats over one is `EditorControls`
        inside the terminal's own box, so that even the dock's absence costs the
        grid nothing beyond the single resize that giving nvim the screen is.
      */}
      {dock.editorMode ? null : (
        <Animated.View
          // Measured out here rather than on the glass: `GlassChrome` renders a
          // `GlassView`, a `BlurView` or a plain view depending on the platform
          // and only some of those pass `onLayout` through -- and this is the
          // box the terminal actually has to account for, padding included.
          onLayout={(event: LayoutChangeEvent) =>
            measureDockHeight(Math.ceil(event.nativeEvent.layout.height))
          }
          style={[styles.dockOverlay, dockKeyboardStyle]}>
          <GlassChrome style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            {dock.virtualKeyboard ? virtualKeyboard : null}
            {/* The way back to the composer without putting the keyboard away:
                one control in the corner where Send would be, as on the gateway. */}
            {dock.composerEntry ? composerEntry : null}
            {dock.keyRow ? (
              <View style={styles.keyRow}>
                {keyboardToggle}
                {keyStrip}
              </View>
            ) : null}
            {dock.composer ? composer : null}
          </GlassChrome>
        </Animated.View>
      )}

      {prompt && (prompt.kind === 'trust' || prompt.kind === 'mismatch') ? (
        <SshHostKeyDialog
          verdict={prompt.kind === 'mismatch' ? 'mismatch' : 'unknown'}
          presented={prompt.key}
          trusted={prompt.kind === 'mismatch' ? prompt.trusted : undefined}
          host={record.host}
          onResolve={prompt.resolve}
        />
      ) : null}
      {/* Mounted only while the server is asking, so the answers -- a
          password, a one-time code -- live in React state no longer than the
          dialog does. */}
      {prompt?.kind === 'keyboardInteractive' ? (
        <SshKeyboardInteractiveDialog challenge={prompt.challenge} onResolve={prompt.resolve} />
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
  /** The dock's layer: over the terminal, pinned to the bottom of the screen. */
  dockOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
