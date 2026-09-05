import { useEffect, useRef } from 'react';
import { type SharedValue } from 'react-native-reanimated';

import { SkiaTerminal } from '@/components/skia-terminal';
import { zoomPane } from '@/lib/gateway-client';
import type { TabCycleDirection } from '@/lib/tab-swipe';
import type { TerminalTextSize } from '@/lib/terminal-text-size';

/**
 * The pane's grid, plus the one thing the screen above it should not have to
 * remember: a pane is zoomed at the gateway before it is read.
 *
 * This used to be a fork. `mode` chose between the grid and a reflowed markdown
 * reading of the same output, and the two cross-faded because swapping the whole
 * surface between two frames said nothing about them being one pane. Card #841
 * removed the reflowed reading -- the quick actions row was the only switch that
 * ever reached it -- so there is one surface, no fork, and nothing to dissolve
 * between. The wrapper stays: the zoom effect is its own reason to exist, and
 * moving it into `SkiaTerminal` would tie a gateway call to a canvas.
 */
export function TerminalPanel({
  sessionId,
  paneId,
  output,
  bottomInset = 0,
  topInset = 0,
  keyboardOffset,
  textSize,
  screenRows = 0,
  ownsScreen = false,
  canLoadEarlier = false,
  historyRevision = 0,
  loadingEarlier = false,
  onLoadEarlier,
  onViewportReady,
  historyIndicatorTopInset = 10,
  stickBottomNonce = 0,
  onFileLink,
  onTwoFingerSwipe,
  screenFocused,
  paneColumns,
  paneRows,
  paneCursorColumn,
  paneCursorRow,
}: {
  sessionId: string;
  paneId: string;
  output: string;
  bottomInset?: number;
  /**
   * Clearance for the floating header, for a pane running a full-screen program.
   * A pane that prints lines has nothing at its top worth seeing. An editor does.
   */
  topInset?: number;
  keyboardOffset?: SharedValue<number>;
  /** The Text size setting, which is the only default the terminal has. */
  textSize?: TerminalTextSize;
  /**
   * The pane's own viewport rows, so the grid can tell the live screen at the
   * tail of the window from the ring-buffer history above it. 0 means unknown.
   */
  screenRows?: number;
  /**
   * Whether the pane's program owns the whole screen. The grid stops resolving
   * such a pane's default colours against the app theme; see `terminalPaneTheme`.
   */
  ownsScreen?: boolean;
  canLoadEarlier?: boolean;
  historyRevision?: number;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  onViewportReady?: () => void;
  historyIndicatorTopInset?: number;
  stickBottomNonce?: number;
  /** A file path tapped in the output, for the screen to open as an artifact. */
  onFileLink?: (path: string) => void;
  /**
   * A two-finger swipe across the grid, which the screen answers by cycling the
   * workspace's tabs. Recognised by the canvas itself rather than by React
   * Native's touches -- see `useTabSwipe`.
   */
  onTwoFingerSwipe?: (direction: TabCycleDirection) => void;
  /** False while the screen this pane is on is not the one in front. */
  screenFocused?: boolean;
  /** The pane's own width, off the gateway record; see `SkiaTerminal`. */
  paneColumns?: number;
  /** The pane's own height, off the same record. Absent on an older gateway. */
  paneRows?: number;
  /** The program's cursor, when the gateway reports one. See `terminalOpenView`. */
  paneCursorColumn?: number;
  paneCursorRow?: number;
}) {
  // Kept in a ref so a new callback identity (it changes whenever the parent's
  // connection/output deps do) does not re-run the effect and re-POST zoom on
  // nearly every render. Zoom should fire once per pane, not per render.
  const onViewportReadyRef = useRef(onViewportReady);
  useEffect(() => {
    onViewportReadyRef.current = onViewportReady;
  }, [onViewportReady]);

  useEffect(() => {
    if (!paneId) return;
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    void zoomPane(sessionId, paneId, 'on')
      .then(() => {
        if (!active) return;
        refreshTimer = setTimeout(() => onViewportReadyRef.current?.(), 180);
      })
      .catch(() => {
        // Older gateways do not expose pane zoom. Output remains usable and the
        // normal refresh path will surface real read failures.
      });

    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [paneId, sessionId]);

  return (
    <SkiaTerminal
      output={output}
      terminalId={paneId}
      bottomInset={bottomInset}
      topInset={topInset}
      keyboardOffset={keyboardOffset}
      textSize={textSize}
      screenRows={screenRows}
      ownsScreen={ownsScreen}
      canLoadEarlier={canLoadEarlier}
      historyRevision={historyRevision}
      loadingEarlier={loadingEarlier}
      onLoadEarlier={onLoadEarlier}
      historyIndicatorTopInset={historyIndicatorTopInset}
      stickBottomNonce={stickBottomNonce}
      onFileLink={onFileLink}
      onTwoFingerSwipe={onTwoFingerSwipe}
      screenFocused={screenFocused}
      paneColumns={paneColumns}
      paneRows={paneRows}
      paneCursorColumn={paneCursorColumn}
      paneCursorRow={paneCursorRow}
    />
  );
}
