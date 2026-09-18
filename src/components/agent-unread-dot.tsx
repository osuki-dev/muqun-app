import { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import Animated from 'react-native-reanimated';

import { fadeIn, fadeOut } from '@/lib/motion';

/**
 * "This one finished while you were somewhere else."
 *
 * One dot, in the same ink the app uses for "current", wherever a session is
 * listed: the sessions sheet's rows and the composer's own strip. It is drawn
 * from `isSessionUnread` and from nothing else -- `time_idle > time_viewed`, both
 * of them the gateway's own numbers -- so a session is never marked unread
 * because this app guessed that something had happened to it, and never marked
 * read because this app decided the reader had probably seen it.
 *
 * Which is also why it fades rather than disappearing: opening a session posts
 * `…/view`, the engine answers with `agent.session.updated` carrying the new
 * `time_viewed`, and the dot goes on that. The round trip is a few hundred
 * milliseconds, and a mark that vanished between two frames at the end of it
 * would read as a glitch rather than as an acknowledgement.
 */
export const AgentUnreadDot = memo(function AgentUnreadDot({
  tone,
  size = 6,
  testID,
}: {
  /** The dot's ink. Defaults to `primary`; a lit chip passes its own. */
  tone?: string;
  size?: number;
  testID?: string;
}) {
  const theme = useThemeTokens();
  return (
    <Animated.View
      testID={testID}
      entering={fadeIn('micro')}
      exiting={fadeOut('short')}
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone ?? theme.colors.primary,
        },
      ]}
    />
  );
});

const styles = StyleSheet.create({
  dot: { flexShrink: 0 },
});
