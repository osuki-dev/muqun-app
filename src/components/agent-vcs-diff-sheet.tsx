import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';

import { DiffRowList } from '@/components/diff-rows';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { SettingsSegmented } from '@/components/settings-segmented';
import { SheetScene, SHEET_LADDER } from '@/components/sheet-scene';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { diffRowsFromPatches, diffTotals } from '@/lib/agent-diff-rows';
import { closeFile, openFile } from '@/lib/gateway-client';
import { getAgentVcsDiff, type FileDiffItem, type VcsDiffMode } from '@/lib/agent-session';

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
  onClose: () => void;
}

export const AgentVcsDiffSheet = memo(function AgentVcsDiffSheet({
  sessionId,
  asid,
  onClose: _onClose,
}: AgentVcsDiffSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const surfaceBackground = useSurfaceBackground();

  const [loading, setLoading] = useState(false);
  const [diffs, setDiffs] = useState<readonly FileDiffItem[]>([]);
  const [mode, setMode] = useState<VcsDiffMode>('working');
  /** Which files are open, oldest first: the same eviction rule as the sheet. */
  const [expandedOrder, setExpandedOrder] = useState<readonly string[]>([]);

  // Fetched once per opening and once per mode: a route mounts when it opens.
  useEffect(() => {
    if (!asid) return;
    let active = true;
    setLoading(true);
    getAgentVcsDiff(sessionId, asid, mode)
      .then((items) => {
        if (!active) return;
        setDiffs(items);
        // A single changed file is opened without being asked; with more than
        // one on screen, opening one of them is a choice the sheet must not
        // make for the reader.
        setExpandedOrder(items.length === 1 ? [items[0].path] : []);
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
    setDiffs([]);
    setMode(next);
  }, []);

  const toggleFile = useCallback((path: string) => {
    setExpandedOrder((order) =>
      order.includes(path) ? closeFile(order, path) : openFile(order, path)
    );
  }, []);

  const noShowMore = useCallback(() => {}, []);

  const expanded = useMemo(() => new Set(expandedOrder), [expandedOrder]);
  const rows = useMemo(() => diffRowsFromPatches(diffs, expanded), [diffs, expanded]);
  const totals = useMemo(() => diffTotals(diffs), [diffs]);

  return (
    <SheetScene
      testID="agent-vcs-diff-sheet"
      title={t`Changes`}
      caption={
        diffs.length > 0
          ? t`${diffs.length} files · +${totals.additions} −${totals.deletions}`
          : undefined
      }
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
          fallback={
            loading ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : (
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyText}>
                {t`Nothing uncommitted in this workspace.`}
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
