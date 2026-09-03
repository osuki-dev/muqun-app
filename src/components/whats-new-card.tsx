// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { Check, Sparkles, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { fadeInDown, fadeOutUp } from '@/lib/motion';
import { RELEASE_NOTES } from '@/lib/release-notes';

const SEEN_KEY = 'muqun.seen-notes.v1';

// A stable fingerprint of the notes themselves. Keying on this rather than on
// Updates.updateId means the card shows only when the changelog actually
// changes -- rapid same-notes OTAs during iteration don't re-nag the user.
// The English source text, deliberately: a fingerprint over the *rendered*
// notes would re-show the card to anyone who switches language.
const NOTES_SIGNATURE = RELEASE_NOTES.items.map((item) => item.message ?? item.id).join('\u0001');

/**
 * Announces what changed after an over-the-air update. It shows once per distinct
 * changelog and never on a store install (that launch is embedded, not an OTA).
 * A store build with no updates enabled never reaches the check.
 */
export function WhatsNewCard() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    async function check() {
      if (!Updates.isEnabled || Updates.isEmbeddedLaunch) return;
      if (RELEASE_NOTES.items.length === 0) return;
      try {
        const seen = await SecureStore.getItemAsync(SEEN_KEY);
        if (!active || seen === NOTES_SIGNATURE) return;
        // Mark seen as soon as we decide to show it, so it appears once per
        // changelog rather than every launch until the user happens to dismiss.
        await SecureStore.setItemAsync(SEEN_KEY, NOTES_SIGNATURE, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        if (active) setShow(true);
      } catch {
        // A keychain hiccup just means no card this launch; nothing to surface.
      }
    }
    void check();
    return () => {
      active = false;
    };
  }, []);

  if (!show) return null;

  return (
    <SafeAreaView edges={['top']} style={styles.overlay}>
      <Animated.View
        // Timed, not sprung: see the note on `UpdateStatusBanner`, which shares
        // this slot under the status bar.
        entering={fadeInDown('medium')}
        exiting={fadeOutUp('short')}
        style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: theme.colors.primarySubtle }]}>
            <Sparkles size={15} color={theme.colors.primary} strokeWidth={2.2} />
          </View>
          <Text variant="label" style={styles.title}>
            {_(RELEASE_NOTES.title)}
          </Text>
          {/* `PressableScale`, like every other dismissal in the app: a raw
              Pressable answers a tap with nothing at all, and this is the one
              control on a card that covers the screen. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Dismiss what's new`}
            hitSlop={10}
            pressedScale={0.9}
            onPress={() => setShow(false)}
            style={[styles.close, { backgroundColor: theme.colors.surfaceRaised }]}>
            <X size={15} color={theme.colors.textMuted} strokeWidth={2.2} />
          </PressableScale>
        </View>
        <View style={styles.items}>
          {RELEASE_NOTES.items.map((item) => (
            <View key={item.id ?? item.message} style={styles.itemRow}>
              <Check
                size={14}
                color={theme.colors.primary}
                strokeWidth={2.4}
                style={styles.itemTick}
              />
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.itemText}>
                {_(item)}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    zIndex: 99,
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: appChrome.radius.noticeCard,
    borderCurve: 'continuous',
    padding: 14,
    gap: 12,
    boxShadow: appChrome.shadow.notice,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  items: {
    gap: 8,
    paddingHorizontal: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemTick: {
    marginTop: 2,
  },
  itemText: {
    flex: 1,
    lineHeight: 19,
  },
});
