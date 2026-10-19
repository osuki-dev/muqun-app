import { SplashOverlay } from '@osuki-dev/react-native-splash';
import { useState } from 'react';

import { LaunchIntro } from '@/components/launch-intro';
import { hasSeenLaunchIntro } from '@/lib/launch-intro-seen';
import { useLaunchHandoff } from '@/stores/launch-handoff';

/**
 * What covers the app while it starts, and what takes that cover away.
 *
 * `@osuki-dev/react-native-splash` keeps the native launch screen up until
 * this overlay has painted a pixel-identical copy of it, then removes the
 * native view in the same frame; from there the overlay is ours. Which of
 * two things it shows is decided once, synchronously, on the first render:
 *
 *  - **The intro**, once per release-intro edition. Three new highlights;
 *    `ready` is the final button (or Skip), so the overlay stays for as long as the
 *    reader reads, and the safety cap is off (`timeout={0}`) because a cap
 *    would cut someone off mid-sentence.
 *  - **Every launch after**, the splash's own mirror, faded out as soon as
 *    the native screen has handed over. The themed opening scene (world,
 *    hero landing, dust trail, snap exit) is not played: it held a
 *    full-screen touch-capturing layer over Home at every start.
 *
 * Read from MMKV at render time rather than in an effect on purpose: the
 * decision has to exist on the frame the native splash hands over to, and
 * an effect is a frame late. The same reason the theme library hydrates at
 * module scope in `_layout.tsx`.
 */
export function LaunchOverlay() {
  const [seen] = useState(() => hasSeenLaunchIntro());
  const [introDone, setIntroDone] = useState(false);
  const beginHomeReveal = useLaunchHandoff((state) => state.beginReveal);
  const settleLaunch = useLaunchHandoff((state) => state.settle);

  return (
    <SplashOverlay
      ready={seen || introDone}
      minimumDuration={0}
      timeout={seen ? undefined : 0}
      onPhaseChange={(phase) => {
        if (phase === 'exiting') beginHomeReveal();
      }}
      onHidden={settleLaunch}>
      {seen
        ? undefined
        : (context) => <LaunchIntro {...context} onDone={() => setIntroDone(true)} />}
    </SplashOverlay>
  );
}
