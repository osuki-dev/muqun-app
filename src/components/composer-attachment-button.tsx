import { AttachmentIcon } from '@/icons';
import { useThemeTokens, PressableScale } from '@osuki-dev/ui';
import type { ReactNode } from 'react';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { ThemeIcon } from '@/components/theme-icon';
import { composerStyles } from '@/components/terminal-composer';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

/**
 * A composer toolbar button that opens a floating menu. While its menu is up
 * it wears the subtle primary fill and announces itself as expanded, so the
 * attachment and options buttons say the same thing about the card above them.
 */
export function ComposerMenuButton({
  testID,
  label,
  hint,
  expanded,
  disabled = false,
  onPress,
  children,
}: {
  testID: string;
  label: string;
  hint?: string;
  expanded: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ expanded, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        composerStyles.button,
        { borderRadius: profile.chrome.roundControl },
        expanded && { backgroundColor: background(theme.colors.primarySubtle) },
        disabled && composerStyles.disabledButton,
      ]}>
      {children}
    </PressableScale>
  );
}

export function ComposerAttachmentButton({
  color,
  size = 17,
  ...button
}: {
  testID: string;
  label: string;
  expanded: boolean;
  disabled?: boolean;
  onPress: () => void;
  color: string;
  size?: number;
}) {
  return (
    <ComposerMenuButton {...button}>
      <ThemeIcon name="chrome.attach" fallback={AttachmentIcon} size={size} color={color} />
    </ComposerMenuButton>
  );
}
