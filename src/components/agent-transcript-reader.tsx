import { useLingui } from '@lingui/react/macro';
import type { LegendListRef } from '@legendapp/list/react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { useReducedMotion, type SharedValue } from 'react-native-reanimated';

import { AgentTranscriptList } from '@/components/agent-transcript-list';
import { JumpToLatestPill } from '@/components/jump-to-latest-pill';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { useAppActive } from '@/hooks/use-app-active';
import { useStableHandler } from '@/hooks/use-render-refs';
import {
  createTranscriptReader,
  INITIAL_TRANSCRIPT_STATE,
  type TranscriptReader,
  type TranscriptReaderState,
  type TranscriptRoute,
} from '@/lib/agent-transcripts';
import { agentTranscriptSource } from '@/lib/agent-transcripts-client';
import { calmFadeIn, fadeIn } from '@/lib/motion';
import { createTranscriptFollow } from '@/lib/transcript-follow';
import { TRANSCRIPT_ESTIMATED_ITEM_SIZE } from '@/lib/transcript-sizing';
import { createAgentTranscriptStore } from '@/stores/agent-transcript';

/**
 * A terminal agent's conversation, read from the transcript the Gateway
 * serves for it (`agent_transcripts_v1`): the session screen's own rows, read
 * only. It opens on the newest page, reads older pages as the reader nears
 * the top, and probes the head while it is on screen so new entries land
 * under the reader without moving them -- the list holds its place and the
 * session screen's "Latest" brings them down.
 *
 * Nothing here sends: replies go to the pane, as they do without this view.
 */

/** How often an open reader asks whether the transcript grew. */
const HEAD_POLL_MS = 4_000;
/** How soon after a pane's output a nudged reader asks. */
const NUDGE_DELAY_MS = 600;
/** Room the "older" spinner keeps above the first row, so it never pushes it. */
const OLDER_ROW_HEIGHT = 32;
/** How near the top, in viewports, starts the next older page. */
const OLDER_THRESHOLD = 0.75;
const MAINTAIN_POSITION = { data: true, size: true } as const;
const doNothing = () => {};

