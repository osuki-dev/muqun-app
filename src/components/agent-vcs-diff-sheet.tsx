import { memo, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { GitCommit } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { usePaneChatColors } from '@/components/pane-chat-blocks';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { withAlpha } from '@/lib/color';
import { fadeIn, listLayout, riseIn, STAGGER } from '@/lib/motion';
import { getAgentVcsDiff, type FileDiffItem } from '@/lib/agent-session';
import { keyedLines } from '@/lib/line-keys';

const STAGGERED_ROWS = 8;

/**
 * What the agent changed on disk, as a native form sheet route.
 *
 * An inspector: files are rows with the same left rule as every other sheet --
 * the rule marks the file you are reading -- and the patch for that one file
 * follows underneath it. The added and removed colours come from
 * `usePaneChatColors`, which prefers the terminal palette's own green and red,
 * so one change reads identically in the terminal and here.
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
  const insets = useSafeAreaInsets();
  const diffColors = usePaneChatColors();
  const [loading, setLoading] = useState(false);
  const [diffs, setDiffs] = useState<FileDiffItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Fetched once per opening: a route mounts when it opens. `selectedFile` is
  // deliberately not a dependency -- it used to be, so picking a file refetched
  // the whole diff set.
  useEffect(() => {
    if (!sessionId || !asid) return;
    let active = true;
    setLoading(true);
    getAgentVcsDiff(sessionId, asid)
      .then((items) => {
        if (!active) return;
        setDiffs(items);
        setSelectedFile((current) => current ?? items[0]?.path ?? null);
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
  }, [sessionId, asid]);

  const active = diffs.find((diff) => diff.path === selectedFile) ?? diffs[0];
  const additions = diffs.reduce((sum, diff) => sum + diff.additions, 0);
  const deletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0);

  return (
    <SheetScene
      testID="agent-vcs-diff-sheet"
      title={t`Changes`}
      caption={
        diffs.length > 0 ? t`${diffs.length} files · +${additions} −${deletions}` : undefined
      }>
      {loading ? (
        <View style={styles.centre}>
          <Spinner size="lg" color={theme.colors.primary} />
        </View>
      ) : diffs.length === 0 ? (
        <View style={styles.centre}>
          <GitCommit size={32} color={theme.colors.textSubtle} />
          <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyText}>
            {t`Nothing uncommitted in this workspace.`}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          showsVerticalScrollIndicator={false}>
          <SheetSceneGroupHeading title={t`Files`} first />
          {diffs.map((diff, index) => {
            const isSelected = diff.path === active?.path;
            return (
              <Animated.View
                key={diff.path}
                entering={index < STAGGERED_ROWS ? riseIn(index * STAGGER.row) : fadeIn('short')}
                layout={listLayout('short')}>
                <SheetSceneRow
                  testID={`agent-vcs-file-${diff.path}`}
                  title={diff.path.split('/').pop() ?? diff.path}
                  caption={diff.path}
                  selected={isSelected}
                  onPress={() => setSelectedFile(diff.path)}
                  meta={
                    <View style={styles.stat}>
                      {diff.additions > 0 ? (
                        <Text variant="caption" color={diffColors.added} style={styles.statText}>
                          {`+${diff.additions}`}
                        </Text>
                      ) : null}
                      {diff.deletions > 0 ? (
                        <Text variant="caption" color={diffColors.removed} style={styles.statText}>
                          {`−${diff.deletions}`}
                        </Text>
                      ) : null}
                    </View>
                  }
                  trailing={
                    isSelected && diff.patch ? (
                      <View style={styles.patch}>
                        {keyedLines(diff.patch).map(({ line, key }) => {
                          const added = line.startsWith('+') && !line.startsWith('+++');
                          const removed = line.startsWith('-') && !line.startsWith('---');
                          const hunk = line.startsWith('@@');
                          const ink = added
                            ? diffColors.added
                            : removed
                              ? diffColors.removed
                              : hunk
                                ? theme.colors.primary
                                : theme.colors.textMuted;
                          const fill = added
                            ? diffColors.addedBackground
                            : removed
                              ? diffColors.removedBackground
                              : hunk
                                ? withAlpha(theme.colors.primary, 0.07)
                                : undefined;
                          return (
                            <View
                              key={key}
                              style={[styles.patchLine, fill ? { backgroundColor: fill } : null]}>
                              <Text variant="caption" style={[styles.patchText, { color: ink }]}>
                                {line || ' '}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null
                  }
                />
              </Animated.View>
            );
          })}
          <SheetSceneFooter bottomInset={insets.bottom} />
        </ScrollView>
      )}
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  centre: { padding: 40, alignItems: 'center', justifyContent: 'center', gap: SHEET_LADDER.snug },
  emptyText: { textAlign: 'center' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: SHEET_LADDER.gap },
  statText: { fontWeight: '700', includeFontPadding: false },
  patch: { paddingBottom: SHEET_LADDER.snug },
  patchLine: { paddingHorizontal: SHEET_LADDER.gap, paddingVertical: 1 },
  patchText: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
});
