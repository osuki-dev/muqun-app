import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useRouter, type Href } from 'expo-router';
import { FolderOpen } from 'lucide-react-native';
import { Keyboard, StyleSheet } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { KEY_ROW_HEIGHT } from '@/constants/key-row';

/**
 * The way into the session's files.
 *
 * It sits in the pane's action row, immediately right of Quick actions, and the
 * pairing is the argument for the position: Quick actions is what you send
 * *into* the session, this is what the session sent *out*. Input and output
 * beside each other is a true thing to say about a terminal, and it puts files
 * in the content zone rather than in the chrome.
 *
 * Not in the header, which already carries back, the workspace-switching title
 * and the view-mode toggle -- a fifth 46pt circle leaves the title about 130pt
 * on a small phone, and the title is a control here, not a label.
 *
 * Not a swipe-up drawer either: the pane already owns a two-finger pan for
 * switching panels, and on Android the screen edges are the system back
 * gesture. A hidden gesture in that space is a coin toss.
 */
export function ArtifactsButton({
  sessionId,
  tabId,
  label,
  disabled,
  background,
  compact = false,
}: {
  sessionId: string;
  /** The selected tab, so the sheet asks the gateway for this one only. */
  tabId: string;
  /** The server's name, carried through to the sheet's subtitle. */
  label: string;
  disabled?: boolean;
  /** The row's glass fill, so this matches the buttons beside it. */
  background: string;
  /** Pad docks have less vertical chrome even though they have more width. */
  compact?: boolean;
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

  const router = useRouter();
  const theme = useThemeTokens();

  return (
    <PressableScale
      accessibilityLabel={t`Open files`}
      feedback="selection"
      pressedScale={0.9}
      disabled={disabled}
      onPress={() => {
        // The sheet would otherwise open behind the on-screen keyboard.
        Keyboard.dismiss();
        router.push({
          pathname: '/artifacts',
          params: { sessionId, tabId, label },
        } as unknown as Href);
      }}
      style={[styles.button, compact && styles.compactButton, { backgroundColor: background }]}>
      <FolderOpen size={compact ? 15 : 16} color={theme.colors.primary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    // Matched to `keyRowToggle` in the server screen, so the row reads as one
    // set of controls rather than as a button that wandered in. The height is
    // imported rather than restated: agreeing on 36 by coincidence is what let
    // the row go ragged in the first place.
    width: 40,
    height: KEY_ROW_HEIGHT,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
  },
});
