import { memo, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { TwoStepAction } from '@/components/two-step-action';
import { appChrome } from '@/constants/appearance';
import { AGENT_TYPE } from '@/constants/agent-type';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { fadeInDown, fadeOutDown } from '@/lib/motion';

/**
 * The two or three things a row can have done to it, shown where the row is.
 *
 * The agent surface had one of these already -- the attachment sources above
 * the composer, and the agent-mode list beside it -- and three more places that
 * wanted the same control: a session row's rename and delete, a queued prompt's
 * send-now and cancel, a message's roll-back. Writing it a fourth time is how a
 * surface ends up with four menus that agree today.
 *
 * Two grounds, because there are two: a menu raised over the composer is a
 * popover and wears the popover's material, and a menu opened inside a sheet is
 * rows on the sheet's own ground -- a plate inside a frosted plate is the card
 * kit this app spent a release removing. Same control either way: the items,
 * their order, the danger ink, the motion.
 */
export interface AgentActionMenuItem {
  id: string;
  label: string;
  /** A lucide glyph, sized and coloured here. */
  Icon?: ComponentType<{ size?: number; color?: string }>;
  /** `danger` for the one that throws something away. */
  tone?: 'default' | 'danger';
  onPress: () => void;
  /**
   * Ask twice, in the row, before `onPress` runs. For the item that throws
   * something away: the first tap arms it and says what is lost, the second
   * does it. See `two-step-action.tsx`.
   */
  confirm?: { label: string; detail?: string };
  testID?: string;
}

export const AgentActionMenu = memo(function AgentActionMenu({
  items,
  surface = 'popover',
  testID,
}: {
  items: readonly AgentActionMenuItem[];
  /**
   * `popover` for a menu raised over live content; `ground` for one opened
   * inside a sheet, which has a ground of its own already.
   */
  surface?: 'popover' | 'ground';
  testID?: string;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const popover = surface === 'popover';

  return (
    <Animated.View
      testID={testID}
      entering={fadeInDown('dropdown')}
      exiting={fadeOutDown('micro')}
      style={[
        styles.menu,
        popover
          ? [styles.popover, { backgroundColor: surfaceBackground(theme.colors.surface) }]
          : styles.ground,
      ]}>
      {items.map((item) => {
        if (item.confirm) {
          return (
            <TwoStepAction
              key={item.id}
              testID={item.testID}
              label={item.label}
              confirmLabel={item.confirm.label}
              detail={item.confirm.detail}
              Icon={item.Icon}
              onConfirm={item.onPress}
            />
          );
        }
        const danger = item.tone === 'danger';
        const ink = danger ? theme.colors.danger : theme.colors.text;
        return (
          <PressableScale
            key={item.id}
            testID={item.testID}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={item.onPress}
            style={styles.option}>
            {item.Icon ? (
              <View style={styles.optionIcon}>
                <item.Icon size={16} color={danger ? theme.colors.danger : theme.colors.primary} />
              </View>
            ) : null}
            <Text variant="bodySmall" color={ink} style={styles.optionLabel}>
              {item.label}
            </Text>
          </PressableScale>
        );
      })}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  menu: { alignSelf: 'stretch', paddingVertical: 4 },
  popover: {
    alignSelf: 'flex-start',
    marginHorizontal: 12,
    marginBottom: 7,
    minWidth: 190,
    borderRadius: appChrome.radius.popover,
    borderCurve: 'continuous',
    overflow: 'hidden',
    boxShadow: appChrome.shadow.popover,
  },
  // On a sheet the ground is the surface; the menu is a short indented run of
  // rows under the one it belongs to, and nothing is drawn around it.
  ground: { paddingLeft: 8 },
  option: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  optionIcon: { width: 16, alignItems: 'center' },
  optionLabel: { fontSize: AGENT_TYPE.prose.size },
});
