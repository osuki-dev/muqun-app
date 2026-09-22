import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useThemeTokens } from '@osuki-dev/ui';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { fadeIn, fadeOut, listLayout } from '@/lib/motion';

/** Shared, content-sized shell for terminal connection/status notices. */
export function TerminalNotice({
  children,
  accessibilityLabel,
  style,
}: {
  children: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      entering={fadeIn('micro')}
      exiting={fadeOut('short')}
      layout={listLayout('short')}
      style={[
        terminalNoticeStyles.shell,
        {
          backgroundColor: background(colors.surfaceRaised),
          borderRadius: profile.chrome.transcriptPlate,
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

export const terminalNoticeStyles = StyleSheet.create({
  shell: {
    alignSelf: 'center',
    maxWidth: '100%',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  label: { flexShrink: 1, minWidth: 0, fontWeight: '600' },
  action: { flexShrink: 0, minHeight: 20, justifyContent: 'center' },
});
