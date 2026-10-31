import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { CloseIcon } from '@/icons';
import { withAlpha } from '@/lib/color';

/**
 * The furniture of the sheets Home draws over itself in place -- Stage's
 * pulled-up Sessions list and the reply drawer -- so both are one design: the
 * grabber, and a large title with its controls and × on the right.
 */

/** The grabber: a short soft bar centred over the sheet. */
export function HomeSheetGrabber({ tint, style }: { tint?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useThemeTokens();
  return (
    <View
      pointerEvents="none"
      style={[
        homeSheetStyles.grabber,
        { backgroundColor: tint ?? withAlpha(theme.colors.text, 0.3) },
        style,
      ]}
    />
  );
}

/** The sheet's title on the left; its quiet controls, then ×, on the right. */
export function HomeSheetHeader({
  title,
  titleLines,
  titleVariant = 'heading',
  compact = false,
  caption,
  trailing,
  onClose,
  closeTestID,
}: {
  title: string;
  titleLines?: number;
  /** A sheet that leaves room for its content asks for a smaller title. */
  titleVariant?: 'heading' | 'subheading' | 'body';
  /** Compact chrome for a transcript that needs the available height. */
  compact?: boolean;
  /** One quiet line under the title. */
  caption?: ReactNode;
  trailing?: ReactNode;
  onClose: () => void;
  closeTestID?: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <View style={[homeSheetStyles.header, compact && homeSheetStyles.compactHeader]}>
      <View style={homeSheetStyles.headerCopy}>
        <Text variant={titleVariant} accessibilityRole="header" numberOfLines={titleLines}>
          {title}
        </Text>
        {caption}
      </View>
      {trailing}
      <PressableScale
        testID={closeTestID}
        accessibilityRole="button"
        accessibilityLabel={t`Close`}
        style={compact ? homeSheetStyles.compactAction : undefined}
        hitSlop={compact ? 0 : 12}
        onPress={onClose}>
        <CloseIcon size={20} color={theme.colors.textMuted} />
      </PressableScale>
    </View>
  );
}

export const homeSheetStyles = StyleSheet.create({
  grabber: { width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  compactHeader: { paddingHorizontal: 12, paddingVertical: 6, gap: 4 },
  compactAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, gap: 2 },
  content: { paddingHorizontal: 18, gap: 16 },
});
