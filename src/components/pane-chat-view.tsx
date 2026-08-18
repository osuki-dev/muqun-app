import { Trans, useLingui } from '@lingui/react/macro';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { Skeleton, Text, useThemeTokens } from '@osuki-dev/ui';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react-native';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  PaneChatActivityRow,
  PaneChatLabelRow,
  PaneChatPartRow,
  PaneChatPromptRow,
  usePaneChatColors,
  usePaneChatMarkdownStyle,
} from '@/components/pane-chat-blocks';
import { PressableScale } from '@/components/pressable-scale';
import { buildPaneChatItems, type PaneChatDetail, type PaneChatItem } from '@/lib/pane-chat';
import { fadeIn, fadeOut } from '@/lib/motion';
import type { PanePart } from '@/lib/pane-parts';

/**
 * The chat view of a pane: the gateway's normalized transcript, laid out as the
 * conversation it is rather than as a screen of terminal cells.
 *
 * Everything about this component is arranged around one fact -- an agent pane
 * streams, and the gateway answers with the whole transcript every time:
 *
 * - The rows are virtualized, so a thousand-part transcript mounts a screenful.
 * - The rows come from `buildPaneChatItems`, which returns the same objects for
 *   rows that have not changed, so a poll that appended one line re-renders one
 *   row instead of the list.
 * - A collapsed run of tool calls is one row that renders one line. Its cards
 *   are not built until it is opened, which is why the simplified view is the
 *   default: it is both the quieter reading and the cheaper one.
 * - Only the tail is read. Earlier history is a pull away, and it arrives as a
 *   *replacement* transcript rather than as a prepended slice: a part is a claim
 *   about a span of source rows, so two windows cannot be stitched.
 *
 * That last point used to be handled here by hand -- remember the height, wait
 * for the taller list, scroll by the difference, and time out if the page came
 * back empty -- against a number the list itself was making up. Under
 * virtualization the content height is a sum of *estimates* for every row that
 * has not been measured yet, and it moves as they are, so anchoring on how much
 * it grew was arithmetic on a moving target. The list is now Legend List, and
 * both behaviours are its own: `maintainVisibleContentPosition` holds the
 * reader's place across a change of data, and `maintainScrollAtEnd` follows the
 * newest row for as long as the reader is near it.
 */
const EMPTY_EXPANDED: ReadonlySet<string> = new Set<string>();

/**
 * The starting guess for a row's height, in points, before any have been
 * measured. Only a seed: `getItemType` below hands the list a type per row, and
 * it keeps a running average per type, so the guess that matters -- the one used
 * for the rows above the viewport when a page of history lands -- is measured
 * rather than declared.
 *
 * Deliberately near the small end. A prompt bubble and a folded run of tool
 * calls are both around forty points and are most of a transcript by count; the
 * paragraphs are taller but far fewer. Guessing high is the worse mistake, since
 * an over-estimate on the rows being prepended is what makes the list jump.
 */
const ESTIMATED_ROW_HEIGHT = 44;

/**
 * How near the newest row counts as "following it", as a fraction of the
 * viewport. The library's own default; named here because the behaviour it
 * controls is one this view used to implement itself, with 48 points.
 */
const FOLLOW_THRESHOLD = 0.1;

