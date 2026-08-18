import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Camera, FileUp, Images } from 'lucide-react-native';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import type { AttachmentSource } from '@/lib/attachments';
import { fadeInDown, fadeOutDown } from '@/lib/motion';

/**
 * Descriptors rather than strings, because this table is at module scope.
 *
 * A `` t`Take photo` `` here would be expanded by the macro and extracted, and
 * would still be wrong: it evaluates once, when the module is first imported,
 * against whatever locale was active then -- which is English, since the
 * provider activates the source locale before anything renders and only moves
 * to the user's language a few frames later. The menu would have been built in
 * English and stayed there for the life of the process, including across a
 * language switch in Settings.
 *
 * `msg` is inert: it records the message and translates nothing. The two words
 * become words at the call site, through the `_` from `useLingui()`, which
 * re-runs when the locale changes.
 */
const OPTIONS: {
  source: AttachmentSource;
  label: MessageDescriptor;
  Icon: typeof Camera;
}[] = [
  { source: 'camera', label: msg`Take photo`, Icon: Camera },
  { source: 'library', label: msg`Photo library`, Icon: Images },
  { source: 'file', label: msg`Choose files`, Icon: FileUp },
];

/**
 * The ways to attach a file, shown as a small popup above the composer. It
 * reuses the slash-command suggestion list's shape rather than a sheet, so
 * choosing a source never displaces the message being written.
 *
 * It borrows that list's motion too, and for the same reason: both rise out of
 * the dock they belong to, so `fadeInDown` starts them under the composer and
 * lifts them into place. The menu used to appear and vanish between two frames,
 * which reads as a mis-render rather than as an answer to the tap that opened
 * it.
 *
 * The tap-outside backdrop behind it is deliberately not faded -- it carries no
 * colour at all, only a `Pressable` catching the tap, so there is nothing there
 * to cross-fade.
 */
export function AttachmentMenu({
  onSelect,
  textColor,
}: {
  onSelect: (source: AttachmentSource) => void;
  textColor: string;
}) {
  const theme = useThemeTokens();
  const { _ } = useLingui();

  return (
    <Animated.View
      entering={fadeInDown('dropdown')}
      exiting={fadeOutDown('micro')}
      style={[
        styles.menu,
        {
          backgroundColor: theme.colors.surface,
        },
      ]}>
      {OPTIONS.map(({ source, label, Icon }) => {
        const name = _(label);
        return (
          <PressableScale
            key={source}
            accessibilityLabel={name}
            onPress={() => onSelect(source)}
            style={styles.option}>
            <Icon size={17} color={theme.colors.primary} />
            <Text variant="bodySmall" color={textColor}>
              {name}
            </Text>
          </PressableScale>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  menu: {
    alignSelf: 'flex-start',
    marginHorizontal: 12,
    marginBottom: 7,
    minWidth: 190,
    borderRadius: appChrome.radius.popover,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingVertical: 4,
    boxShadow: appChrome.shadow.popover,
  },
  option: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
});
