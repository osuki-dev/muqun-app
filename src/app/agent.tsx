import { useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronDown, Cpu } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { ScreenHeader } from '@/components/screen-header';
import { ThemeArtwork } from '@/components/theme-artwork';
import { AgentWorkbench } from '@/components/agent-workbench';
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { ModelRef } from '@/lib/agent-session';

/**
 * The header's height above the content, matching Settings and every other
 * pushed screen so the glass pill sits at the same altitude.
 */
const HEADER_INSET = NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 8;

function formatModelName(modelId?: string): string {
  if (!modelId) return 'Model';
  const known: Record<string, string> = {
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
    'deepseek-v4-flash-free': 'DeepSeek V4 Flash',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gpt-6-astra': 'GPT-6 Astra',
    'gpt-6-astra-fast': 'GPT-6 Astra Fast',
    'muse-spark-1.3-contributor-free': 'Muse Spark 1.3',
    'ling-3.0-flash-fin-free': 'Ling 3.0 Flash',
  };
  if (known[modelId]) return known[modelId];
  return modelId
    .split(/[-_]/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Dedicated OpenCode Agent Screen.
 *
 * Follows the same layout as Settings: a themed surface with the shell
 * wallpaper, content scrolling underneath a glass pill header, and status
 * bar matching the resolved colour mode.
 *
 * The top-right header features the active model pill selector, displaying
 * the current model name and opening the compact provider-grouped model sheet.
 */
export default function AgentScreen() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const params = useLocalSearchParams<{ sessionId?: string; asid?: string }>();

  const sessionId = params.sessionId || 'herdr';
  const [activeModel, setActiveModel] = useState<ModelRef | undefined>(undefined);
  const openModelSheetRef = useRef<(() => void) | null>(null);

  const modelDisplayName = formatModelName(activeModel?.model_id);

  return (
    <View style={[styles.page, { backgroundColor: surfaceBackground(theme.colors.background) }]}>
      <ThemeArtwork slot="shell.background" />
      <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />

      <AgentWorkbench
        sessionId={sessionId}
        initialAsid={params.asid}
        topInset={insets.top + HEADER_INSET}
        bottomInset={insets.bottom}
        onModelChange={setActiveModel}
        openModelSheetRef={openModelSheetRef}
      />

      {/* Last and absolutely positioned so content scrolls under the glass,
          with top-right model pill selector */}
      <View pointerEvents="box-none" style={styles.header}>
        <ScreenHeader
          title={t`Agent Workspace`}
          rightPill={
            <GlassChrome surface="navigation" style={styles.modelHeaderPill}>
              <PressableScale
                testID="agent-header-model-pill"
                onPress={() => openModelSheetRef.current?.()}
                accessibilityLabel={t`Select model`}
                style={styles.modelHeaderPillInner}>
                <Cpu size={14} color={theme.colors.primary} />
                <Text
                  variant="caption"
                  weight="semibold"
                  numberOfLines={1}
                  color={theme.colors.text}
                  style={styles.modelPillText}>
                  {modelDisplayName}
                </Text>
                <ChevronDown size={12} color={theme.colors.textMuted} />
              </PressableScale>
            </GlassChrome>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  modelHeaderPill: {
    height: NAV_HEADER_CONTROL_SIZE,
    borderRadius: appChrome.radius.navigationPill,
    borderCurve: 'continuous',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  modelHeaderPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: NAV_HEADER_CONTROL_SIZE,
    gap: 6,
    maxWidth: 160,
  },
  modelPillText: {
    flexShrink: 1,
    fontSize: 12,
  },
});
