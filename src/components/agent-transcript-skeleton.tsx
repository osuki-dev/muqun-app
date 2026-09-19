import { StyleSheet } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import Animated from 'react-native-reanimated';

import { LogoLoader } from '@/components/logo-loader';
import { fadeIn, fadeOut } from '@/lib/motion';

/**
 * What the agent screen shows while its first snapshot is on the way.
 *
 * The theme pack's launch mark, breathing -- the same wait every other
 * surface answers with (the task sheet, the SSH list, the lock gate), so an
 * artwork theme keeps its own illustration on this screen too. It used to be
 * a grey skeleton of a transcript, which was the one wait in the app drawn in
 * a material the theme does not own.
 *
 * Fades in on the shortest preset and out on the short one; the transcript
 * rises through it. Choosing another session or workspace re-enters the
 * snapshot load, so the same fade is also the switch.
 */
export function AgentTranscriptSkeleton({ paddingTop }: { paddingTop: number }) {
  const { t } = useLingui();
  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('short')}
      style={[styles.root, { paddingTop }]}
      pointerEvents="none"
      testID="agent-transcript-loading">
      <LogoLoader size={56} accessibilityLabel={t`Connecting`} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
