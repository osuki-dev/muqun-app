import { memo, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, ActivityIndicator, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { GitCommit, FileCode, X } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { getAgentVcsDiff, type FileDiffItem } from '@/lib/agent-session';

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
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheetGround, { backgroundColor: theme.colors.surface }]}>
          {/* Top handle pill */}
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerTitleArea}>
              <Text variant="heading" style={styles.headerTitle}>
                {t`Code Changes`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted} style={styles.headerSubtitle}>
                {t`${diffs.length} file(s) modified in workspace`}
              </Text>
            </View>
            <PressableScale onPress={onClose} style={styles.closeBtn}>
              <X size={18} color={theme.colors.textMuted} />
            </PressableScale>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : diffs.length === 0 ? (
            <View style={styles.emptyContainer}>
              <GitCommit size={36} color={theme.colors.textSubtle} />
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyText}>
                <Trans>No uncommitted file changes.</Trans>
              </Text>
            </View>
          ) : (
            <View style={styles.content}>
              {/* File list tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fileTabs}>
                {diffs.map((d) => {
                  const isSelected = selectedFile === d.path;
                  const fileName = d.path.split('/').pop() ?? d.path;
                  return (
                    <PressableScale
                      key={d.path}
                      onPress={() => setSelectedFile(d.path)}
                      style={[
                        styles.fileTab,
                        {
                          backgroundColor: isSelected
                            ? `${theme.colors.primary}20`
                            : surfaceBackground(theme.colors.surfaceRaised),
                          borderColor: isSelected ? theme.colors.primary : theme.colors.border,
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

              {/* Diff View */}
              {activeDiff ? (
                <ScrollView style={styles.diffScroll} contentContainerStyle={styles.diffContent}>
                  <View style={styles.diffFilePathBar}>
                    <Text
                      variant="caption"
                      color={theme.colors.textSubtle}
                      style={styles.diffFilePath}>
                      {activeDiff.path}
                    </Text>
                  </View>
                  <View
                    style={[styles.patchBox, { backgroundColor: `${theme.colors.surfaceRaised}` }]}>
                    {activeDiff.patch.split('\n').map((line, idx) => {
                      const isAdd = line.startsWith('+');
                      const isDel = line.startsWith('-');
                      const isHeader = line.startsWith('@@') || line.startsWith('diff');
                      return (
                        <View
                          key={idx}
                          style={[
                            styles.patchLine,
                            isAdd ? { backgroundColor: `${theme.colors.success}15` } : null,
                            isDel ? { backgroundColor: `${theme.colors.danger}15` } : null,
                          ]}>
                          <Text
                            selectable
                            style={[
                              styles.patchText,
                              isAdd
                                ? { color: theme.colors.success }
                                : isDel
                                  ? { color: theme.colors.danger }
                                  : isHeader
                                    ? { color: theme.colors.info, fontWeight: '700' }
                                    : { color: theme.colors.textMuted },
                            ]}>
                            {line || ' '}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              ) : null}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetGround: {
    height: '85%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(150,150,150,0.2)',
    overflow: 'hidden',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.35)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTitleArea: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  loadingContainer: {
    padding: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
  },
  content: {
    flex: 1,
  },
  fileTabs: {
    paddingHorizontal: 16,
    marginVertical: 8,
    maxHeight: 40,
  },
  fileTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 8,
    gap: 6,
  },
  fileName: {
    fontWeight: '600',
    fontSize: 12,
  },
  statsBadge: {
    flexDirection: 'row',
    gap: 4,
  },
  statAdd: {
    fontSize: 11,
    fontWeight: '700',
  },
  statDel: {
    fontSize: 11,
    fontWeight: '700',
  },
  diffScroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  diffContent: {
    paddingBottom: 24,
  },
  diffFilePathBar: {
    paddingVertical: 6,
  },
  diffFilePath: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  patchBox: {
    borderRadius: 8,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  patchLine: {
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  patchText: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
});
