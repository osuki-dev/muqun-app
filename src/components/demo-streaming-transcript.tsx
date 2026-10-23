import { useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from 'expo-router';
import { RefreshIcon } from '@/icons';
import { useThemeTokens } from '@osuki-dev/ui';
import { AgentTranscriptList } from '@/components/agent-transcript-list';
import { sideInsetPadding } from '@/hooks/use-side-insets';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { SheetScene, SheetSceneQuietControl, sheetSceneStyles } from '@/components/sheet-scene';
import { TRANSCRIPT_ROW_GAP } from '@/components/agent-message-block';
import { createAgentTranscriptStore } from '@/stores/agent-transcript';
import { DEMO_STREAMING_MARKDOWN, demoStreamingTimeline } from '@/lib/demo-gateway';
import type { LegendListRef } from '@legendapp/list/react-native';

const doNothing = () => {};
/** Demo-only source for a real list and native renderer; no gateway mutation or stream. */
export function DemoStreamingTranscript() {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const markdownStyle = usePaneChatMarkdownStyle();
  const [store] = useState(() => {
    const initial = createAgentTranscriptStore();
    initial.getState().configure({ windowStart: 0, status: 'busy' });
    initial.getState().setTimeline(demoStreamingTimeline(0), 0);
    return initial;
  });
  const [run, setRun] = useState(0);
  const list = useRef<LegendListRef>(null);
  const maintainEnd = useMemo(() => ({ animated: !reducedMotion }), [reducedMotion]);
  const rowProps = useMemo(
    () => ({
      showReasoning: false,
      markdownStyle,
      onPreviewImage: doNothing,
      onEditQueued: doNothing,
      onCancelQueued: doNothing,
    }),
    [markdownStyle]
  );
  useEffect(() => {
    if (!focused) return;
    let characters = 0;
    const transcript = store.getState();
    transcript.configure({ windowStart: 0, status: 'busy' });
    transcript.setTimeline(demoStreamingTimeline(0), 0);
    const timer = setInterval(() => {
      characters = Math.min(characters + 20, DEMO_STREAMING_MARKDOWN.length);
      store.getState().setTimeline(demoStreamingTimeline(characters));
      if (characters === DEMO_STREAMING_MARKDOWN.length) {
        store.getState().configure({ windowStart: 0, status: 'idle' });
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [focused, run, store]);
  return (
    <SheetScene
      testID="demo-streaming-transcript"
      topInset={insets.top}
      title={t`Subagent`}
      caption="Streaming Markdown · Offline demo"
      headingTrailing={
        <SheetSceneQuietControl
          testID="demo-stream-restart"
          accessibilityLabel={t`Refresh`}
          onPress={() => {
            setRun((value) => value + 1);
            void list.current?.scrollToEnd({ animated: false });
          }}>
          <RefreshIcon size={17} color={colors.textMuted} />
        </SheetSceneQuietControl>
      }>
      <AgentTranscriptList
        ref={list}
        store={store}
        rowProps={rowProps}
        keyboardAware={false}
        nestedScrollEnabled
        testID="demo-streaming-list"
        dataKey="demo-streaming-markdown"
        initialScrollAtEnd
        alignItemsAtEnd
        maintainVisibleContentPosition={MAINTAIN_POSITION}
        maintainScrollAtEnd={maintainEnd}
        maintainScrollAtEndThreshold={0.1}
        showsVerticalScrollIndicator={false}
        style={sheetSceneStyles.scroller}
        contentContainerStyle={[
          styles.content,
          sideInsetPadding(insets, CONTENT_GUTTER),
          { paddingBottom: insets.bottom + 32 },
        ]}
      />
    </SheetScene>
  );
}
/** The rows' gutter, from the safe edges. */
const CONTENT_GUTTER = 20;
const MAINTAIN_POSITION = { data: true, size: true } as const;
const styles = StyleSheet.create({
  content: { paddingTop: 8, gap: TRANSCRIPT_ROW_GAP },
});