export function AgentTranscriptReader({
  serverId,
  agent,
  sessionId,
  cwd,
  active = true,
  nudge = 0,
  testID = 'agent-transcript-reader',
  topInset = 0,
  bottomInset = 0,
  renderScrollComponent,
  scrollEnabled = true,
  nestedScrollEnabled = false,
  atTop,
}: TranscriptRoute & {
  serverId: string;
  /** Probe the head while true: the view is on screen and the app is in front. */
  active?: boolean;
  /** A change here asks for the head soon: the pane printed something. */
  nudge?: number;
  testID?: string;
  topInset?: number;
  bottomInset?: number;
  renderScrollComponent?: (props: ScrollViewProps) => ReactElement<ScrollViewProps>;
  scrollEnabled?: boolean;
  nestedScrollEnabled?: boolean;
  /** Written as the list reaches or leaves its top, for a sheet that drags from there. */
  atTop?: SharedValue<boolean>;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const appActive = useAppActive();
  const markdownStyle = usePaneChatMarkdownStyle();
  const [store] = useState(createAgentTranscriptStore);
  const [follow] = useState(createTranscriptFollow);
  const [state, setState] = useState<TranscriptReaderState>(INITIAL_TRANSCRIPT_STATE);
  const [reader, setReader] = useState<TranscriptReader | null>(null);
  const listRef = useRef<LegendListRef>(null);

  useEffect(() => {
    const transcript = store.getState();
    transcript.configure({ windowStart: 0, status: undefined });
    const next = createTranscriptReader(
      agentTranscriptSource(serverId, { agent, sessionId, cwd }),
      (published) => {
        transcript.setTimeline(published.items, 0);
        setState(published);
      }
    );
    setReader(next);
    void next.open();
    return () => {
      next.dispose();
      setReader(null);
      setState(INITIAL_TRANSCRIPT_STATE);
      transcript.setTimeline([], 0);
    };
  }, [serverId, agent, sessionId, cwd, store]);

  useEffect(() => {
    const mark = () => {
      const timeline = store.getState().timeline;
      follow.setMark({ rows: timeline.length, seq: timeline.at(-1)?.seq ?? 0 });
    };
    mark();
    return store.subscribe(mark);
  }, [store, follow]);

  // The head poll, only while there is something to poll for and someone to
  // see it; a pane's own output asks sooner than the next tick.
  const polling = active && appActive && state.loaded && !state.missing;
  useEffect(() => {
    if (!polling || !reader) return;
    const timer = setInterval(() => void reader.check(), HEAD_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, reader]);
  useEffect(() => {
    if (!polling || !reader || nudge === 0) return;
    const timer = setTimeout(() => void reader.check(), NUDGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [polling, reader, nudge]);

  const loadOlder = useStableHandler(() => {
    void reader?.loadOlder();
  });
  const onScroll = useStableHandler((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    // The top of what is loaded is not the top of the conversation while
    // older pages remain: a pull there asks for them, it does not close the
    // drawer that holds the list.
    atTop?.set(contentOffset.y <= 1 && !state.hasMore);
    if (contentSize.height <= 0) return;
    follow.setGeometry({
      offset: contentOffset.y,
      viewport: layoutMeasurement.height,
      content: contentSize.height,
    });
  });

  const rowProps = useMemo(
    () => ({
      showReasoning: true,
      markdownStyle,
      onPreviewImage: doNothing,
      onEditQueued: doNothing,
      onCancelQueued: doNothing,
      readOnly: true,
    }),
    [markdownStyle]
  );
  const maintainEnd = useMemo(() => ({ animated: !reduced }), [reduced]);
  const contentStyle = useMemo(
    () => [styles.content, { paddingTop: topInset + 4, paddingBottom: bottomInset + 12 }],
    [topInset, bottomInset]
  );
  const enteringFade = reduced ? calmFadeIn() : fadeIn('short');

  if (!state.loaded)
    return (
      <View testID={`${testID}-loading`} style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  if (state.missing || (state.failed && state.items.length === 0))
    return (
      <Animated.View
        testID={`${testID}-unavailable`}
        entering={enteringFade}
        style={[styles.center, { paddingTop: topInset }]}>
        <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centerText}>
          {state.missing
            ? t`No conversation has been recorded for this pane yet.`
            : t`Could not read the conversation.`}
        </Text>
      </Animated.View>
    );
  return (
    <Animated.View entering={enteringFade} style={styles.fill}>
      <AgentTranscriptList
        ref={listRef}
        keyboardAware={false}
        nestedScrollEnabled={nestedScrollEnabled}
        renderScrollComponent={renderScrollComponent}
        scrollEnabled={scrollEnabled}
        bounces={false}
        overScrollMode="never"
        testID={testID}
        store={store}
        rowProps={rowProps}
        dataKey={`${agent}:${sessionId}`}
        estimatedItemSize={TRANSCRIPT_ESTIMATED_ITEM_SIZE}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainVisibleContentPosition={MAINTAIN_POSITION}
        maintainScrollAtEnd={maintainEnd}
        maintainScrollAtEndThreshold={0.1}
        onStartReached={state.hasMore && !state.loadingOlder ? loadOlder : undefined}
        onStartReachedThreshold={OLDER_THRESHOLD}
        onScroll={onScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          state.hasMore ? (
            <View style={styles.older}>
              {state.loadingOlder ? (
                <ActivityIndicator size="small" color={theme.colors.textMuted} />
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="bodySmall" color={theme.colors.textMuted}>
              {t`No conversation yet.`}
            </Text>
          </View>
        }
        style={styles.fill}
        contentContainerStyle={contentStyle}
      />
      <JumpToLatestPill
        testID={`${testID}-latest`}
        follow={follow}
        enabled
        bottom={bottomInset + 12}
        onPress={() => {
          follow.reset();
          void listRef.current?.scrollToEnd({ animated: false });
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  centerText: { textAlign: 'center' },
  empty: { paddingVertical: 24, alignItems: 'center' },
  older: { height: OLDER_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16 },
});