export const PaneChatView = memo(function PaneChatView({
  parts,
  detail,
  bottomInset = 0,
  topInset = 0,
  canLoadEarlier = false,
  loadingEarlier = false,
  awaitingFirstParts = false,
  onLoadEarlier,
  onOpenAsset,
  onToggleDetail,
}: {
  parts: PanePart[];
  /** `simplified` folds every run of tool calls away. */
  detail: PaneChatDetail;
  bottomInset?: number;
  topInset?: number;
  /**
   * The gateway has not yet answered with this pane's transcript. Empty because
   * nothing has been asked for yet is a different fact from empty because there
   * is nothing to show, and saying the second while the first is true is what
   * made "Nothing to show yet." appear on every pane open.
   */
  awaitingFirstParts?: boolean;
  /** Whether the pane has transcript the gateway has not been asked for yet. */
  canLoadEarlier?: boolean;
  loadingEarlier?: boolean;
  /**
   * Loads the next page of earlier transcript. The same shape the terminal and
   * text views are given, so all three page through history by one path.
   */
  onLoadEarlier?: () => void;
  /** A file part was tapped; the screen resolves it and opens the viewer. */
  onOpenAsset?: (assetId: string) => void;
  /** Switches every run of tool calls between folded and shown. */
  onToggleDetail?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const markdownStyle = usePaneChatMarkdownStyle();
  // The spinner has to survive the request it started, so the pull stays live
  // while a load is in flight even once the gateway says there is no more.
  const pullEnabled = Boolean(onLoadEarlier) && (canLoadEarlier || loadingEarlier);
  // Which folded rows the reader opened. Kept here rather than per row so that
  // scrolling one out of the window does not close it.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(EMPTY_EXPANDED);
  const FoldIcon = detail === 'simplified' ? ChevronsUpDown : ChevronsDownUp;

  // The previous rows, so an unchanged row keeps its object. Written during
  // render on purpose: it is derived state, and the derivation is idempotent --
  // building twice from the same parts returns the same objects.
  const previousItemsRef = useRef<PaneChatItem[]>([]);
  const items = useMemo(() => {
    const next = buildPaneChatItems(parts, { detail }, previousItemsRef.current);
    previousItemsRef.current = next;
    return next;
  }, [detail, parts]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<PaneChatItem>) => {
      if (item.kind === 'prompt') return <PaneChatPromptRow text={item.text} colors={colors} />;
      if (item.kind === 'label') return <PaneChatLabelRow text={item.text} colors={colors} />;
      if (item.kind === 'activity') {
        return (
          <PaneChatActivityRow
            item={item}
            colors={colors}
            expanded={expandedIds.has(item.id)}
            onToggle={toggleExpanded}
          />
        );
      }
      return (
        <PaneChatPartRow
          part={item.part}
          colors={colors}
          markdownStyle={markdownStyle}
          expanded={expandedIds.has(item.id)}
          onToggle={toggleExpanded}
          onOpenAsset={onOpenAsset}
        />
      );
    },
    [colors, expandedIds, markdownStyle, onOpenAsset, toggleExpanded]
  );

  function requestEarlier() {
    if (!onLoadEarlier || loadingEarlier) return;
    onLoadEarlier();
  }

  // An empty transcript is drawn without a list at all, and that is a guard
  // rather than a shortcut. Legend List 3.3.3 carries an open React 19 crash
  // (LegendApp/legend-list#502): its reset path runs `setState` during render
  // when a mounted list's data goes non-empty, empty, non-empty. This view polls
  // for the *whole* transcript every time, so a single failed or empty answer
  // between two good ones is that sequence. Unmounting instead means the refill
  // is a fresh mount, which the crashing branch does not run for -- and there is
  // no reader's place to lose when there was nothing to read.
  if (items.length === 0) {
    return (
      <View style={[styles.shell, styles.empty, { backgroundColor: theme.colors.background }]}>
        {awaitingFirstParts ? (
          // The shape of a transcript, while the gateway is being asked for
          // one. It used to say "Nothing to show yet." the instant the view
          // mounted -- a verdict, delivered before the question had been asked,
          // and then replaced by a full conversation. A prompt bubble and two
          // paragraphs is what a transcript looks like, so the wait says what
          // it is for and the answer lands where the placeholder was.
          <Animated.View
            entering={fadeIn('micro')}
            exiting={fadeOut('short')}
            style={styles.skeleton}
            accessibilityLabel={t`Loading the transcript`}>
            <Skeleton variant="rect" width="64%" height={38} style={styles.skeletonPrompt} />
            <Skeleton variant="text" lines={3} height={13} />
            <Skeleton variant="rect" width="46%" height={22} style={styles.skeletonRun} />
            <Skeleton variant="text" lines={2} height={13} />
          </Animated.View>
        ) : (
          <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')}>
            <Text variant="bodySmall" color={theme.colors.textSubtle}>
              <Trans>Nothing to show yet.</Trans>
            </Text>
          </Animated.View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.shell, { backgroundColor: theme.colors.background }]}>
      <LegendList
        data={items}
        keyExtractor={keyOfItem}
        renderItem={renderItem}
        // The row set only changes when a row is opened, and each row is
        // memoized, so this is what keeps a toggle from re-rendering the rest.
        extraData={expandedIds}
        // The other half of the identity deal, stated to the list itself: a row
        // whose object has not changed has not changed. `buildPaneChatItems`
        // guarantees exactly this, so the strictest possible comparison is also
        // the correct one, and the cheapest.
        itemsAreEqual={itemsAreEqual}
        // Never. This view's entire performance argument is stable item objects
        // plus `React.memo`; recycling a row into a different row's props is the
        // one thing that would undo it.
        recycleItems={false}
        // A prompt bubble, a folded run and a paragraph are wildly different
        // heights, and a single average across all of them is what makes a
        // virtualized list jump when history lands above the viewport. The kind
        // is already the right bucket, so the list learns a size per kind.
        getItemType={itemTypeOf}
        estimatedItemSize={ESTIMATED_ROW_HEIGHT}
        // The reader's place across a change of data -- which is what a page of
        // earlier history is here, the transcript arriving again with more of it
        // rather than a slice pushed onto the front. Off by default, and the
        // whole reason this list replaced the hand-rolled anchoring.
        maintainVisibleContentPosition={MAINTAIN_POSITION}
        // Follow the newest row, but only for a reader who is already at it.
        maintainScrollAtEnd
        maintainScrollAtEndThreshold={FOLLOW_THRESHOLD}
        contentContainerStyle={[
          styles.content,
          { paddingTop: 12 + topInset, paddingBottom: 16 + bottomInset },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          pullEnabled ? (
            <RefreshControl
              refreshing={loadingEarlier}
              onRefresh={requestEarlier}
              progressViewOffset={topInset}
              colors={[theme.colors.primary]}
              tintColor={theme.colors.textMuted}
              progressBackgroundColor={theme.colors.surfaceRaised}
            />
          ) : undefined
        }
        ListFooterComponent={
          onToggleDetail ? (
            // A row at the end of the transcript rather than a control floating
            // over it. The header has no room for a second button, and the pane
            // screen's chrome -- header fade above, composer fade below -- owns
            // both edges of this view, so anything overlaid here is either
            // covered or covering. The end of the transcript is also where this
            // view sits by default, since it follows the newest part.
            // The list's own bottom padding does not apply to a footer -- the
            // footer is laid out after it -- so the composer's inset is repeated
            // here. Without this the control sits underneath the composer dock.
            <View style={[styles.footer, { marginBottom: bottomInset }]}>
              <PressableScale
                accessibilityLabel={
                  detail === 'simplified' ? t`Show every tool step` : t`Fold the tool steps away`
                }
                feedback="selection"
                onPress={onToggleDetail}
                style={[
                  styles.foldToggle,
                  {
                    backgroundColor: theme.colors.surfaceRaised,
                  },
                ]}>
                <FoldIcon size={14} color={theme.colors.textMuted} strokeWidth={2} />
                <Text variant="caption" color={theme.colors.textMuted}>
                  {detail === 'simplified' ? t`Show every tool step` : t`Fold the tool steps away`}
                </Text>
              </PressableScale>
            </View>
          ) : null
        }
      />
    </View>
  );
});

function keyOfItem(item: PaneChatItem): string {
  return item.id;
}

/** The kind is the size bucket: see `getItemType` above. */
function itemTypeOf(item: PaneChatItem): string {
  return item.kind;
}

function itemsAreEqual(previous: PaneChatItem, next: PaneChatItem): boolean {
  return previous === next;
}

/**
 * Anchor on a change of *data*, not only on rows changing size. The default
 * covers the second and skips the first, and the first is the one load-earlier
 * needs -- the transcript comes back longer at the top and the rows the reader
 * was looking at have to stay under their eyes.
 */
const MAINTAIN_POSITION = { data: true, size: true } as const;

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: '100%',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 14,
    gap: 10,
  },
  empty: {
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  skeleton: {
    gap: 18,
  },
  // Right-aligned and pill-shaped, because that is where a prompt bubble sits.
  skeletonPrompt: {
    alignSelf: 'flex-end',
  },
  skeletonRun: {
    alignSelf: 'flex-start',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 4,
  },
  foldToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
});
