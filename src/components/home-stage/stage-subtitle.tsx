import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { useLatestReader } from '@/hooks/use-render-refs';
import { agentDisplayName } from '@/lib/home-launch-model';
import { calmFadeIn, calmFadeOut } from '@/lib/motion';
import { stageSubtitleStep, type StageProgress } from '@/lib/stage-overlay';
import { useAgents } from '@/stores/agents';
import { useStageTextHalo } from './stage-text-halo';
import { useStageProgress } from './use-stage-overlay';

/**
 * What a working agent on the selected computer last reported, as one or two
 * faint lines at the art's foot: "claude · running tests…". Nothing while no
 * agent reports anything. A new line replaces the old with a short
 * cross-fade, at most once every two seconds (`stageSubtitleStep`); the text
 * is never animated otherwise, so an idle Stage runs nothing.
 */
export function StageSubtitle({ serverId }: { serverId: string }) {
  const line = useStageProgress(serverId);
  const [shown, setShown] = useState<{ line: StageProgress | null; atMs: number }>({
    line: null,
    atMs: 0,
  });
  const readLine = useLatestReader(line);
  const nextKey = line?.key;
  const nextText = line?.text;
  useEffect(() => {
    const step = stageSubtitleStep({
      shown: shown.line,
      shownAtMs: shown.atMs,
      next:
        nextKey !== undefined && nextText !== undefined ? { key: nextKey, text: nextText } : null,
      nowMs: Date.now(),
    });
    if (step.kind === 'keep') return;
    // Whatever is newest when the wait is over: lines in between are skipped.
    const show = () => setShown({ line: readLine(), atMs: Date.now() });
    if (step.kind === 'show') {
      show();
      return;
    }
    const timer = setTimeout(show, step.waitMs);
    return () => clearTimeout(timer);
  }, [nextKey, nextText, shown, readLine]);
  // Keyed by its words: the old line fades out under the new one fading in.
  return shown.line ? (
    <SubtitleLine
      key={`${shown.line.key}\u0000${shown.line.text}`}
      serverId={serverId}
      line={shown.line}
    />
  ) : null;
}

function SubtitleLine({ serverId, line }: { serverId: string; line: StageProgress }) {
  const theme = useThemeTokens();
  const halo = useStageTextHalo();
  const agents = useAgents((state) => state.index.servers[serverId]?.agents?.agents);
  const who = line.agentLabel ?? agentDisplayName(agents, line.agentId);
  return (
    <Animated.View
      testID="home-stage-subtitle"
      pointerEvents="none"
      entering={calmFadeIn()}
      exiting={calmFadeOut()}
      style={styles.line}>
      <Text
        variant="caption"
        numberOfLines={2}
        ellipsizeMode="tail"
        color={theme.colors.textMuted}
        style={[styles.text, halo]}>
        {`${who} · ${line.text}`}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  text: { textAlign: 'center' },
});
