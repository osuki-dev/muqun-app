import { SplashOverlay } from '@osuki-dev/react-native-splash';
import { useState } from 'react';

import { LaunchBrand, LAUNCH_BRAND_HOLD_MS } from '@/components/launch-brand';
import { LaunchIntro } from '@/components/launch-intro';
import { hasSeenLaunchIntro } from '@/lib/launch-intro-seen';
import { DURATION } from '@/lib/motion';

/**
 * What covers the app while it starts, and what takes that cover away.
 *
 * `@osuki-dev/react-native-splash` keeps the native launch screen up until
 * this overlay has painted a pixel-identical copy of it, then removes the
 * native view in the same frame; from there the overlay is ours. Which of
 * two things it shows is decided once, synchronously, on the first render:
 *
 *  - **The intro**, on the first launch of an install. Three pages and a
 *    button; `ready` is that button, so the overlay stays for as long as the
 *    reader reads, and the safety cap is off (`timeout={0}`) because a cap
 *    would cut someone off mid-sentence.
 *  - **The brand launch**, every launch after. Nothing to wait for, so
 *    `ready` is true from the start and the overlay is on screen for exactly
 *    the handover plus a short hold: long enough for the mark to land, no
 *    longer.
 *
 * Read from MMKV at render time rather than in an effect on purpose: the
 * decision has to exist on the frame the native splash hands over to, and
 * an effect is a frame late. The same reason the theme library hydrates at
 * module scope in `_layout.tsx`.
 */
export function LaunchOverlay() {
  const [seen] = useState(() => hasSeenLaunchIntro());
  const [introDone, setIntroDone] = useState(false);

  return (
    <SplashOverlay
      ready={seen || introDone}
      minimumDuration={seen ? DURATION.micro + DURATION.long + LAUNCH_BRAND_HOLD_MS : 0}
      timeout={seen ? undefined : 0}>
      {(context) =>
        seen ? (
          <LaunchBrand {...context} />
        ) : (
          <LaunchIntro {...context} onDone={() => setIntroDone(true)} />
        )
      }
    </SplashOverlay>
  );
}
