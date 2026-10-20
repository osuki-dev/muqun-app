import { useMemo } from 'react';
import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens, useToast } from '@osuki-dev/ui';

import { AppearanceIcon } from '@/icons';
import { useOpenThemeEditor } from '@/hooks/use-open-theme-editor';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { parseThemeManifest, type ThemeManifest } from '@/theme/schema';

/**
 * "Preview theme" under a ```muqun-theme fence an agent pasted.
 *
 * The fence is the manifest itself, so nothing is fetched: a valid one opens
 * the ordinary theme preview, where Apply stays the reader's explicit choice.
 * Anything the schema refuses draws nothing extra.
 */
export function ThemeFencePreview({ source }: { source: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const { showToast } = useToast();
  const openThemeEditor = useOpenThemeEditor();
  const manifest = useMemo((): ThemeManifest | null => {
    try {
      return parseThemeManifest(source);
    } catch {
      return null;
    }
  }, [source]);
  if (!manifest) return null;
  return (
    <PressableScale
      testID="agent-theme-fence-preview"
      accessibilityRole="button"
      accessibilityLabel={t`Preview theme ${manifest.name}`}
      onPress={() => {
        try {
          openThemeEditor({ manifest }, 'conversation');
        } catch (failure) {
          showToast({
            variant: 'danger',
            message: failure instanceof Error ? failure.message : t`Could not open this theme.`,
          });
        }
      }}
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
        borderRadius: 12,
      }}>
      <AppearanceIcon size={14} color={theme.colors.primary} />
      <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
        {t`Preview theme`}
      </Text>
    </PressableScale>
  );
}
