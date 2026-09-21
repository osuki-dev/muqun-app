import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { type LegendListRef } from '@legendapp/list/react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';

import { DiffRowList } from '@/components/diff-rows';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { SettingsSegmented } from '@/components/settings-segmented';
import { SheetScene, SHEET_LADDER } from '@/components/sheet-scene';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { diffRowsFromPatches, diffTotals } from '@/lib/agent-diff-rows';
import { closeFile, openFile } from '@/lib/gateway-client';
import { diffEmptyState } from '@/lib/agent-workspace-missing';
import { getAgentVcsDiff, type AgentVcsDiff, type VcsDiffMode } from '@/lib/agent-session';

/**
 * What the agent changed on disk, as a native form sheet route.
 *
 * The sheet is the shared scene -- frosted ground, grabber, heading, one quiet
 * control under it -- and the body is the shared diff viewer, the same one the
 * terminal's changes sheet draws: a file list, sticky file headers, a pinned
 * gutter, and one horizontal scroller so columns stay aligned across rows.
 *
 * The body is deliberately *not* scene rows with a patch under the selected
 * one. A diff is the one thing in this app that has to look identical wherever
 * it appears, because the reader is comparing columns -- so it is one
 * component, and this sheet and the terminal's are the same picture from two
 * sources. What differs is only where the patches come from: this one is handed
 * every file's whole patch by `GET …/vcs/diff`, so there is no paging and no
 * "show more" row, and the segmented control picks the comparison OpenCode
 * requires -- `mode` is not optional there, and omitting it is why this sheet
 * used to come back empty.
 */
export interface AgentVcsDiffSheetProps {
  sessionId: string;
  asid: string;
  targetPath?: string;
  onClose: () => void;
}

