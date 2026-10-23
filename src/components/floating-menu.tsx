import { useThemeTokens } from '@osuki-dev/ui';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { appChrome } from '@/constants/appearance';
import { useFloatingSurfaceBackground } from '@/hooks/use-surface-background';
import { fadeInDown, fadeOutDown } from '@/lib/motion';

/**
 * The card a composer toolbar button opens: the attachment sources and Home's
 * task options. One shape for both, so the two read as siblings -- the
 * popover corner and shadow, the floating fill's readability floor, and the
 * slash list's motion, rising out of the dock it belongs to.
 *
 * The card is the whole of it. Whoever opens it supplies an invisible
 * tap-outside catcher; nothing here dims or covers the page.
 *
 * `maxHeight` bounds a list that can outgrow the room above the keyboard; its
 * rows then scroll inside the card instead of running under the status bar.
 */
export function FloatingMenu({
  children,
  width,
  maxHeight,
  testID,
}: {
  children: ReactNode;
  width?: number;
  maxHeight?: number;
  testID?: string;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const floatingBackground = useFloatingSurfaceBackground();
  return (
    <Animated.View
      testID={testID}
      entering={fadeInDown('dropdown')}
      exiting={fadeOutDown('micro')}
      style={[
        styles.menu,
        width === undefined ? styles.hug : { width },
        {
          borderRadius: profile.chrome.popover,
          backgroundColor: floatingBackground(theme.colors.surface),
        },
      ]}>
      {maxHeight === undefined ? (
        children
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight }}>
          {children}
        </ScrollView>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  menu: {
    alignSelf: 'flex-start',
    // No margin of its own: the composer anchors it one gap above the field,
    // the same gap the Stage's session strip keeps.
    borderRadius: appChrome.radius.popover,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingVertical: 4,
    boxShadow: appChrome.shadow.popover,
  },
  hug: { minWidth: 190 },
});
