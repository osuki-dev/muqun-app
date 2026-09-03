/**
 * Which of a gateway's sessions the workspace is reading.
 *
 * Most gateways expose one, and for them this sheet does not exist -- the
 * header draws no control at all (`shouldShowSessionSwitcher`). A machine that
 * runs two tmux sockets, or tmux beside Herdr, used to hand the reader whichever
 * one `GET /api/sessions` led with, and that order is the gateway's own liveness
 * ranking rather than a preference. This is where the reader gets to say.
 *
 * The chrome is the language picker's, deliberately: a form sheet with a title,
 * a line saying what the choice means, one row per option and a tick on the
 * current one. A third sheet in this app that looked like neither of the two
 * already here would read as a different app's screen.
 *
 * Each row names the session and, underneath, the terminal system it runs on --
 * `tmux`, `herdr`. Those are the names of the programs and are left in the
 * gateway's own words rather than translated, the same way the language picker
 * writes each language in itself.
 */
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Check } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { LADDER, SettingsCard } from '@/components/settings-chrome';
import { SettingsSheet } from '@/components/settings-sheet';
import { timing } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { type SessionChoice } from '@/lib/session-switcher';

export function SessionSwitcherSheet({
  sessions,
  sessionId,
  onChoose,
  onClose,
}: {
  sessions: SessionChoice[];
  /** The session the workspace is reading right now. */
  sessionId: string;
  onChoose: (sessionId: string) => void;
  onClose: () => void;
}) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();
  useRenderTally('SessionSwitcherSheet');

  /** Apply, then leave -- the order both Appearance pickers use. */
  function choose(next: string) {
    if (next !== sessionId) onChoose(next);
    onClose();
  }

  return (
    <SettingsSheet
      title={t`Session`}
      caption={t`This gateway runs more than one terminal backend. Pick the one to read.`}
      closeLabel={t`Close session picker`}
      onClose={onClose}>
      <SettingsCard>
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            selected={session.id === sessionId}
            accessibilityLabel={
              session.id === sessionId
                ? t`Session ${session.label}, current`
                : t`Session ${session.label}`
            }
            onSelect={() => choose(session.id)}
          />
        ))}
      </SettingsCard>
    </SettingsSheet>
  );
}

/**
 * One session.
 *
 * The language picker's row, with a second line: two tmux sockets can easily
 * be called things the reader has to squint at, and the backend is the one fact
 * that always tells them apart. The tick is always laid out and cross-fades on
 * `micro`, so moving the choice does not reflow the list.
 */
function SessionRow({
  session,
  selected,
  accessibilityLabel,
  onSelect,
}: {
  session: SessionChoice;
  selected: boolean;
  accessibilityLabel: string;
  onSelect: () => void;
}) {
  const theme = useThemeTokens();
  useRenderTally('SessionRow');
  const on = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, timing('micro'));
  }, [on, selected]);

  const markStyle = useAnimatedStyle(() => ({ opacity: on.value }));

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      testID={`session-option-${session.id}`}
      onPress={onSelect}
      style={styles.row}>
      <View style={styles.rowCopy}>
        <Text variant="bodySmall" numberOfLines={1} style={styles.rowLabel}>
          {session.label}
        </Text>
        <Text variant="caption" numberOfLines={1} color={theme.colors.textMuted}>
          {session.kind}
        </Text>
      </View>
      <Animated.View
        pointerEvents="none"
        testID={selected ? `session-option-${session.id}-selected` : undefined}
        style={markStyle}>
        <Check size={18} color={theme.colors.primary} strokeWidth={2.5} />
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Taller than the language picker's 48pt: these rows carry a second line, and
  // there are never more than a handful of them to fit.
  row: {
    minHeight: 56,
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.gap,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: LADDER.tight / 2 },
  rowLabel: { lineHeight: 20, includeFontPadding: false },
});