export const AgentVcsDiffSheet = memo(function AgentVcsDiffSheet({
  sessionId,
  asid,
  targetPath,
  onClose: _onClose,
}: AgentVcsDiffSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const surfaceBackground = useSurfaceBackground();

  const [loading, setLoading] = useState(false);
  /**
   * The answer, not just its list.
   *
   * An empty list has three readings -- clean, not a repository, and a folder
   * that is gone -- and the sheet used to print the first of them for all
   * three. The gateway says which, so the sheet keeps what it said.
   */
  const [answer, setAnswer] = useState<AgentVcsDiff>({ files: [] });
  const [mode, setMode] = useState<VcsDiffMode>('working');
  /** Which files are open, oldest first: the same eviction rule as the sheet. */
  const [expandedOrder, setExpandedOrder] = useState<readonly string[]>([]);
  const listRef = useRef<LegendListRef | null>(null);
  const pendingTargetPath = useRef(targetPath);
  const pendingTargetKey = useRef<string | null>(null);

  // Fetched once per opening and once per mode: a route mounts when it opens.
  useEffect(() => {
    if (!asid) return;
    let active = true;
    setLoading(true);
    getAgentVcsDiff(sessionId, asid, mode)
      .then((next) => {
        if (!active) return;
        setAnswer(next);
        const requestedPath = mode === 'working' ? pendingTargetPath.current : undefined;
        const matchedPath = requestedPath
          ? next.files.find((file) => file.path === requestedPath)?.path
          : undefined;
        // A single changed file is opened without being asked; with more than
        // one on screen, opening one of them is a choice the sheet must not make
        // unless the route names the file the reader just came from.
        setExpandedOrder(
          matchedPath ? [matchedPath] : next.files.length === 1 ? [next.files[0].path] : []
        );
        if (matchedPath) {
          pendingTargetPath.current = undefined;
          pendingTargetKey.current = `f:${matchedPath}`;
        }
      })
      .catch((err) => {
        console.warn('Failed to load VCS diff:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId, asid, mode]);

  const changeMode = useCallback((next: string) => {
    if (next !== 'working' && next !== 'branch' && next !== 'committed') return;
    // A different comparison is different text; the list starts collapsed
    // again, which is also the honest reading position.
    setExpandedOrder([]);
    setAnswer({ files: [] });
    setMode(next);
  }, []);

  const toggleFile = useCallback((path: string) => {
    setExpandedOrder((order) =>
      order.includes(path) ? closeFile(order, path) : openFile(order, path)
    );
  }, []);

  const noShowMore = useCallback(() => {}, []);

  const expanded = useMemo(() => new Set(expandedOrder), [expandedOrder]);
  const diffs = answer.files;
  const rows = useMemo(() => diffRowsFromPatches(diffs, expanded), [diffs, expanded]);
  useEffect(() => {
    const key = pendingTargetKey.current;
    if (!key) return;
    const index = rows.findIndex((row) => row.key === key);
    if (index < 0) return;
    pendingTargetKey.current = null;
    listRef.current?.scrollToIndex({ index, animated: false });
  }, [rows]);
  const totals = useMemo(() => diffTotals(diffs), [diffs]);

  /**
   * What to say when there is nothing to show, which is four sentences rather
   * than one. A folder that is gone and a folder that is not a repository are
   * not "nothing uncommitted": they are unanswerable, and saying otherwise is
   * this app inventing a fact about the host. Neither is an error toast --
   * nothing failed, and there is nothing for the reader to retry.
   */
  const empty = diffEmptyState({ loading, fileCount: diffs.length, reason: answer.reason });
  // What the caption says: the summary when there are files, "No changes"
  // when there are none, and while a tab is loading whatever the previous
  // one said, so a reload never swaps the line for a blank or a third wording.
  const summary =
    diffs.length > 0
      ? t`${plural(diffs.length, { one: '# file', other: '# files' })} · +${totals.additions} −${totals.deletions}`
      : t`No changes`;
  const [lastCaption, setLastCaption] = useState<string | null>(null);
  useEffect(() => {
    if (!loading) setLastCaption(summary);
  }, [loading, summary]);
  const emptyText =
    empty === 'workspace-missing'
      ? t`Project folder is missing: ${answer.missing?.directory ?? ''}`
      : empty === 'not-a-repository'
        ? t`Not a git repository`
        : t`Nothing uncommitted in this project.`;

  return (
    <SheetScene
      testID="agent-vcs-diff-sheet"
      title={t`Changes`}
      // The caption line is always there. It used to vanish for a tab with
      // nothing in it and come back for the next, so the segmented control and
      // the list under it jumped by a line on every switch; a tab with no
      // changes says so on that same line, and a tab still loading keeps what
      // the last one said rather than blinking to a third state.
      caption={loading && lastCaption ? lastCaption : summary}
      header={
        <SettingsSegmented
          options={[
            { value: 'working', label: t`Working` },
            { value: 'branch', label: t`Branch` },
            { value: 'committed', label: t`Committed` },
          ]}
          value={mode}
          onChange={changeMode}
          testID="agent-vcs-diff-mode"
        />
      }>
      {/*
        Inside the scene, not across it. The diff viewer paints its own ground
        edge to edge -- which is right on the terminal's full-width changes
        page and wrong here: it arrived as an opaque slab from x=0, with a hard
        edge under the segmented control and an expanded patch running past the
        sheet's right margin. The sheet's gutter is the column every other row
        on this ground starts from, so the viewer sits in it and what shows
        through is the sheet's own frosted ground.
      */}
      <View style={styles.body}>
        <DiffRowList
          rows={rows}
          colors={colors}
          gutterFill={surfaceBackground(theme.colors.surface)}
          headerFill={surfaceBackground(theme.colors.surface)}
          surfaceFill="transparent"
          // There is no index to attribute an agent's edits to, so there is no
          // staged/unstaged mark to show either.
          showSide={false}
          onToggleFile={toggleFile}
          onShowMore={noShowMore}
          listRef={listRef}
          fallback={
            empty === 'loading' ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : (
              <Text
                testID="agent-vcs-diff-empty"
                variant="bodySmall"
                color={theme.colors.textMuted}
                style={styles.emptyText}>
                {emptyText}
              </Text>
            )
          }
        />
      </View>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0, paddingHorizontal: SHEET_LADDER.gutter },
  emptyText: { textAlign: 'center', paddingHorizontal: SHEET_LADDER.gutter },
});
