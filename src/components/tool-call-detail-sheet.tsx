import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';

import { AssetViewer } from '@/components/asset-viewer';
import { SheetScene, SheetSceneQuietAction, SHEET_LADDER } from '@/components/sheet-scene';
import { Text } from '@/components/text';
import { ToolCallCodeRows } from '@/components/tool-call-code-rows';
import { basename } from '@/lib/agent-tool-output';
import { assetFromToolFile, type SessionAsset } from '@/lib/session-assets';
import {
  formatToolDuration,
  runningElapsedMs,
  toolCallDetail,
  toolCallRows,
  type ToolCallDetail,
} from '@/lib/tool-call-detail';
import { useLiveToolPart, useToolCallDetailStore } from '@/stores/tool-call-detail';

/** How often a running call's clock moves: often enough for tenths. */
const CLOCK_TICK_MS = 100;

/** `Date.now()`, kept current only while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/**
 * `Completed · 15ms`, `Failed · 14ms`, `Running · 3.2s`, `Cancelled`.
 *
 * Its own component so the running clock re-renders one line, not the list.
 */
function ToolCallStatusLine({ detail }: { detail: ToolCallDetail }) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const ticking = detail.status === 'running' && detail.startedAt !== undefined;
  const now = useNow(ticking);
  const label =
    detail.status === 'completed'
      ? t`Completed`
      : detail.status === 'failed'
        ? t`Failed`
        : detail.status === 'cancelled'
          ? t`Cancelled`
          : t`Running`;
  const elapsed =
    ticking && detail.startedAt !== undefined
      ? runningElapsedMs(detail.startedAt, now)
      : detail.durationMs;
  return (
    <Text
      testID="agent-tool-detail-status"
      variant="caption"
      color={detail.status === 'failed' ? colors.danger : colors.textMuted}
      numberOfLines={1}>
      {elapsed === undefined ? label : `${label} · ${formatToolDuration(elapsed)}`}
    </Text>
  );
}

/**
 * One tool call, whole: the sheet a tap on a transcript's tool row opens.
 *
 * The TUI's tool detail, in this app's furniture: the scene's title is the
 * tool, the line under it is how the call ended, and the body is the input and
 * the output as the diff viewer draws code -- numbered, coloured, panning
 * sideways rather than wrapping. A failure is said in red, by the engine's own
 * words, above whatever the tool printed before it failed.
 */
export function ToolCallDetailSheet() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const opened = useToolCallDetailStore((state) => state.opened);
  const part = useLiveToolPart(opened);
  const workspace = opened?.directory;
  const detail = useMemo(
    () => (part ? toolCallDetail(part, { workspace }) : null),
    [part, workspace]
  );
  const rows = useMemo(() => (detail ? toolCallRows(detail) : []), [detail]);
  const [fileAsset, setFileAsset] = useState<SessionAsset | null>(null);

  if (!detail) {
    return (
      <SheetScene testID="agent-tool-detail-sheet" title={t`Tool call`}>
        <View style={styles.missing}>
          <Text variant="bodySmall">{t`This tool call is no longer available.`}</Text>
        </View>
      </SheetScene>
    );
  }

  const copy = (text: string, message: string) => {
    void Clipboard.setStringAsync(text).then(() =>
      showToast({ variant: 'info', title: t`Copied`, message })
    );
  };
  const outputCopy = [detail.error, detail.output?.text].filter(Boolean).join('\n\n');
  const fullOutputPath = detail.fullOutputPath;
  // `fullOutputPath` is only set for a path inside the session's workspace
  // (`workspaceOutputPath`), and it goes nowhere but the Files viewer, which
  // reads through `GET /api/assets/{id}/content` -- the route the gateway
  // canonicalises against the workspace root. Never a generic opener.
  const canOpenFile =
    fullOutputPath !== undefined &&
    opened?.sessionId !== undefined &&
    (detail.large || detail.truncated);

  return (
    <SheetScene
      testID="agent-tool-detail-sheet"
      title={detail.name}
      caption={detail.title}
      detail={<ToolCallStatusLine detail={detail} />}>
      <View style={styles.body}>
        <View style={styles.code}>
          <ToolCallCodeRows detail={detail} rows={rows} bottomInset={SHEET_LADDER.gap} />
        </View>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, SHEET_LADDER.gap) }]}>
          <SheetSceneQuietAction
            testID="agent-tool-detail-copy-input"
            label={t`Copy input`}
            disabled={!detail.input}
            onPress={() => copy(detail.input?.text ?? '', t`Input copied to clipboard`)}
          />
          <SheetSceneQuietAction
            testID="agent-tool-detail-copy-output"
            label={t`Copy output`}
            disabled={!outputCopy}
            onPress={() => copy(outputCopy, t`Output copied to clipboard`)}
          />
          {canOpenFile ? (
            <SheetSceneQuietAction
              testID="agent-tool-detail-open-file"
              label={t`Open as file`}
              onPress={() =>
                setFileAsset(
                  assetFromToolFile(
                    { uri: fullOutputPath, mime: 'text/plain', name: basename(fullOutputPath) },
                    opened?.sessionId
                  )
                )
              }
            />
          ) : null}
        </View>
      </View>
      {fileAsset ? <AssetViewer asset={fileAsset} onClose={() => setFileAsset(null)} /> : null}
    </SheetScene>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  code: { flex: 1, minHeight: 0, marginHorizontal: SHEET_LADDER.gutter },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: SHEET_LADDER.section,
    paddingHorizontal: SHEET_LADDER.gutter,
  },
  missing: { paddingHorizontal: SHEET_LADDER.gutter, paddingVertical: SHEET_LADDER.section },
});
