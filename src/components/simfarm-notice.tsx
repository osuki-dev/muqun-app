import { Trans, useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassChrome } from '@/components/glass-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { CloseIcon } from '@/icons';

/**
 * The shape every state that is not a simulator is drawn in.
 *
 * A header when this is a modal, and under it one bounded column centred in
 * whatever is left. The column is capped rather than stretched because these
 * are two sentences and a field: on a Pad's full width an uncapped paragraph
 * runs to a line nobody tracks back from, and the field and its button drift to
 * opposite edges. 420 is the measure the rest of the app's centred copy uses.
 */
export function SimfarmNotice({
  icon,
  title,
  embedded,
  onClose,
  children,
}: {
  icon?: ReactNode;
  title?: string;
  embedded: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  const surfaceBackground = useSurfaceBackground();
  const theme = useThemeTokens();
  const { t } = useLingui();
  // The modal reaches the top of the screen with the status bar hidden, so
  // the header pays the inset itself: what is left up there is the camera
  // cutout, and a title under a Dynamic Island is a title with a hole in it.
  const insets = useSafeAreaInsets();

  return (
    // Opacity audit: floor -- a full-screen preview must cover the previous route.
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {/* Setup states need a title and a direct way back. The live viewer
          instead uses its compact device selector and device controls. */}
      {onClose && !embedded ? (
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + 10,
              paddingLeft: 16 + insets.left,
              paddingRight: 16 + insets.right,
            },
          ]}>
          <View style={styles.headerRow}>
            <Text variant="bodySmall" style={styles.headerTitle}>
              <Trans>Simulator</Trans>
            </Text>
            {/* The same chrome as the Files sheet, from the same component:
                two screens whose close buttons were different materials would
                read as two apps. `sheet`, not `floating` -- see `GlassChrome`. */}
            <GlassChrome face="sheet" shape="pill" style={styles.iconButton}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Close preview`}
                testID="simfarm-close"
                onPress={onClose}
                style={styles.iconButtonHit}>
                <CloseIcon size={18} color={theme.colors.text} />
              </PressableScale>
            </GlassChrome>
          </View>
        </View>
      ) : null}
      {/* Centred by the content container rather than by the view, because the
          port field is the one control here and the number pad covers exactly
          where a centred column puts it. `flexGrow` keeps the column in the
          middle while there is room and lets the scroller lift it once there is
          not, which is the same instrument every other field in this app sits
          in (`open-web-service-sheet.tsx`, `ssh-host-list.tsx`). */}
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.body,
          embedded ? styles.embeddedPad : styles.modalPad,
          embedded
            ? null
            : {
                paddingBottom: insets.bottom + 24,
                paddingLeft: insets.left + 24,
                paddingRight: insets.right + 24,
              },
        ]}>
        <View style={styles.column}>
          {icon ? (
            <View
              style={[
                styles.glyph,
                { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              ]}>
              {icon}
            </View>
          ) : null}
          {title ? (
            <Text variant="subheading" style={styles.middle}>
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const KEYBOARD_BOTTOM_OFFSET = 88;
const styles = StyleSheet.create({
  fill: { flex: 1 },
  middle: { textAlign: 'center' },
  header: { paddingBottom: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { flex: 1, minWidth: 0, fontSize: 20, lineHeight: 25, includeFontPadding: false },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  column: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 16 },
  glyph: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  modalPad: { paddingHorizontal: 24 },
  embeddedPad: { paddingHorizontal: 12, paddingBottom: 12 },
});
