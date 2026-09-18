import { useLingui } from '@lingui/react/macro';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Skeleton } from '@/components/themed-skeleton';
import { fadeIn, fadeOut } from '@/lib/motion';

/**
 * The shape of a turn, while the first snapshot is being fetched.
 *
 * Every other surface in this app answers a wait with the shape of what is
 * coming: the home screen draws two server cards, the terminal transcript
 * draws a prompt bubble and two paragraphs, the session map draws its groups.
 * The agent screen answered it with a pulsing dot and the words "Connecting to
 * agent engine…", centred in an otherwise empty screen, appearing and
 * disappearing without a transition at either end -- a spinner, in a codebase
 * whose home screen carries an argument against exactly that: *"not a logo in
 * the middle of an empty screen"*, because a blank hold followed by a hard cut
 * to a populated list is a flicker on every open.
 *
 * So this is the transcript's own shape: a prompt on the right where the
 * reader's message sits, an answer under it, a tool card, and more answer.
 * It is drawn with the themed `Skeleton`, which is the one that puts the
 * theme pack's `backgroundOpacity` through its fill -- a reader who chose to
 * see their artwork through the app gets it here too, rather than a wall of
 * solid bars over it.
 *
 * The motion is the app's, from `lib/motion`: in on `micro` because a
 * placeholder should not announce itself, out on `short` so the real transcript
 * rises through it rather than replacing it between two frames. Both presets
 * carry `ReduceMotion.System`, so a reader who has asked for less motion gets
 * the shape without the fade and nothing here has to ask.
 */
export function AgentTranscriptSkeleton({ paddingTop }: { paddingTop: number }) {
  const { t } = useLingui();
  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('short')}
      style={[styles.root, { paddingTop }]}
      accessibilityLabel={t`Loading the transcript`}>
      <View style={styles.turn}>
        <Skeleton variant="rect" width="58%" height={38} style={styles.prompt} />
        <Skeleton variant="text" lines={3} height={13} />
        <Skeleton variant="rect" width="72%" height={44} style={styles.tool} />
        <Skeleton variant="text" lines={2} height={13} />
      </View>
      <View style={styles.turn}>
        <Skeleton variant="rect" width="42%" height={38} style={styles.prompt} />
        <Skeleton variant="text" lines={4} height={13} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // The same gutter the transcript's own content container uses, so the
    // placeholder rows and the real rows occupy the same column.
    paddingHorizontal: 14,
    gap: 28,
  },
  turn: {
    gap: 18,
  },
  /** Right-aligned and pill-shaped, because that is where a prompt sits. */
  prompt: {
    alignSelf: 'flex-end',
  },
  /** Tool cards are full plates on the left, under the answer that ran them. */
  tool: {
    alignSelf: 'flex-start',
  },
});
