import { Trans, useLingui } from '@lingui/react/macro';
import { type Colors, useThemeTokens } from '@osuki-dev/ui';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';

import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';

import { stripAgentChrome } from '@/lib/agent-chrome';
import { isSafeExternalLink } from '@/lib/safe-link';
import {
  anchorAfterEarlierOutput,
  type TranscriptScrollPosition,
} from '@/lib/transcript-history-scroll';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PressableScale } from '@/components/pressable-scale';

const terminalControlPattern = /\u001B\[[0-?]*[ -/]*[@-~]/g;

/**
 * How long the view keeps waiting for a requested page to make the transcript
 * taller before it gives up and follows the latest output again. A load that
 * returned nothing earlier must not leave the view pinned.
 */
const EARLIER_ANCHOR_GRACE_MS = 1_500;

export function AgentMarkdownOutput({
  output,
  edgeToEdge = false,
  bottomInset = 0,
  canLoadEarlier = false,
  loadingEarlier = false,
  onLoadEarlier,
  stickBottomNonce = 0,
}: {
  output: string;
  edgeToEdge?: boolean;
  bottomInset?: number;
  /** Whether the pane has scrollback the gateway has not been asked for yet. */
  canLoadEarlier?: boolean;
  loadingEarlier?: boolean;
  /**
   * Loads the next page of earlier output. The same callback the terminal view
   * is given, so both views page through history by one path.
   */
  onLoadEarlier?: () => void;
  /**
   * Advanced once each time the reader sends something. The same nonce the grid
   * view is given, and for the same reason -- see the effect that reads it.
   */
  stickBottomNonce?: number;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const followOutput = useRef(true);
  const userScrolling = useRef(false);
  const scrollStartOffset = useRef(0);
  const scrollOffset = useRef(0);
  const contentHeight = useRef(0);
  // Where the reader was when they asked for earlier output, held until the
  // taller transcript has been measured.
  const anchorBeforeEarlier = useRef<TranscriptScrollPosition | null>(null);
  const [following, setFollowing] = useState(true);
  const markdown = useMemo(() => sanitizeAgentOutput(output), [output]);
  const markdownStyle = useMemo(() => createMarkdownStyle(theme.colors), [theme.colors]);
  // The spinner has to survive the request it started, so it stays while a load
  // is in flight even once the gateway says there is nothing more to fetch.
  const pullEnabled = Boolean(onLoadEarlier) && (canLoadEarlier || loadingEarlier);

  useEffect(() => {
    if (!followOutput.current) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
    const timer = setTimeout(() => {
      if (followOutput.current) scrollRef.current?.scrollToEnd({ animated: false });
    }, 180);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [bottomInset, markdown]);

  // Sending is the reader asking to watch the answer, so it re-arms following.
  //
  // Scrolling toward older output turns following off, and until this landed
  // nothing here turned it back on except the Latest button: a reader who
  // scrolled up to check something and then sent a prompt watched the
  // transcript sit exactly where it was while the agent replied off-screen. The
  // grid view has answered the send since the nonce was introduced -- this is
  // the same nonce and the same rule, and the two views should not disagree
  // about where a send leaves the reader.
  //
  // The ref pins the effect to the nonce actually advancing. `markdown` ticks on
  // every streamed frame, and re-running the body on those would haul a reader
  // who had deliberately scrolled into history back to the bottom -- the exact
  // behaviour the follow flag exists to prevent. The send is the event; nothing
  // else here is.
  const stickBottomHandled = useRef(stickBottomNonce);
  useEffect(() => {
    if (stickBottomNonce <= 0 || stickBottomNonce === stickBottomHandled.current) return;
    stickBottomHandled.current = stickBottomNonce;
    setFollowOutput(true);
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [stickBottomNonce]);

  // A request that ended without adding anything -- a failure, or a pane that
  // had less history than the gateway advertised -- would otherwise hold the
  // anchor forever and stop the transcript following new output.
  useEffect(() => {
    if (loadingEarlier || !anchorBeforeEarlier.current) return;
    const timer = setTimeout(() => {
      anchorBeforeEarlier.current = null;
    }, EARLIER_ANCHOR_GRACE_MS);
    return () => clearTimeout(timer);
  }, [loadingEarlier, markdown]);

  function requestEarlierOutput() {
    if (!onLoadEarlier || loadingEarlier) return;
    anchorBeforeEarlier.current = {
      contentHeight: contentHeight.current,
      // iOS reports past the top edge while the pull is held; the reader's place
      // is the top of the transcript, not how far they dragged beyond it.
      offset: Math.max(0, scrollOffset.current),
    };
    onLoadEarlier();
  }

  /**
   * Puts the reader back where they were once the taller transcript has been
   * laid out. Returns whether it handled this measurement, so the caller knows
   * not to also jump to the bottom.
   */
  function restoreEarlierAnchor(nextContentHeight: number): boolean {
    const before = anchorBeforeEarlier.current;
    if (!before) return false;
    const target = anchorAfterEarlierOutput(before, nextContentHeight);
    // Still the pre-load height: the new page has not been measured yet, so
    // keep waiting rather than scrolling to a position based on stale numbers.
    if (target === null) return true;
    anchorBeforeEarlier.current = null;
    scrollRef.current?.scrollTo({ y: target, animated: false });
    return true;
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>, force = false) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollOffset.current = contentOffset.y;
    if (!userScrolling.current) return;
    const delta = contentOffset.y - scrollStartOffset.current;
    if (!force && Math.abs(delta) < 2) return;
    // Moving toward older output always pauses following, even when the drag
    // starts only a few pixels above the bottom edge.
    if (delta < -2) {
      setFollowOutput(false);
      return;
    }
    if (delta > 2) {
      setFollowOutput(contentSize.height - contentOffset.y - layoutMeasurement.height < 32);
    }
  }

  function setFollowOutput(value: boolean) {
    followOutput.current = value;
    setFollowing((current) => (current === value ? current : value));
  }

  function jumpToLatest() {
    setFollowOutput(true);
    scrollRef.current?.scrollToEnd({ animated: true });
  }

  return (
    <View
      style={[
        styles.shell,
        { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
        edgeToEdge ? styles.edgeToEdge : null,
      ]}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        // Lets the transcript scroll clear of the keyboard, so the latest output
        // stays reachable while a reply is being typed.
        bottomOffset={24}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 12 + bottomInset }]}
        keyboardShouldPersistTaps="handled"
        // A terminal has no scrollbar; the "jump to latest" pill already says
        // when you are away from the bottom.
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={(event) => {
          userScrolling.current = true;
          scrollStartOffset.current = event.nativeEvent.contentOffset.y;
          setFollowOutput(false);
        }}
        onScrollEndDrag={(event) => {
          handleScroll(event, true);
          userScrolling.current = false;
        }}
        onMomentumScrollBegin={(event) => {
          userScrolling.current = true;
          scrollStartOffset.current = event.nativeEvent.contentOffset.y;
        }}
        onMomentumScrollEnd={(event) => {
          handleScroll(event, true);
          userScrolling.current = false;
        }}
        onScroll={handleScroll}
        scrollEventThrottle={80}
        refreshControl={
          pullEnabled ? (
            <RefreshControl
              refreshing={loadingEarlier}
              onRefresh={requestEarlierOutput}
              progressViewOffset={8}
              colors={[theme.colors.primary]}
              tintColor={theme.colors.textMuted}
              progressBackgroundColor={theme.colors.surfaceRaised}
            />
          ) : undefined
        }
        onContentSizeChange={(_width, height) => {
          contentHeight.current = height;
          if (restoreEarlierAnchor(height)) return;
          if (followOutput.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}>
        {markdown ? (
          <EnrichedMarkdownText
            flavor="commonmark"
            markdown={markdown}
            markdownStyle={markdownStyle}
            containerStyle={styles.markdown}
            selectable
            selectionColor={theme.colors.primarySubtle}
            selectionHandleColor={theme.colors.primary}
            streamingAnimation={false}
            textBreakStrategy="simple"
            md4cFlags={{ latexMath: true }}
            onLayout={() => {
              if (followOutput.current) scrollRef.current?.scrollToEnd({ animated: false });
            }}
            onLinkPress={({ url }) => {
              if (isSafeExternalLink(url)) void Linking.openURL(url);
            }}
          />
        ) : (
          <Text selectable style={[styles.empty, { color: theme.colors.textSubtle }]}>
            <Trans>Waiting for output…</Trans>
          </Text>
        )}
      </KeyboardAwareScrollView>
      {!following ? (
        <PressableScale
          accessibilityLabel={t`Jump to latest output`}
          onPress={jumpToLatest}
          style={[
            styles.latestButton,
            {
              bottom: 14 + bottomInset,
              backgroundColor: theme.colors.surfaceRaised,
              borderColor: theme.colors.border,
            },
          ]}>
          <Text style={[styles.latestButtonText, { color: theme.colors.text }]}>
            ↓ <Trans>Latest</Trans>
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

export function sanitizeAgentOutput(input: string): string {
  const value = input
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(terminalControlPattern, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(
      /[\uE000-\uF8FF]|[\u{1FB00}-\u{1FBFF}]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/gu,
      '◆'
    )
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  return linkifyAgentUrls(normalizeAgentTranscript(stripAgentChrome(value)).trim());
}

export function linkifyAgentUrls(markdown: string): string {
  let fenced = false;

  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(?:```|~~~)/u.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;

      return line.replace(/https?:\/\/[^\s<>"'`]+/giu, (match, offset: number) => {
        const before = line.slice(0, offset);
        const lastOpenBracket = before.lastIndexOf('[');
        const lastCloseBracket = before.lastIndexOf(']');
        const insideMarkdownLabel = lastOpenBracket > lastCloseBracket;
        const insideMarkdownDestination = before.endsWith('](');
        const insideAutolink = before.endsWith('<');
        const insideInlineCode = (before.match(/(?<!\\)`/gu)?.length ?? 0) % 2 === 1;
        if (
          insideMarkdownLabel ||
          insideMarkdownDestination ||
          insideAutolink ||
          insideInlineCode
        ) {
          return match;
        }

        const uri = trimAgentUri(match);
        if (!uri) return match;
        const trailing = match.slice(uri.length);
        return `[${uri}](${uri})${trailing}`;
      });
    })
    .join('\n');
}

function trimAgentUri(value: string): string {
  let result = value.replace(/[.,;:!?]+$/gu, '');
  while (result.endsWith(')')) {
    const openCount = (result.match(/\(/gu) ?? []).length;
    const closeCount = (result.match(/\)/gu) ?? []).length;
    if (closeCount <= openCount) break;
    result = result.slice(0, -1);
  }
  return result;
}

type TranscriptLine = {
  text: string;
  continuation: boolean;
  mode: 'agent' | 'prompt' | 'terminal';
};

function normalizeAgentTranscript(input: string): string {
  const rawLines = input.split('\n');
  const frameWidths = rawLines
    .filter((line) => /^[╭╰┌└─━═]{8}/u.test(line.trimStart()))
    .map(displayWidth);
  const terminalWidth = Math.max(32, ...frameWidths);
  const lines: TranscriptLine[] = [];
  let mode: TranscriptLine['mode'] = 'terminal';

  for (const rawLine of rawLines) {
    if (rawLine.startsWith('• ')) {
      mode = 'agent';
      lines.push({ text: rawLine.slice(2), continuation: false, mode });
      continue;
    }
    if (rawLine.startsWith('› ')) {
      mode = 'prompt';
      lines.push({ text: rawLine, continuation: false, mode });
      continue;
    }

    if (mode === 'agent' && rawLine.startsWith('  ')) {
      lines.push({ text: rawLine.slice(2), continuation: true, mode });
      continue;
    }
    if (mode === 'prompt' && rawLine.startsWith('  ')) {
      lines.push({ text: rawLine, continuation: true, mode });
      continue;
    }

    if (rawLine && !/^\s/u.test(rawLine)) mode = 'terminal';
    lines.push({ text: rawLine, continuation: false, mode });
  }

  const result: TranscriptLine[] = [];
  for (const line of lines) {
    const previous = result.at(-1);
    const trimmed = line.text.trimStart();
    const startsMarkdownBlock = /^(?:[-*+]\s|#{1,6}\s|>\s|```|~~~)/u.test(trimmed);
    const shouldJoin =
      previous &&
      line.continuation &&
      line.mode === previous.mode &&
      previous.text.trim().length > 0 &&
      displayWidth(previous.text) >= terminalWidth - 8 &&
      !startsMarkdownBlock;

    if (shouldJoin) {
      const previousText = previous.text.trimEnd();
      const continuesPath =
        /(?:[a-z][a-z0-9+.-]*:\/\/|\/)\S*$/iu.test(previousText) &&
        /^[\p{L}\p{N}._/-]+/u.test(trimmed);
      const separator = /[-/._]$/u.test(previousText) || continuesPath ? '' : ' ';
      previous.text = `${previousText}${separator}${trimmed}`;
    } else {
      result.push({ ...line });
    }
  }

  return result.map((line) => line.text).join('\n');
}

function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    width +=
      /[\u1100-\u115F\u2329\u232A\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/u.test(
        character
      )
        ? 2
        : 1;
  }
  return width;
}

/**
 * The app's one markdown theme. Shared with the asset viewer so a document read
 * from a file looks the same as the transcript it was mentioned in.
 */
export function createMarkdownStyle(colors: Colors): MarkdownStyle {
  const text = colors.text;
  const muted = colors.textMuted;
  const border = colors.border;
  const codeBackground = colors.surfaceRaised;
  const quoteBackground = colors.primarySubtle;
  const link = colors.info;
  const base = {
    color: text,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 0,
    marginBottom: 10,
  };

  return {
    paragraph: base,
    h1: { ...base, fontSize: 22, lineHeight: 28, fontWeight: '700', marginTop: 8 },
    h2: { ...base, fontSize: 19, lineHeight: 25, fontWeight: '700', marginTop: 8 },
    h3: { ...base, fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: 6 },
    h4: { ...base, fontWeight: '700', marginTop: 4 },
    h5: { ...base, fontWeight: '700', marginTop: 4 },
    h6: { ...base, color: muted, fontWeight: '700', marginTop: 4 },
    strong: { color: text },
    em: { color: text },
    link: { color: link, underline: false },
    list: {
      ...base,
      bulletColor: link,
      markerColor: muted,
      markerMinWidth: 20,
      gapWidth: 6,
      marginLeft: 2,
    },
    blockquote: {
      ...base,
      color: muted,
      borderColor: link,
      borderWidth: 3,
      gapWidth: 10,
      backgroundColor: quoteBackground,
    },
    code: {
      fontFamily: 'monospace',
      fontSize: 13,
      color: link,
      backgroundColor: codeBackground,
      borderColor: border,
    },
    codeBlock: {
      color: text,
      fontFamily: 'monospace',
      fontSize: 12.5,
      lineHeight: 18,
      backgroundColor: codeBackground,
      borderColor: border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      padding: 12,
      marginTop: 2,
      marginBottom: 12,
    },
    thematicBreak: { color: border, height: StyleSheet.hairlineWidth, marginBottom: 12 },
    table: {
      ...base,
      borderColor: border,
      // A hairline disappears on the emulator and the cells read as one blob;
      // a full pixel keeps the grid visible at every density.
      borderWidth: 1,
      borderRadius: 10,
      headerBackgroundColor: codeBackground,
      headerTextColor: text,
      rowEvenBackgroundColor: codeBackground,
      rowOddBackgroundColor: colors.surface,
      cellPaddingHorizontal: 12,
      cellPaddingVertical: 8,
    },
    taskList: {
      checkedColor: link,
      borderColor: border,
      checkmarkColor: colors.onPrimary,
      checkedTextColor: muted,
    },
  };
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: '100%',
    minHeight: 280,
    overflow: 'hidden',
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  edgeToEdge: {
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderRadius: 0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  markdown: {
    width: '100%',
  },
  empty: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: 18,
  },
  latestButton: {
    position: 'absolute',
    right: 14,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  latestButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});
