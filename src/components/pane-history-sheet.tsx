import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, Text } from '@osuki-dev/ui';
import { useEffect, useEffectEvent, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupRule,
  SheetSceneQuietAction,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { readPaneHistorySegments } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { describeGatewayFailure, type GatewayFailure } from '@/lib/network-error';
import {
  appendCapturedSegmentsPage,
  capturedHistoryOwnerMatches,
  type CapturedSegmentsPage,
  type CapturedSegmentsRead,
} from '@/lib/terminal-history-segments';
import { rowText } from '@/terminal/history';

/** A frozen, paged reader. Live output never enters this surface. */
export function PaneHistorySheet({
  record,
  sessionId,
  paneId,
  enabled,
}: {
  record: GatewayRecord;
  sessionId: string;
  paneId: string;
  enabled: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const mono = useMonoFontFamily();
  const [owner] = useState(record);
  const owns = capturedHistoryOwnerMatches(owner, record);
  const [pages, setPages] = useState<CapturedSegmentsPage[]>([]);
  const [index, setIndex] = useState(0);
  const [request, setRequest] = useState<{ id: number; before: string | null }>({
    id: 0,
    before: null,
  });
  const [loading, setLoading] = useState(true);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [failure, setFailure] = useState<GatewayFailure | null>(null);

  const mayRead = useEffectEvent(() => owns && enabled);
  const receive = useEffectEvent((answer: CapturedSegmentsRead, before: string | null) => {
    setLoading(false);
    if (!owns || !enabled) return;
    if (!answer.ok) {
      if (answer.status === 409 || answer.status === 410) {
        setRefreshRequired(true);
        setFailure(null);
      } else {
        const error =
          answer.status !== null &&
          answer.error instanceof Error &&
          /^HTTP \d{3}$/.test(answer.error.message)
            ? new Error(`${answer.error.message}:`)
            : answer.error;
        setFailure(describeGatewayFailure(error, t`Could not read saved terminal history.`));
      }
      return;
    }
    const next =
      before === null ? [answer.page] : appendCapturedSegmentsPage(pages, answer.page, before);
    if (!next) {
      setRefreshRequired(true);
      setFailure(null);
      return;
    }
    setPages(next);
    setIndex(before === null ? 0 : next.length - 1);
    setRefreshRequired(false);
    setFailure(null);
  });
  useEffect(() => {
    if (!mayRead()) {
      setLoading(false);
      return;
    }
    let current = true;
    void readPaneHistorySegments(owner, sessionId, paneId, request.before).then((answer) => {
      if (current) receive(answer, request.before);
    });
    return () => {
      current = false;
    };
  }, [owner, sessionId, paneId, request]);

  function read(before: string | null) {
    if (loading || !owns || !enabled) return;
    setLoading(true);
    setFailure(null);
    setRequest((previous) => ({ id: previous.id + 1, before }));
  }
  const page = owns ? pages[index] : undefined;
  const olderCached = index + 1 < pages.length;
  const mayLoadOlder = page?.hasMore === true && !refreshRequired && enabled;
  const pageNumber = index + 1;
  const lines = page?.rowCount ?? 0;

  function boundaryLabel(reason: string): string {
    switch (reason) {
      case 'observation-start':
        return t`Observation started`;
      case 'gateway-restart':
        return t`Gateway restarted`;
      case 'capture-policy-change':
        return t`Capture changed`;
      case 'resize':
        return t`Terminal resized`;
      case 'editor-change':
        return t`Editor changed`;
      case 'capture-reset':
        return t`Capture restarted`;
      default:
        return t`Saved segment`;
    }
  }

  return (
    <SheetScene
      testID="pane-history-sheet"
      title={t`Saved terminal history`}
      caption={record.label}
      detail={
        <Text variant="caption">
          {page ? t`Page ${pageNumber} · ${lines} lines` : t`Saved observations`}
        </Text>
      }
      header={
        <>
          <View style={styles.controls}>
            <SheetSceneQuietAction
              testID="pane-history-older"
              label={t`Older`}
              disabled={loading || !owns || (!olderCached && !mayLoadOlder)}
              onPress={() => (olderCached ? setIndex(index + 1) : read(page?.nextBefore ?? null))}
            />
            <SheetSceneQuietAction
              testID="pane-history-newer"
              label={t`Newer`}
              disabled={loading || !owns || index === 0}
              onPress={() => setIndex(index - 1)}
            />
            <SheetSceneQuietAction
              testID="pane-history-refresh"
              label={t`Refresh`}
              disabled={loading || !owns || !enabled}
              onPress={() => read(null)}
            />
            {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
          </View>
          <View style={styles.notice}>
            <Text variant="caption" color={theme.colors.textMuted}>
              {!owns
                ? t`The connection changed. Close and reopen history for this computer.`
                : !enabled
                  ? t`This Gateway no longer offers saved segments. The pages already read are kept here.`
                  : refreshRequired
                    ? t`This snapshot can no longer be extended. Refresh to read the latest saved output; the current page is kept until then.`
                    : failure
                      ? failure.message
                      : t`Refresh to see new saved output.`}
            </Text>
            {failure?.retryable && !refreshRequired ? (
              <SheetSceneQuietAction
                testID="pane-history-retry"
                label={t`Retry`}
                disabled={loading || !owns || !enabled}
                onPress={() => read(request.before)}
              />
            ) : null}
          </View>
        </>
      }>
      <ScrollView
        key={`${page?.snapshotId ?? 'empty'}:${index}`}
        nestedScrollEnabled
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}>
        {page?.segments.map((segment, segmentIndex) => {
          const newer =
            segmentIndex === page.segments.length - 1 &&
            pages[index - 1]?.segments[0]?.id === segment.id;
          const older = segmentIndex === 0 && pages[index + 1]?.segments.at(-1)?.id === segment.id;
          const started = new Date(segment.startedAtMs).toLocaleString();
          return (
            <View key={segment.id} testID="pane-history-segment">
              <SheetSceneGroupRule />
              <Text variant="caption" weight="semibold">
                {boundaryLabel(segment.boundaryReason)}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`Started ${started}`}
                {newer || older ? ` · ${t`Continued on another page`}` : ''}
              </Text>
              <Text selectable style={[styles.output, { fontFamily: mono }]}>
                {segment.rows.map(rowText).join('\n')}
              </Text>
            </View>
          );
        })}
        {page?.rowCount === 0 ? (
          <Text variant="bodySmall">{t`No captured history yet.`}</Text>
        ) : null}
        {page && page.rowCount > 0 && !page.hasMore ? (
          <Text
            variant="caption"
            color={theme.colors.textMuted}>{t`No older captured output.`}</Text>
        ) : null}
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24 },
  notice: { paddingHorizontal: 24, paddingBottom: 12 },
  output: { fontSize: 13, lineHeight: 20, marginVertical: 12 },
});
