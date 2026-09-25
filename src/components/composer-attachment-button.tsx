import { Paperclip } from 'lucide-react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { ThemeIcon } from '@/components/theme-icon';
import { composerStyles } from '@/components/terminal-composer';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

export function ComposerAttachmentButton({
  testID,
  label,
  expanded,
  disabled = false,
  onPress,
  color,
  size = 17,
}: {
  testID: string;
  label: string;
  expanded: boolean;
  disabled?: boolean;
  onPress: () => void;
  color: string;
  size?: number;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        composerStyles.button,
        { borderRadius: profile.chrome.roundControl },
        expanded && { backgroundColor: background(theme.colors.primarySubtle) },
        disabled && { opacity: 0.5 },
      ]}>
      <ThemeIcon name="chrome.attach" fallback={Paperclip} size={size} color={color} />
    </PressableScale>
  );
}
