import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Check, Copy, RefreshCw, Terminal, X, AlertCircle } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame } from '@/components/sheet-ground';
import { SheetHeading } from '@/components/sheet-heading';
import { SheetHandle } from '@/components/sheet-route-frame';
import { LADDER, SectionLabel, SettingsCard } from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import { feedback } from '@/lib/feedback';
import { OpenCodeIcon } from '@/components/opencode-icon';

/**
 * What to run when OpenCode is not answering, as a native form sheet route.
 *
 * Content-sized: one banner, one command and one button. A full-height sheet
 * for a line to paste would be the app implying the task is bigger than it is,
 * which is the same argument `web-service` makes.
 */
export interface OpenCodeGuideSheetProps {
  serverLabel: string;
  onClose: () => void;
  onCheckAgain: () => Promise<boolean>;
  onOpenAgent?: () => void;
}

const OPENCODE_COMMAND = 'opencode serve --service';
const COPIED_HOLD_MS = 2000;

export const OpenCodeGuideSheet = memo(function OpenCodeGuideSheet({
  serverLabel,
  onClose,
  onCheckAgain,
  onOpenAgent,
}: OpenCodeGuideSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();

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
      const isOnline = await onCheckAgain();
      if (isOnline) {
        void feedback('success');
        onClose();
        onOpenAgent?.();
      } else {
        void feedback('warning');
        setStatusMessage(t`OpenCode is still unreachable. Please ensure the service is running.`);
      }
    } catch {
      void feedback('warning');
      setStatusMessage(t`OpenCode is still unreachable. Please ensure the service is running.`);
    } finally {
      setChecking(false);
    }
  }, [onCheckAgain, onClose, onOpenAgent, t]);

  return (
    // The ground and one content-sized column: the two subviews a native form
    // sheet lays itself out around, and the shape `fitToContents` measures.
    <SheetFrame testID="opencode-guide-sheet">
      <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <SheetHandle style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View
              style={[
                styles.iconBadge,
                {
                  backgroundColor: surfaceBackground(withAlpha(theme.colors.warning, 0.14)),
                  borderColor: withAlpha(theme.colors.warning, 0.35),
                },
              ]}>
              <OpenCodeIcon size={20} color={theme.colors.warning} />
            </View>
            <SheetHeading title={t`OpenCode Service Offline`} caption={serverLabel} />
          </View>

          <GlassChrome face="sheet" style={styles.closeButton}>
            <PressableScale accessibilityLabel={t`Close`} onPress={onClose} style={styles.closeHit}>
              <X size={18} color={theme.colors.text} />
            </PressableScale>
          </GlassChrome>
        </View>

        {/* Explanatory banner */}
        <SettingsCard>
          <View style={styles.descCard}>
            <AlertCircle size={18} color={theme.colors.warning} style={styles.descIcon} />
            <Text variant="caption" color={theme.colors.textMuted} style={styles.descText}>
              {t`OpenCode agent daemon is not running on this host. Run \`opencode serve --service\` to start it.`}
            </Text>
          </View>
        </SettingsCard>

        {/* Command card with 1-tap copy */}
        <View style={styles.section}>
          <SectionLabel title={t`Command`} />
          <SettingsCard>
            <PressableScale
              testID="opencode-guide-copy-cmd"
              accessibilityRole="button"
              accessibilityLabel={copied ? t`Copied` : t`Copy`}
              onPress={handleCopy}
              style={[
                styles.commandRow,
                { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              ]}>
              <View style={styles.commandCode}>
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
              </View>

              <View
                style={[
                  styles.copyChip,
                  copied
                    ? { backgroundColor: theme.colors.primary }
                    : {
                        backgroundColor: surfaceBackground(theme.colors.surface),
                        borderColor: theme.colors.border,
                        borderWidth: StyleSheet.hairlineWidth,
                      },
                ]}>
                {copied ? (
                  <>
                    <Check size={12} color="#fff" strokeWidth={2.5} />
                    <Text variant="caption" weight="semibold" color="#fff">
                      {t`Copied`}
                    </Text>
                  </>
                ) : (
                  <>
                    <Copy size={12} color={theme.colors.text} strokeWidth={2} />
                    <Text variant="caption" weight="medium" color={theme.colors.text}>
                      {t`Copy`}
                    </Text>
                  </>
                )}
              </View>
            </PressableScale>
          </SettingsCard>
        </View>

        {/* Background Tip */}
        <View
          style={[
            styles.tipContainer,
            {
              backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
              borderColor: surfaceBackground(theme.colors.border),
            },
          ]}>
          <Terminal size={14} color={theme.colors.textMuted} />
          <Text variant="caption" color={theme.colors.textMuted} style={styles.tipText}>
            {t`Tip: Run with systemd or tmux to keep OpenCode running in the background.`}
          </Text>
        </View>

        {/* Status or error message */}
        {statusMessage ? (
          <Text variant="caption" color={theme.colors.danger} style={styles.statusError}>
            {statusMessage}
          </Text>
        ) : null}

        {/* Check Again Button */}
        <PressableScale
          testID="opencode-guide-check-again-btn"
          accessibilityRole="button"
          accessibilityLabel={t`Check Again`}
          disabled={checking}
          onPress={handleCheckAgain}
          style={[styles.checkAgainBtn, { backgroundColor: theme.colors.primary }]}>
          {checking ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <RefreshCw size={16} color="#fff" strokeWidth={2.2} />
          )}
          <Text variant="bodySmall" weight="bold" color="#fff">
            {t`Check Again`}
          </Text>
        </PressableScale>
      </View>
    </SheetFrame>
  );
});

const styles = StyleSheet.create({
  handle: {
    marginBottom: 2,
  },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap,
    gap: LADDER.snug,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: LADDER.snug,
    marginTop: 4,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeHit: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  descCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: LADDER.snug,
  },
  descIcon: {
    marginTop: 2,
  },
  descText: {
    flex: 1,
    lineHeight: 18,
  },
  section: {
    gap: LADDER.tight,
  },
  commandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: LADDER.snug,
    paddingVertical: 12,
    gap: 10,
  },
  commandCode: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commandText: {
    letterSpacing: 0.2,
  },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderCurve: 'continuous',
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: LADDER.snug,
    paddingVertical: 10,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  tipText: {
    flex: 1,
    lineHeight: 16,
  },
  statusError: {
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  checkAgainBtn: {
    height: 48,
    borderRadius: 14,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
});
