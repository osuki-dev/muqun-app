import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLingui } from '@lingui/react/macro';
import { Check, Copy, RefreshCw, Terminal } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { SheetScene, SHEET_LADDER } from '@/components/sheet-scene';
import { appChrome } from '@/constants/appearance';
import { feedback } from '@/lib/feedback';
import type { OpenCodeReadiness } from '@/lib/home-opencode-readiness';

export interface OpenCodeGuideSheetProps {
  serverLabel: string;
  onClose: () => void;
  readiness: OpenCodeReadiness;
  onCheckAgain: () => Promise<OpenCodeReadiness>;
  onOpenAgent?: () => void;
}

const OPENCODE_COMMAND = 'opencode serve --service';
const COPIED_HOLD_MS = 2000;

/**
 * What to run when OpenCode is not answering, as a native form sheet route.
 *
 * Content-sized, and the shortest sheet in the app: one sentence, one command
 * to copy, one button. `sheet-scene.tsx`'s heading and ground, and no card
 * around the command -- the monospace line on the ground is the object.
 */
export const OpenCodeGuideSheet = memo(function OpenCodeGuideSheet({
  serverLabel,
  onClose,
  readiness,
  onCheckAgain,
  onOpenAgent,
}: OpenCodeGuideSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();

  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(OPENCODE_COMMAND);
    void feedback('success');
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
  }, []);

  const handleCheckAgain = useCallback(async () => {
    setChecking(true);
    setStatusMessage(null);
    try {
      const result = await onCheckAgain();
      if (result.status === 'ready') {
        void feedback('success');
        if (onOpenAgent) onOpenAgent();
        else onClose();
        return;
      }
      void feedback('warning');
      setStatusMessage(
        result.status === 'unsupported'
          ? t`This gateway does not advertise OpenCode sessions.`
          : t`Still not answering. Check the service is running on the host.`
      );
    } catch {
      void feedback('warning');
      setStatusMessage(t`Still not answering. Check the service is running on the host.`);
    } finally {
      setChecking(false);
    }
  }, [onCheckAgain, onClose, onOpenAgent, t]);

  return (
    <SheetScene
      testID="opencode-guide-sheet"
      title={t`Start OpenCode`}
      caption={serverLabel}
      contentSized>
      <View
        style={[styles.column, { paddingBottom: Math.max(insets.bottom, SHEET_LADDER.section) }]}>
        <Text variant="caption" color={theme.colors.textMuted} style={styles.blurb}>
          {readiness.status === 'unsupported'
            ? t`This gateway does not advertise OpenCode sessions.`
            : t`The OpenCode daemon is not running on this host. Run this and it will be.`}
        </Text>

        {readiness.status === 'offline' ? (
          <>
            <PressableScale
              testID="opencode-guide-copy-cmd"
              accessibilityRole="button"
              accessibilityLabel={copied ? t`Copied` : t`Copy the command`}
              onPress={handleCopy}
              style={[styles.command, { borderColor: theme.colors.border }]}>
              <Text variant="caption" color={theme.colors.primary} weight="bold">
                $
              </Text>
              <Text
                selectable
                variant="bodySmall"
                weight="semibold"
                color={theme.colors.text}
                style={styles.commandText}>
                {OPENCODE_COMMAND}
              </Text>
              {copied ? (
                <Check size={14} color={theme.colors.success} strokeWidth={2.5} />
              ) : (
                <Copy size={14} color={theme.colors.textSubtle} strokeWidth={2} />
              )}
            </PressableScale>

            <View style={styles.tip}>
              <Terminal size={13} color={theme.colors.textSubtle} />
              <Text variant="caption" color={theme.colors.textSubtle} style={styles.tipText}>
                {t`Run it under systemd or tmux to keep it up after you log out.`}
              </Text>
            </View>
          </>
        ) : null}

        {statusMessage ? (
          <Text variant="caption" color={theme.colors.danger} style={styles.status}>
            {statusMessage}
          </Text>
        ) : null}

        <PressableScale
          testID="opencode-guide-check-again-btn"
          accessibilityRole="button"
          accessibilityLabel={t`Check again`}
          disabled={checking}
          onPress={handleCheckAgain}
          style={[styles.action, { backgroundColor: theme.colors.primary }]}>
          {checking ? (
            <ActivityIndicator size="small" color={theme.colors.onPrimary} />
          ) : (
            <RefreshCw size={15} color={theme.colors.onPrimary} strokeWidth={2.2} />
          )}
          <Text variant="bodySmall" weight="bold" color={theme.colors.onPrimary}>
            {t`Check again`}
          </Text>
        </PressableScale>
      </View>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  column: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingTop: SHEET_LADDER.gap,
    gap: SHEET_LADDER.snug,
  },
  blurb: { lineHeight: 18 },
  // A hairline box, not a filled card: the command is a line of text on the
  // ground with a tap target around it.
  command: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    paddingHorizontal: SHEET_LADDER.snug,
    paddingVertical: SHEET_LADDER.snug,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  commandText: { flex: 1, letterSpacing: 0.2 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: SHEET_LADDER.gap },
  tipText: { flex: 1, lineHeight: 16 },
  status: { lineHeight: 16 },
  action: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SHEET_LADDER.gap,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    marginTop: SHEET_LADDER.tight,
  },
});
