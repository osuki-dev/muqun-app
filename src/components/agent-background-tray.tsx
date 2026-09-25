import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLingui } from '@lingui/react/macro';
import { Square, Terminal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneQuietAction,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { StatusDot } from '@/components/status-dot';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { fadeIn, listLayout, riseIn, STAGGER } from '@/lib/motion';
import { capLines } from '@/lib/agent-tool-output';
import {
  getAgentShellOutput,
  killAgentShell,
  listAgentShells,
  type ShellInfo,
  type ShellStatus,
} from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

/**
 * What is still running after the agent moved on.
 *
 * `ctrl+b` in the TUI detaches the foreground tools blocking the agent loop --
 * a long `shell` is the usual one. They keep running, and until now the app had
 * no representation of them at all: the card said "running" forever and the
 * output went nowhere the reader could see it.
 *
 * An inspector on the shared scene: shells are rows with the same left rule as
 * every other sheet -- the rule marks the one you are reading -- and its output
 * follows underneath it. The shells are `GET /api/agent-shells`, the output is
 * `GET …/{id}/output?cursor=`, and a shell is stopped with `DELETE …/{id}`.
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

/** Rows past this one arrive together; a stagger that long reads as a wait. */
const STAGGERED_ROWS = 8;

export interface AgentBackgroundTrayProps {
  /** Scopes the listing to the workspace the reader is in. */
  directory?: string;
  /**
   * The shell to open on arrival.
   *
   * A `shell` tool card knows the shell it is running in -- `metadata.shellID`,
   * which arrives on the progress event while the command is still going -- so
   * "Background tasks" on that card can land on that command's output instead
   * of on a list for the reader to find it in again.
   */
  initialShellId?: string;
  onClose: () => void;
}

function statusTone(status: ShellStatus, colors: { running: string; ok: string; bad: string }) {
  if (status === 'running') return colors.running;
  return status === 'exited' ? colors.ok : colors.bad;
}

export const AgentBackgroundTray = memo(function AgentBackgroundTray({
  directory,
  initialShellId,
  onClose: _onClose,
}: AgentBackgroundTrayProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const colors = usePaneChatColors();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const { showToast } = useToast();
  const mono = useMonoFontFamily();

  const [shells, setShells] = useState<readonly ShellInfo[]>([]);
  const [loading, setLoading] = useState(true);
  // The shell the sheet was opened on, if it was opened on one. Initial state
  // rather than an effect: the output reader below keys off this id, and a
  // sheet that opened closed and then opened itself would be a frame of the
  // wrong thing.
  const [openShellId, setOpenShellId] = useState<string | null>(initialShellId ?? null);
  const [output, setOutput] = useState('');
  const [killing, setKilling] = useState<string | null>(null);
  /** Ignore a slower response from a directory the sheet no longer shows. */
  const shellRequestRef = useRef(0);
  /** Where the last page ended, so the next one asks for what came after it. */
  const cursorRef = useRef(0);

  const refreshShells = useCallback(async () => {
    const request = ++shellRequestRef.current;
    const list = await listAgentShells(directory);
    if (request !== shellRequestRef.current) return;
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
      return settleAfter(
        async () => {
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
          }
        },
        () => {
          setKilling(null);
        }
      );
    },
    [refreshShells, showToast, t]
  );

  const running = shells.filter((shell) => shell.status === 'running').length;

  return (
    <SheetScene
      testID="agent-background-tray"
      title={t`Background tasks`}
      caption={shells.length > 0 ? t`${running} running of ${shells.length}` : undefined}
      headingTrailing={
        <SheetSceneQuietAction
          testID="agent-background-refresh"
          label={t`Refresh`}
          onPress={() => {
            setLoading(true);
            void refreshShells().catch(() => setLoading(false));
          }}
        />
      }>
      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : shells.length === 0 ? (
        <View style={styles.centre}>
          <Terminal size={32} color={theme.colors.textSubtle} />
          <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyText}>
            {t`Nothing is running in the background — detach a long command from its tool card and it appears here`}
          </Text>
        </View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          showsVerticalScrollIndicator={false}>
          <SheetSceneGroupHeading title={t`Shells`} first />
          {shells.map((shell, index) => {
            const open = shell.id === openShellId;
            const tone = statusTone(shell.status, {
              running: theme.colors.warning,
              ok: theme.colors.success,
              bad: theme.colors.danger,
            });
            return (
              <Animated.View
                key={shell.id}
                entering={index < STAGGERED_ROWS ? riseIn(index * STAGGER.row) : fadeIn('short')}
                layout={listLayout('short')}>
                <SheetSceneRow
                  testID={`agent-background-shell-${shell.id}`}
                  title={shell.command || shell.id}
                  caption={
                    shell.exit === undefined
                      ? (shell.cwd ?? shell.status)
                      : `${shell.status} · exit ${shell.exit}`
                  }
                  selected={open}
                  onPress={() => selectShell(shell.id)}
                  leading={
                    <StatusDot size={7} filled pulse={shell.status === 'running'} color={tone} />
                  }
                  meta={
                    shell.status === 'running' ? (
                      <PressableScale
                        testID={`agent-background-kill-${shell.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={t`Stop this command`}
                        disabled={killing !== null}
                        onPress={() => void handleKill(shell.id)}
                        style={[
                          styles.killBtn,
                          { borderRadius: profile.chrome.control },
                          { borderColor: theme.colors.danger },
                        ]}>
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
                    ) : null
                  }
                  trailing={
                    open ? (
                      <View
                        style={[
                          styles.outputBox,
                          { borderRadius: profile.chrome.surface },
                          { backgroundColor: surfaceBackground(theme.colors.surface) },
                        ]}>
                        <Text
                          selectable
                          style={[styles.outputText, { color: colors.muted, fontFamily: mono }]}>
                          {output || t`No output yet.`}
                        </Text>
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
  return capLines(output, lines).text;
}

const styles = StyleSheet.create({
  centre: { padding: 40, alignItems: 'center', justifyContent: 'center', gap: SHEET_LADDER.snug },
  emptyText: { textAlign: 'center' },
  killBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  outputBox: {
    marginBottom: SHEET_LADDER.snug,
    padding: SHEET_LADDER.gap,
    borderCurve: 'continuous',
  },
  // The family is merged in at the render site from `useMonoFontFamily`. It
  // used to be the literal `'monospace'`, which is Android's generic family and
  // on iOS is not a family at all -- so a reader who had installed their own
  // mono face saw every other mono surface in the app change and this one stay
  // exactly as it was: a detached shell's stdout, the text most obviously
  // meant to be read column by column, drawn in whatever the platform picked.
  // A `StyleSheet.create` object cannot call a hook, so what stays here is
  // everything that is not the family.
  outputText: {
    fontSize: AGENT_TYPE.meta.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
});
