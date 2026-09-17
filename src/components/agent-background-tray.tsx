import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { RefreshCw, Square, Terminal, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { LADDER, SectionLabel, SettingsCard } from '@/components/settings-chrome';
import { StatusDot } from '@/components/status-dot';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { capLines } from '@/lib/agent-tool-output';
import {
  getAgentShellOutput,
  killAgentShell,
  listAgentShells,
  type ShellInfo,
  type ShellStatus,
} from '@/lib/agent-session';

/**
 * What is still running after the agent moved on.
 *
 * `ctrl+b` in the TUI detaches the foreground tools blocking the agent loop --
 * a long `shell` is the usual one. They keep running, and until now the app had
 * no representation of them at all: the card said "running" forever and the
 * output went nowhere the reader could see it.
 *
 * The shells are `GET /api/agent-shells`, their output is
 * `GET …/{id}/output?cursor=`, and a shell is stopped with `DELETE …/{id}`.
 * Opening one asks for its output from the cursor it last reached, so a shell
 * printing for ten minutes costs one page per look rather than ten minutes of
 * buffer.
 */

/** Lines of a shell's output held in the sheet at once. */
const OUTPUT_LINE_BUDGET = 400;

/**
 * How often an open, running shell is re-read.
 *
 * A poll, and the only one in the agent surface. Shells have no event of their
 * own -- the stream carries the session's timeline, not a detached process's
 * stdout -- so the choice is this or a page that goes stale while the reader
 * watches it. It runs only while the sheet is open and only for a shell that
 * is still running, and it asks from the cursor, so each tick is whatever
 * arrived since the last one.
 */
const OUTPUT_POLL_MS = 2000;

export interface AgentBackgroundTrayProps {
  /** Scopes the listing to the workspace the reader is in. */
  directory?: string;
  onClose: () => void;
}

function statusTone(status: ShellStatus, colors: { running: string; ok: string; bad: string }) {
  if (status === 'running') return colors.running;
  return status === 'exited' ? colors.ok : colors.bad;
}

export const AgentBackgroundTray = memo(function AgentBackgroundTray({
  directory,
  onClose,
}: AgentBackgroundTrayProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const { showToast } = useToast();

  const [shells, setShells] = useState<readonly ShellInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [openShellId, setOpenShellId] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [killing, setKilling] = useState<string | null>(null);
  /** Where the last page ended, so the next one asks for what came after it. */
  const cursorRef = useRef(0);

  const refreshShells = useCallback(async () => {
    const list = await listAgentShells(directory);
    setShells(list);
    setLoading(false);
  }, [directory]);

  useEffect(() => {
    void refreshShells().catch(() => setLoading(false));
  }, [refreshShells]);

  const openShell = useMemo(
    () => shells.find((shell) => shell.id === openShellId) ?? null,
    [shells, openShellId]
  );

  const selectShell = useCallback((shellId: string) => {
    setOpenShellId((current) => (current === shellId ? null : shellId));
    cursorRef.current = 0;
    setOutput('');
  }, []);

  // The open shell's output, from where the last read stopped.
  useEffect(() => {
    if (!openShellId) return;
    let active = true;

    const readPage = async () => {
      const page = await getAgentShellOutput(openShellId, { cursor: cursorRef.current });
      if (!active) return;
      cursorRef.current = page.cursor;
      if (!page.output) return;
      setOutput((previous) => {
        const joined = previous ? `${previous}${page.output}` : page.output;
        // Bounded: a shell that has printed for an hour is not a reason to
        // hold an hour of text in a sheet.
        const lines = joined.split('\n');
        return lines.length > OUTPUT_LINE_BUDGET
          ? lines.slice(lines.length - OUTPUT_LINE_BUDGET).join('\n')
          : joined;
      });
    };

    void readPage().catch(() => {});
    if (openShell?.status !== 'running') return;
    const timer = setInterval(() => {
      void readPage().catch(() => {});
    }, OUTPUT_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [openShellId, openShell?.status]);

  const handleKill = useCallback(
    async (shellId: string) => {
      setKilling(shellId);
      try {
        await killAgentShell(shellId);
        await refreshShells();
      } catch (err) {
        console.warn('Failed to stop shell:', err);
        showToast({
          variant: 'danger',
          title: t`Could not stop it`,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setKilling(null);
      }
    },
    [refreshShells, showToast, t]
  );

  const running = shells.filter((shell) => shell.status === 'running').length;

  return (
    <SheetFrame testID="agent-background-tray" tint="background">
      <View collapsable={false} style={styles.sheetLayout}>
        <View style={styles.fixedTop}>
          <SheetHandle />
          <View style={styles.header}>
            <View style={[styles.headerCopy, plate]}>
              <Text variant="subheading" style={styles.headerTitle}>
                {t`Background tasks`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`${running} running of ${shells.length}`}
              </Text>
            </View>

            <GlassChrome face="sheet" style={styles.headerButton}>
              <PressableScale
                testID="agent-background-refresh"
                accessibilityRole="button"
                accessibilityLabel={t`Refresh`}
                onPress={() => {
                  setLoading(true);
                  void refreshShells().catch(() => setLoading(false));
                }}
                style={styles.headerButtonHit}>
                {loading ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <RefreshCw size={17} color={theme.colors.textMuted} />
                )}
              </PressableScale>
            </GlassChrome>

            <GlassChrome face="sheet" style={styles.headerButton}>
              <PressableScale
                testID="agent-background-close"
                accessibilityRole="button"
                accessibilityLabel={t`Close`}
                onPress={onClose}
                style={styles.headerButtonHit}>
                <X size={19} color={theme.colors.text} strokeWidth={2} />
              </PressableScale>
            </GlassChrome>
          </View>
        </View>

        <ScrollView
          style={styles.scrollViewport}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: LADDER.section + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}>
          {shells.length === 0 ? (
            <View style={styles.empty}>
              <Terminal size={32} color={theme.colors.textSubtle} />
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyText}>
                <Trans>
                  Nothing is running in the background. Detach a long command from its tool card and
                  it appears here.
                </Trans>
              </Text>
            </View>
          ) : (
            <View style={styles.sectionBlock}>
              <SectionLabel title={t`SHELLS`} color={theme.colors.textMuted} />
              <SettingsCard>
                {shells.map((shell) => {
                  const open = shell.id === openShellId;
                  const tone = statusTone(shell.status, {
                    running: theme.colors.warning,
                    ok: theme.colors.success,
                    bad: theme.colors.danger,
                  });
                  return (
                    <View key={shell.id}>
                      <PressableScale
                        testID={`agent-background-shell-${shell.id}`}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        accessibilityLabel={shell.command || shell.id}
                        onPress={() => selectShell(shell.id)}
                        style={styles.shellRow}>
                        <StatusDot
                          size={7}
                          filled
                          pulse={shell.status === 'running'}
                          color={tone}
                        />
                        <View style={styles.shellText}>
                          <Text
                            variant="bodySmall"
                            numberOfLines={1}
                            color={theme.colors.text}
                            style={styles.shellCommand}>
                            {shell.command || shell.id}
                          </Text>
                          <Text variant="caption" numberOfLines={1} color={theme.colors.textMuted}>
                            {shell.exit === undefined
                              ? (shell.cwd ?? shell.status)
                              : `${shell.status} · exit ${shell.exit}`}
                          </Text>
                        </View>
                        {shell.status === 'running' ? (
                          <PressableScale
                            testID={`agent-background-kill-${shell.id}`}
                            accessibilityRole="button"
                            accessibilityLabel={t`Stop this command`}
                            disabled={killing !== null}
                            onPress={() => void handleKill(shell.id)}
                            style={[styles.killBtn, { borderColor: theme.colors.danger }]}>
                            {killing === shell.id ? (
                              <ActivityIndicator size="small" color={theme.colors.danger} />
                            ) : (
                              <Square
                                size={11}
                                color={theme.colors.danger}
                                fill={theme.colors.danger}
                              />
                            )}
                          </PressableScale>
                        ) : null}
                      </PressableScale>

                      {open ? (
                        <View
                          style={[
                            styles.outputBox,
                            { backgroundColor: surfaceBackground(theme.colors.surface) },
                          ]}>
                          <Text selectable style={[styles.outputText, { color: colors.muted }]}>
                            {output || t`No output yet.`}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </SettingsCard>
            </View>
          )}
        </ScrollView>
      </View>
    </SheetFrame>
  );
});

/** What the composer's pill counts: shells still running. */
export function runningShellCount(shells: readonly ShellInfo[]): number {
  let count = 0;
  for (const shell of shells) {
    if (shell.status === 'running') count += 1;
  }
  return count;
}

/** The last lines of a shell's output, for a preview that is not the whole log. */
export function shellOutputPreview(output: string, lines = 3): string {
  const capped = capLines(output, lines);
  return capped.text;
}

const styles = StyleSheet.create({
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
  scrollViewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
  },
  sectionBlock: {
    gap: LADDER.snug,
  },
  empty: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    textAlign: 'center',
  },
  shellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  shellText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  shellCommand: {
    fontFamily: 'monospace',
    fontSize: 12.5,
  },
  killBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  outputBox: {
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  outputText: {
    fontFamily: 'monospace',
    fontSize: 11.5,
    lineHeight: 16,
  },
});
