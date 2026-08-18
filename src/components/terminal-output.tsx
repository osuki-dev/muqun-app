import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { AgentMarkdownOutput } from '@/components/agent-markdown-output';
import { SkiaTerminal } from '@/components/skia-terminal';
import { zoomPane } from '@/lib/gateway-client';
import { fadeIn, fadeOut } from '@/lib/motion';
import type { TabCycleDirection } from '@/lib/tab-swipe';
import type { TerminalTextSize } from '@/lib/terminal-text-size';

export function TerminalPanel({
  sessionId,
  paneId,
  output,
  mode,
  edgeToEdge = false,
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
}: {
  sessionId: string;
  paneId: string;
  output: string;
  mode: 'terminal' | 'agent';
  edgeToEdge?: boolean;
  bottomInset?: number;
  /**
   * Clearance for the floating header, for a pane running a full-screen program.
   * The reading view has always had one; the grid did not, because a pane that
   * prints lines has nothing at its top worth seeing. An editor does.
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
   * workspace's tabs. Only the grid recognises it: the reading view is a scroll
   * view of its own and a second gesture over it would fight the scroll.
   */
  onTwoFingerSwipe?: (direction: TabCycleDirection) => void;
  /** False while the screen this pane is on is not the one in front. */
  screenFocused?: boolean;
  /** The pane's own width, off the gateway record; see `SkiaTerminal`. */
  paneColumns?: number;
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

  // The grid and the reading view are two readings of the *same* pane, and
  // choosing between them used to replace the entire surface between two
  // frames -- the whole screen changing at once, with nothing to say the two
  // pictures were of one thing.
  //
  // So they cross-fade, on `medium`: one surface replacing another is exactly
  // what that token is for, and it is long enough to be read as a dissolve
  // rather than as a repaint.
  //
  // Both halves are `absoluteFill` inside a flex parent rather than flexed
  // themselves. Reanimated keeps the outgoing view in the native tree for the
  // length of its exit, pinned where it last was; giving both the same absolute
  // box is what guarantees the two pictures are registered on top of each other
  // for that time rather than the incoming one laying itself out against a
  // parent the outgoing one is no longer contributing to.
  //
  // Keyed, because the two branches are different components in the same slot
  // and React would otherwise be free to reconcile one into the other and fire
  // neither animation.
  return (
    <View style={styles.root}>
      {mode === 'agent' ? (
        <Animated.View
          key="agent"
          style={StyleSheet.absoluteFill}
          entering={fadeIn('medium')}
          exiting={fadeOut('medium')}
        >
          {/* The reading view pages through history on the same callback the
              grid does; only the gesture that asks for it differs. */}
          <AgentMarkdownOutput
            output={output}
            edgeToEdge={edgeToEdge}
            bottomInset={bottomInset}
            canLoadEarlier={canLoadEarlier}
            loadingEarlier={loadingEarlier}
            onLoadEarlier={onLoadEarlier}
            stickBottomNonce={stickBottomNonce}
          />
        </Animated.View>
      ) : (
        <Animated.View
          key="terminal"
          style={StyleSheet.absoluteFill}
          entering={fadeIn('medium')}
          exiting={fadeOut('medium')}
        >
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
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
