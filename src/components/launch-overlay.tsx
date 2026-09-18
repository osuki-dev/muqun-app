import { SplashOverlay } from '@osuki-dev/react-native-splash';
import { useState } from 'react';

import { LaunchIntro } from '@/components/launch-intro';
import { LaunchIntroCyberpunk } from '@/components/launch-intro-cyberpunk';
import { hasSeenLaunchIntro } from '@/lib/launch-intro-seen';

/**
 * What covers the app while it starts, and what takes that cover away.
 *
 * `@osuki-dev/react-native-splash` keeps the native launch screen up until
 * this overlay has painted a pixel-identical copy of it, then removes the
 * native view in the same frame; from there the overlay is ours. Which of
 * two things it shows is decided once, synchronously, on the first render:
 *
 *  - **The intro**, on the first launch of an install. Four pages and a
 *    button; `ready` is that button, so the overlay stays for as long as the
 *    reader reads, and the safety cap is off (`timeout={0}`) because a cap
 *    would cut someone off mid-sentence.
 *  - **The boot sequence**, every launch after. Nothing to wait for, so it
 *    runs its own short sequence over the pack's launch artwork and says when
 *    it is done.
 *
 * Both branches now end the same way: the child decides, `ready` is the
 * child's `onDone`, and `minimumDuration` is 0. The boot sequence owns its own
 * clock (`launch-intro-timeline.ts`) rather than having it split between a
 * hold here and an animation there -- which is what lets a tap end it early,
 * something a `minimumDuration` the overlay is counting down cannot do.
 *
 * Read from MMKV at render time rather than in an effect on purpose: the
 * decision has to exist on the frame the native splash hands over to, and
 * an effect is a frame late. The same reason the theme library hydrates at
 * module scope in `_layout.tsx`.
 */
export function LaunchOverlay() {
  const [seen] = useState(() => hasSeenLaunchIntro());
  const [introDone, setIntroDone] = useState(false);
  const [bootDone, setBootDone] = useState(false);

  return (
    <SplashOverlay
      ready={seen ? bootDone : introDone}
      minimumDuration={0}
      timeout={seen ? undefined : 0}>
      {(context) =>
        seen ? (
          <LaunchIntroCyberpunk {...context} onDone={() => setBootDone(true)} />
        ) : (
          <LaunchIntro {...context} onDone={() => setIntroDone(true)} />
        )
      }
    </SplashOverlay>
  );
}
