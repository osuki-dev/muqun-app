import { AttachmentIcon } from '@/icons';
import { useThemeTokens } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import type { ReactNode } from 'react';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { ThemeIcon } from '@/components/theme-icon';
import { composerStyles } from '@/components/terminal-composer';

/**
 * A composer toolbar button that opens a floating menu. It never wears a
 * fill: while its menu is up its icon takes the theme's primary tint (the
 * caller's glyph colour) and it announces itself as expanded, so every
 * toolbar button looks alike and says the same thing about the card above it.
 */
export function ComposerMenuButton({
  testID,
  label,
  hint,
  expanded,
  disabled = false,
  onPress,
  onLongPress,
  children,
}: {
  testID: string;
  label: string;
  hint?: string;
  expanded: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  const profile = useAppearanceProfile();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ expanded, disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        composerStyles.button,
        { borderRadius: profile.chrome.roundControl },
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
  const theme = useThemeTokens();
  return (
    <ComposerMenuButton {...button}>
      <ThemeIcon
        name="chrome.attach"
        fallback={AttachmentIcon}
        size={size}
        color={button.expanded ? theme.colors.primary : color}
      />
    </ComposerMenuButton>
  );
}
