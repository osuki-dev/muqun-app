import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';
import { CameraIcon, UploadFileIcon, PhotosIcon } from '@/icons';
import { StyleSheet } from 'react-native';

import { FloatingMenu } from '@/components/floating-menu';
import type { AttachmentSource } from '@/lib/attachments';

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
  Icon: typeof CameraIcon;
}[] = [
  { source: 'camera', label: msg`Take photo`, Icon: CameraIcon },
  { source: 'library', label: msg`Photo library`, Icon: PhotosIcon },
  { source: 'file', label: msg`Choose files`, Icon: UploadFileIcon },
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
 * The tap-outside catcher behind it carries no colour at all, only a
 * `Pressable` taking the tap: the card is the menu, and the page around it
 * stays as it was.
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
    <FloatingMenu>
      {OPTIONS.map(({ source, label, Icon }) => {
        const name = _(label);
        return (
          <PressableScale
            key={source}
            accessibilityRole="button"
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
    </FloatingMenu>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
});
