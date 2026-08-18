// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { History, X } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { appChrome } from '@/constants/appearance';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { agentStatusWord } from '@/i18n/labels';
import { awayDurationParts, type AwayDigest, type AwayDigestRow } from '@/lib/away-digest';
import { feedback } from '@/lib/feedback';
import { agentStatusTone } from '@/lib/herdr-entity';
import { fadeInDown, fadeOutUp, listLayout } from '@/lib/motion';

/**
 * "While you were away": what the server screen says to someone reopening a
 * machine they last looked at half an hour ago.
 *
 * Purely presentational. It holds no state, makes no request, and does not know
 * what fifteen minutes is -- `away-digest.ts` decides whether there is a digest
 * and what is in it, `useAwayDigest` does the I/O, and this says it out loud.
 *
 * ## Why it is this quiet
 *
 * A card that floats over a terminal is a card in someone's way, so this one is
 * built to be finished with. One line per agent, four lines at most, the
 * outcome rather than the history, and the whole surface is the dismiss target
 * -- there is no button to find, because reading it *is* the interaction. It
 * never appears with nothing to say and it never appears twice for the same
 * absence, both of which are guaranteed upstream.
 *
 * `box-none` on the stack above means the terminal keeps taking taps everywhere
 * this card is not, so it delays nobody who has already seen it. It is
 * deliberately not a modal, not a sheet, and not focus-trapping: nothing here is
 * a question.
 *
 * ## Why the status word travels with the dot
 *
 * The same rule the home screen's agent rows follow: a status that is only
 * legible as a colour is not legible. The dot is the glance, the word is the
 * fact, and a screen reader gets the sentence either way.
 */
export function AwayDigestCard({
  digest,
  onDismiss,
}: {
  digest: AwayDigest;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const away = awayDurationParts(digest);
  const dismiss = () => {
    void feedback('selection');
    onDismiss();
  };

  return (
    <Animated.View
      // The card arrives from above like every other notice in this column and
      // leaves upward rather than fading in place: it came from the top of the
      // screen and it goes back there. `listLayout` on top so the notices under
      // it close the gap instead of jumping when this one leaves.
      entering={fadeInDown('medium')}
      exiting={fadeOutUp('short')}
      layout={listLayout('short')}
      style={styles.wrapper}>
      {/* `accessible={false}` on the tap target, and that is not an oversight.
          A `Pressable` that carries a label collapses everything under it into
          one accessibility element, so a screen reader would get "dismiss what
          happened while you were away" and *none of what happened* -- the whole
          content of the card, unreadable, behind a button that throws it away.
          The rows stay individually accessible instead, and the dismissal is
          published by the close control below, which is a real button. */}
      <Pressable
        accessible={false}
        onPress={dismiss}
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface },
        ]}
        testID="away-digest">
        <View style={styles.header}>
          <History size={14} color={theme.colors.textMuted} strokeWidth={2.2} />
          <Text variant="label" colorKey="text" style={styles.title} numberOfLines={1}>
            <Trans>While you were away</Trans>
          </Text>
          <Text variant="caption" colorKey="textSubtle" numberOfLines={1}>
            {away.unit === 'minute' ? (
              <Plural value={away.value} one="# minute" other="# minutes" />
            ) : away.unit === 'hour' ? (
              <Plural value={away.value} one="# hour" other="# hours" />
            ) : (
              <Plural value={away.value} one="# day" other="# days" />
            )}
          </Text>
          {/* `PressableScale`, like every other dismissal in the app: a raw
              Pressable answers a tap with nothing at all. Tapping the card
              anywhere does the same thing -- this is the affordance that says
              so, and the one control a screen reader is offered. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Dismiss what happened while you were away`}
            hitSlop={10}
            pressedScale={0.9}
            onPress={dismiss}
            testID="away-digest-dismiss">
            <X size={13} color={theme.colors.textSubtle} strokeWidth={2.2} />
          </PressableScale>
        </View>

        <View style={styles.rows}>
          {digest.rows.map((row) => (
            <AwayDigestRowView key={row.key} row={row} />
          ))}
        </View>

        {digest.otherAgents > 0 ? (
          <Text variant="caption" colorKey="textSubtle" style={styles.more} numberOfLines={1}>
            <Plural value={digest.otherAgents} one="and # more agent" other="and # more agents" />
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/**
 * One agent's line: where it ended up, how much it had to stop for, and when it
 * last moved.
 *
 * The blocked count is the only part of the history that survives the summary,
 * and it is dropped again where the agent is *still* blocked -- "Blocked ·
 * stopped to ask twice" says the same thing twice and buries the half that
 * needs answering.
 */
function AwayDigestRowView({ row }: { row: AwayDigestRow }) {
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const relativeTime = useRelativeTime();
  const tone = agentStatusTone(row.status);
  const asked = row.status !== 'blocked' ? row.blocked : 0;

  return (
    <View style={styles.row}>
      <StatusDot color={theme.colors[tone]} filled size={7} />
      <Text variant="bodySmall" colorKey="text" style={styles.name} numberOfLines={1}>
        {row.agent || row.paneId}
      </Text>
      <Text variant="caption" color={theme.colors[tone]} numberOfLines={1}>
        {_(agentStatusWord[row.status] ?? agentStatusWord.unknown)}
      </Text>
      {asked > 0 ? (
        <Text variant="caption" colorKey="textSubtle" style={styles.asked} numberOfLines={1}>
          <Plural value={asked} one="· asked once" other="· asked # times" />
        </Text>
      ) : null}
      <Text variant="caption" colorKey="textSubtle" numberOfLines={1}>
        {relativeTime(row.atMs)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches the error bar that shares this column, so two notices standing
  // together line up rather than stepping in and out by a few points.
  wrapper: {
    marginHorizontal: 12,
  },
  card: {
    borderRadius: appChrome.radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    boxShadow: appChrome.shadow.ambientCard,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Takes the width so the duration and the close glyph sit at the end of the
  // header whatever the title's translation costs.
  title: {
    flex: 1,
    minWidth: 0,
  },
  rows: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // The name takes the slack, so the status word, the count and the time stay
  // pinned to the right edge and read as a column down the card.
  name: {
    flex: 1,
    minWidth: 0,
  },
  // Never squeezes the name out: this clause is the first thing worth losing on
  // a narrow phone.
  asked: {
    flexShrink: 1,
  },
  more: {
    paddingLeft: 15,
  },
});
