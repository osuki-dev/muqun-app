import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { Spinner, useThemeTokens } from '@osuki-dev/ui';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { Text } from '@/components/text';
import { Button } from '@/components/themed-button';

export interface ListLoadMoreFooterProps {
  /** Whether there are more items to load beyond the current page. */
  hasMore: boolean;
  /** Whether a load-more operation is currently in flight. */
  loading?: boolean;
  /** Callback triggered to fetch or reveal the next page of items. */
  onLoadMore?: () => void;
  /** Number of items currently shown in the list. */
  shown?: number;
  /** Total number of items available across all pages. */
  total?: number;
  /** Custom status caption. When omitted and shown & total are provided, formats 'Showing X of Y'. */
  statusMessage?: string;
  /** Label for the load more button. Defaults to localized 'Load more'. */
  buttonLabel?: string;
  /** Whether the load more action is disabled. */
  disabled?: boolean;
  /** Root container testID. */
  testID?: string;
  /** Button testID. */
  buttonTestID?: string;
  /** Additional container styles. */
  style?: StyleProp<ViewStyle>;
  /** Optional extra content to render below the status count (e.g. demo notices). */
  children?: ReactNode;
}

/**
 * Universal load-more list footer component.
 *
 * Provides a consistent, profile-aware bottom pagination indicator and action
 * across virtualized lists (LegendList, FlatList, etc.). Adapts padding,
 * control radii, and density to the active AppearanceProfile and theme tokens.
 */
export function ListLoadMoreFooter({
  hasMore,
  loading = false,
  onLoadMore,
  shown,
  total,
  statusMessage,
  buttonLabel,
  disabled = false,
  testID = 'list-load-more-footer',
  buttonTestID = 'list-load-more-button',
  style,
  children,
}: ListLoadMoreFooterProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();

  const countText =
    statusMessage ??
    (shown !== undefined && total !== undefined
      ? t`Showing ${shown} of ${total}`
      : undefined);

  const verticalPadding =
    profile.density === 'compact' ? 12 : profile.density === 'comfortable' ? 20 : 16;

  return (
    <View testID={testID} style={[styles.root, { paddingVertical: verticalPadding }, style]}>
      {hasMore ? (
        <View style={styles.actionContainer}>
          {loading ? (
            <View testID={`${testID}-loading`} style={styles.loadingRow}>
              <Spinner size="sm" />
              <Text variant="caption" color={theme.colors.textMuted} style={styles.loadingLabel}>
                {t`Loading`}
              </Text>
            </View>
          ) : (
            <Button
              variant="secondary"
              testID={buttonTestID}
              disabled={disabled}
              loading={loading}
              onPress={onLoadMore}
              style={{ borderRadius: profile.chrome.control }}>
              {buttonLabel ?? t`Load more`}
            </Button>
          )}
        </View>
      ) : null}

      {countText ? (
        <Text
          testID={`${testID}-count`}
          variant="caption"
          color={theme.colors.textMuted}
          style={styles.countText}>
          {countText}
        </Text>
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  actionContainer: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  loadingLabel: {
    marginLeft: 2,
  },
  countText: {
    textAlign: 'center',
  },
});
