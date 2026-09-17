import { memo, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, Pressable } from 'react-native';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { GitCommit, FileCode, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { ThemedSurface } from '@/components/themed-surface';
import { LADDER, SettingsCard } from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { getAgentVcsDiff, type FileDiffItem } from '@/lib/agent-session';
import { keyedLines } from '@/lib/line-keys';

export interface AgentVcsDiffSheetProps {
  visible: boolean;
  sessionId: string;
  asid: string;
  onClose: () => void;
}

export const AgentVcsDiffSheet = memo(function AgentVcsDiffSheet({
  visible,
  sessionId,
  asid,
  onClose,
}: AgentVcsDiffSheetProps) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const [loading, setLoading] = useState(false);
  const [diffs, setDiffs] = useState<FileDiffItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !sessionId || !asid) return;
    let active = true;
    setLoading(true);
    getAgentVcsDiff(sessionId, asid)
      .then((items) => {
        if (active) {
          setDiffs(items);
          if (items.length > 0 && !selectedFile) {
            setSelectedFile(items[0].path);
          }
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
  }, [visible, sessionId, asid, selectedFile]);

  const activeDiff = diffs.find((d) => d.path === selectedFile) ?? diffs[0];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          testID="agent-vcs-diff-sheet"
          onPress={(e) => e.stopPropagation()}
          style={styles.sheetContainer}>
          <SheetFrame tint="background">
            <View collapsable={false} style={styles.sheetLayout}>
              {/* Pinned Top Navigation Bar */}
              <View style={styles.fixedTop}>
                <SheetHandle style={styles.sheetHandle} />

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

                {/* File list tabs */}
                {diffs.length > 0 ? (
                  <ThemedSurface
                    slot="tabs.background"
                    baseColor={theme.colors.surface}
                    style={styles.fileTabsStrip}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.fileTabsContent}>
                      {diffs.map((d) => {
                        const isSelected = selectedFile === d.path;
                        const fileName = d.path.split('/').pop() ?? d.path;
                        return (
                          <PressableScale
                            key={d.path}
                            onPress={() => setSelectedFile(d.path)}
                            style={[
                              styles.fileTab,
                              isSelected && {
                                backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                              },
                            ]}>
                            <FileCode
                              size={13}
                              color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                            />
                            <Text
                              variant="caption"
                              color={isSelected ? theme.colors.primary : theme.colors.text}
                              style={styles.fileName}>
                              {fileName}
                            </Text>
                            <View style={styles.statsBadge}>
                              {d.additions > 0 ? (
                                <Text
                                  variant="caption"
                                  color={theme.colors.success}
                                  style={styles.statAdd}>
                                  +{d.additions}
                                </Text>
                              ) : null}
                              {d.deletions > 0 ? (
                                <Text
                                  variant="caption"
                                  color={theme.colors.danger}
                                  style={styles.statDel}>
                                  -{d.deletions}
                                </Text>
                              ) : null}
                            </View>
                          </PressableScale>
                        );
                      })}
                    </ScrollView>
                  </ThemedSurface>
                ) : null}
              </View>

              {loading ? (
                <View style={styles.loadingContainer}>
                  <Spinner size="lg" color={theme.colors.primary} />
                </View>
              ) : diffs.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <GitCommit size={36} color={theme.colors.textSubtle} />
                  <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyText}>
                    <Trans>No uncommitted file changes.</Trans>
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={styles.scrollViewport}
                  contentContainerStyle={[
                    styles.content,
                    { paddingBottom: LADDER.section + insets.bottom },
                  ]}>
                  {activeDiff?.patch ? (
                    <SettingsCard>
                      <View style={styles.patchContainer}>
                        {keyedLines(activeDiff.patch).map(({ line, key }) => {
                          const isAdd = line.startsWith('+') && !line.startsWith('+++');
                          const isDel = line.startsWith('-') && !line.startsWith('---');
                          const isHunk = line.startsWith('@@');

                          let lineBg = 'transparent';
                          let lineFg = theme.colors.text;

                          if (isAdd) {
                            lineBg = `${theme.colors.success}18`;
                            lineFg = theme.colors.success;
                          } else if (isDel) {
                            lineBg = `${theme.colors.danger}18`;
                            lineFg = theme.colors.danger;
                          } else if (isHunk) {
                            lineBg = `${theme.colors.primary}12`;
                            lineFg = theme.colors.primary;
                          }

                          return (
                            <View
                              key={key}
                              style={[styles.patchLineRow, { backgroundColor: lineBg }]}>
                              <Text
                                variant="caption"
                                style={[styles.patchLineText, { color: lineFg }]}>
                                {line || ' '}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </SettingsCard>
                  ) : (
                    <View style={styles.emptyContainer}>
                      <Text variant="caption" color={theme.colors.textMuted}>
                        <Trans>No diff preview available for binary or unmodified files.</Trans>
                      </Text>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          </SheetFrame>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  sheetLayout: {
    flexShrink: 1,
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
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
  fileTabsStrip: {
    padding: 3,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  fileTabsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fileTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 30,
    borderRadius: 9,
    borderCurve: 'continuous',
  },
  fileName: {
    fontSize: 12,
    fontWeight: '500',
  },
  statsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statAdd: {
    fontSize: 10,
    fontWeight: '700',
  },
  statDel: {
    fontSize: 10,
    fontWeight: '700',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    textAlign: 'center',
  },
  scrollViewport: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
  },
  patchContainer: {
    paddingVertical: 8,
  },
  patchLineRow: {
    paddingHorizontal: 12,
    paddingVertical: 1,
  },
  patchLineText: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
});
