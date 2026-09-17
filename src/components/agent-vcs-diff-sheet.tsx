import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { X } from 'lucide-react-native';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { SettingsSegmented } from '@/components/settings-segmented';
import { DiffRowList } from '@/components/diff-rows';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { LADDER } from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { diffRowsFromPatches } from '@/lib/agent-diff-rows';
import { closeFile, openFile } from '@/lib/gateway-client';
import { getAgentVcsDiff, type FileDiffItem, type VcsDiffMode } from '@/lib/agent-session';

/**
 * What the agent changed on disk, as a native form sheet route.
 *
 * The terminal side already has a diff viewer -- a file list of what changed,
 * sticky file headers, a pinned gutter and one horizontal scroller for the
 * whole body -- and this used to be a second design: a horizontal strip of file
 * tabs over a plain `ScrollView` of marker-coloured `<Text>`, with no line
 * numbers and a third set of greens and reds. Two designs for one thing, and
 * the one thing a diff must do is let the reader compare columns.
 *
 * So the body is `DiffRowList`, exactly as the terminal's sheet draws it. What
 * differs is only the source: this one is handed every file's whole patch by
 * `GET …/vcs/diff`, so there is no paging and no "show more" row, and the
 * segmented control picks the comparison OpenCode requires -- `mode` is not
 * optional there, and omitting it is why this sheet used to come back empty.
 */
export interface AgentVcsDiffSheetProps {
  sessionId: string;
  asid: string;
  onClose: () => void;
}

export const AgentVcsDiffSheet = memo(function AgentVcsDiffSheet({
  sessionId,
  asid,
  onClose,
}: AgentVcsDiffSheetProps) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const plate = useSheetGroundPlate();
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

  return (
    // One ground and one layout column: the two subviews a native form sheet
    // lays itself out around. See `sheet-ground.tsx`.
    <SheetFrame testID="agent-vcs-diff-sheet" tint="background">
      <View collapsable={false} style={styles.sheetLayout}>
        {/* Pinned Top Navigation Bar */}
        <View style={styles.fixedTop}>
          <SheetHandle />

          <View style={styles.header}>
            <View style={[styles.headerCopy, plate]}>
              <Text variant="subheading" style={styles.headerTitle}>
                {t`Code Changes`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`${diffs.length} file(s) modified in workspace`}
              </Text>
            </View>

            <GlassChrome face="sheet" style={styles.headerButton}>
              <PressableScale
                testID="agent-vcs-diff-close"
                accessibilityRole="button"
                accessibilityLabel={t`Close`}
                onPress={onClose}
                style={styles.headerButtonHit}>
                <X size={19} color={theme.colors.text} strokeWidth={2} />
              </PressableScale>
            </GlassChrome>
          </View>

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
        </View>

        <DiffRowList
          rows={rows}
          colors={colors}
          gutterFill={theme.colors.surface}
          headerFill={theme.colors.surfaceRaised}
          surfaceFill={surfaceBackground(theme.colors.surface)}
          // There is no index to attribute an agent's edits to, so there is no
          // staged/unstaged mark to show either.
          showSide={false}
          onToggleFile={toggleFile}
          onShowMore={noShowMore}
          fallback={
            loading ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : (
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.stateText}>
                <Trans>No uncommitted file changes.</Trans>
              </Text>
            )
          }
        />
      </View>
    </SheetFrame>
  );
});

const styles = StyleSheet.create({
  // The stack renders form sheets over a transparent background so the native
  // sheet keeps its own corners; without filling the height, that transparency
  // shows as a strip under the content.
  sheetLayout: {
    flex: 1,
  },
  fixedTop: {
    flexShrink: 0,
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap * 1.5,
    paddingBottom: LADDER.gap,
    gap: LADDER.snug,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerTitle: {
    includeFontPadding: false,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  headerButtonHit: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    textAlign: 'center',
  },
});
