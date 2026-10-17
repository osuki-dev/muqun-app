import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewInstance } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { CARD_DUST_EFFECT, CardDust, type CardShot } from '@/components/card-dust';
import { useStableHandler } from '@/hooks/use-render-refs';
import { deckCommits, deckReform, deckScrub } from '@/lib/home-computer-deck';
import { timing } from '@/lib/motion';
import { sidewaysPan } from '@/lib/sideways-pan';
import { disposeViewPhotograph, photographView } from '@/lib/view-photograph';

/** The rest of the dissolve after a commit. */
const DUST_COMMIT_MS = 360;
/** The ash flowing back when the pull is let go short. */
const DUST_CANCEL_SPRING = { stiffness: 220, damping: 24, reduceMotion: ReduceMotion.Never };
/** The cross-fade that stands in for the dust. */
const CROSS_FADE_MS = 200;
/** How long a commit let go before its photographs waits for them. */
const EARLY_RELEASE_WAIT_MS = 400;
/** Room the ash may blow into around the page: sideways and upwards. */
const DUST_SIDE = 56;
const DUST_TOP = 72;
const DUST_BOTTOM = 8;

type Scrub = {
  token: number;
  to: number;
  direction: number;
  outgoing: CardShot | null;
  incoming: CardShot | null;
  failed: boolean;
  drawing: boolean;
  auto: boolean;
  crossing: boolean;
};

/**
 * Pages of one surface, turned the way Home's computer sheaf turns its cards
 * (`home-computer-deck.tsx`): a sideways pull scrubs the page into ash from
 * the edge the finger pulls towards while the next page reforms in its place.
 * Past the commit distance or on a flick the rest blows away; short of it the
 * ash flows back. Left is the next page, right the previous; there is no page
 * before the first or after the last.
 *
 * Without a photograph, a compiled shader or with Reduce Motion, the pages
 * cross-fade instead. Every frame of a turn is shared values and one shader.
 */
export function DustPager({
  pageCount,
  page,
  onPageChange,
  renderPage,
  accessibilityLabels,
  uniformHeight = false,
}: {
  pageCount: number;
  page: number;
  onPageChange: (page: number) => void;
  /** One page's surface, at least `minHeight` tall. */
  renderPage: (index: number, minHeight: number) => ReactNode;
  accessibilityLabels: { next: string; previous: string };
  /** Every page as tall as the tallest seen; otherwise each keeps its own height. */
  uniformHeight?: boolean;
}) {
  const reduced = useReducedMotion();
  const [scrub, setScrub] = useState<Scrub | null>(null);
  const [width, setWidth] = useState(0);
  const [tallest, setTallest] = useState(0);

  const progress = useSharedValue(0);
  const settled = useSharedValue(0);
  const busy = useSharedValue(0);
  const ready = useSharedValue(0);
  const skip = useSharedValue(0);
  const direction = useSharedValue(0);
  const target = useSharedValue(-1);
  const incomingReady = useSharedValue(0);
  const playing = useSharedValue(0);
  const cross = useSharedValue(0);
  // The pages a cross-fade takes out and brings in (-1: none).
  const crossOut = useSharedValue(-1);
  const crossIn = useSharedValue(-1);
  const token = useSharedValue(0);
  const origin = useSharedValue({ x: 0, y: 0 });
  const pageWidth = useSharedValue(0);
  const current = useSharedValue(page);
  const count = useSharedValue(pageCount);
  useEffect(() => {
    current.set(page);
    count.set(pageCount);
  }, [count, current, page, pageCount]);

  const outProgress = useDerivedValue(() =>
    settled.get() === 1 ? 1 : Math.max(0, progress.get())
  );
  const inProgress = useDerivedValue(() =>
    settled.get() === 1 ? 0 : deckReform(Math.max(0, progress.get()))
  );

  const moved = useStableHandler((to: number) => {
    busy.set(0);
    playing.set(0);
    ready.set(0);
    onPageChange(to);
    setScrub(null);
    requestAnimationFrame(() => {
      cross.set(0);
      crossOut.set(-1);
      crossIn.set(-1);
    });
  });
  const cancelled = useStableHandler(() => {
    busy.set(0);
    playing.set(0);
    ready.set(0);
    setScrub(null);
  });

  const { playCommit } = useMemo(() => {
    const finish = (finished?: boolean) => {
      'worklet';
      if (!finished) return;
      const to = target.get();
      settled.set(1);
      progress.set(0);
      scheduleOnRN(moved, to);
    };
    return {
      playCommit: () => {
        'worklet';
        if (target.get() < 0 || playing.get() === 1) return;
        playing.set(1);
        const remaining = 1 - Math.min(1, Math.max(0, progress.get()));
        progress.set(
          withTiming(
            1,
            {
              duration: Math.max(160, DUST_COMMIT_MS * remaining),
              easing: Easing.linear,
              reduceMotion: ReduceMotion.Never,
            },
            finish
          )
        );
      },
    };
  }, [moved, playing, progress, settled, target]);

  const crossFade = useStableHandler((commit: boolean) => {
    token.set(token.get() + 1);
    if (!commit || !scrub) {
      setScrub(null);
      progress.set(
        withSpring(0, DUST_CANCEL_SPRING, () => {
          'worklet';
          busy.set(0);
        })
      );
      return;
    }
    if (playing.get() === 1) return;
    playing.set(1);
    const to = scrub.to;
    crossOut.set(page);
    crossIn.set(to);
    setScrub({ ...scrub, crossing: true });
    cross.set(
      withTiming(1, timing(CROSS_FADE_MS, { reduceMotion: ReduceMotion.Never }), (finished) => {
        'worklet';
        if (!finished) return;
        progress.set(0);
        scheduleOnRN(moved, to);
      })
    );
  });

  // A commit whose incoming photograph has not landed: the page still blows
  // away, and the real next page fades in beneath it.
  const commitUnderAsh = useStableHandler(() => {
    if (!scrub || playing.get() === 1) return;
    crossIn.set(scrub.to);
    setScrub({ ...scrub, crossing: true });
    cross.set(withTiming(1, timing(DUST_COMMIT_MS, { reduceMotion: ReduceMotion.Never })));
    playCommit();
  });

  const beginTurn = useStableHandler((to: number, towards: number, auto: boolean) => {
    const nextToken = token.get() + 1;
    token.set(nextToken);
    incomingReady.set(0);
    const dust = CARD_DUST_EFFECT !== null && !reduced;
    setScrub({
      token: nextToken,
      to,
      direction: towards,
      outgoing: null,
      incoming: null,
      failed: !dust,
      drawing: false,
      auto,
      crossing: false,
    });
  });

  const shot = useStableHandler(
    (role: 'outgoing' | 'incoming', forToken: number, image: CardShot | null) => {
      if (token.get() !== forToken || (role === 'incoming' && scrub?.crossing)) {
        if (image) disposeLater(image);
        return;
      }
      if (role === 'incoming' && image) incomingReady.set(1);
      setScrub((value) =>
        value && value.token === forToken
          ? { ...value, [role]: image, failed: value.failed || !image }
          : value
      );
    }
  );

  const drawn = useStableHandler((forToken: number) => {
    if (token.get() !== forToken) return;
    setScrub((value) => (value && value.token === forToken ? { ...value, drawing: true } : value));
    ready.set(1);
  });

  // Let go before the dust could play: a commit waits briefly for it.
  const releasedEarly = useStableHandler((commit: boolean) => {
    if (!commit || !scrub || scrub.failed) {
      crossFade(commit);
      return;
    }
    const waiting = scrub.token;
    setScrub({ ...scrub, auto: true });
    setTimeout(() => {
      if (token.get() !== waiting || playing.get() === 1) return;
      if (ready.get() === 1) commitUnderAsh();
      else crossFade(true);
    }, EARLY_RELEASE_WAIT_MS);
  });

  useEffect(() => {
    if (!scrub?.auto) return;
    if (scrub.failed) {
      crossFade(true);
      return;
    }
    if (scrub.drawing && scrub.incoming) playCommit();
  }, [scrub?.auto, scrub?.failed, scrub?.drawing, scrub?.incoming, crossFade, playCommit]);

  const outgoingShot = scrub?.outgoing ?? null;
  const incomingShot = scrub?.incoming ?? null;
  useEffect(
    () => () => {
      if (outgoingShot) disposeLater(outgoingShot);
    },
    [outgoingShot]
  );
  useEffect(
    () => () => {
      if (incomingShot) disposeLater(incomingShot);
    },
    [incomingShot]
  );
  useEffect(() => {
    if (!scrub) settled.set(0);
  }, [scrub, settled]);

  const startTurn = useStableHandler((to: number, towards: number) => {
    if (busy.get() === 1 || to < 0 || to >= pageCount || to === page) return;
    busy.set(1);
    target.set(to);
    beginTurn(to, towards, true);
  });

  const gesture = useMemo(
    () =>
      // Only a clearly sideways drag turns; anything else is the page's scroll.
      sidewaysPan(origin)
        .onStart(() => {
          'worklet';
          if (busy.get() === 1 || count.get() < 2) {
            skip.set(1);
            return;
          }
          skip.set(0);
          busy.set(1);
          direction.set(0);
        })
        .onUpdate((event) => {
          'worklet';
          if (skip.get() === 1) return;
          if (direction.get() === 0) {
            if (event.translationX === 0) return;
            const towards = event.translationX < 0 ? -1 : 1;
            const to = current.get() - towards;
            // Nothing that way: the pull does nothing.
            if (to < 0 || to >= count.get()) {
              skip.set(1);
              busy.set(0);
              return;
            }
            direction.set(towards);
            target.set(to);
            scheduleOnRN(beginTurn, to, towards, false);
          }
          progress.set(
            reduced ? 0 : deckScrub(event.translationX, pageWidth.get(), direction.get())
          );
        })
        .onEnd((event) => {
          'worklet';
          if (skip.get() === 1) return;
          if (direction.get() === 0) {
            busy.set(0);
            return;
          }
          const commit = deckCommits(
            event.translationX,
            event.velocityX,
            pageWidth.get(),
            direction.get()
          );
          if (ready.get() !== 1) {
            scheduleOnRN(releasedEarly, commit);
            return;
          }
          if (commit && incomingReady.get() !== 1) {
            scheduleOnRN(commitUnderAsh);
            return;
          }
          if (commit) {
            playCommit();
            return;
          }
          progress.set(
            withSpring(0, DUST_CANCEL_SPRING, (finished) => {
              'worklet';
              if (!finished) return;
              scheduleOnRN(cancelled);
            })
          );
        }),
    [
      beginTurn,
      busy,
      origin,
      cancelled,
      commitUnderAsh,
      count,
      current,
      direction,
      incomingReady,
      pageWidth,
      playCommit,
      progress,
      ready,
      reduced,
      releasedEarly,
      skip,
      target,
    ]
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    pageWidth.set(next);
    setWidth(next);
  };
  const onPageHeight = (height: number) => {
    const rounded = Math.ceil(height);
    setTallest((value) => Math.max(value, rounded));
  };

  const canvasHeight = Math.max(scrub?.outgoing?.height ?? 0, scrub?.incoming?.height ?? 0);
  const hideCurrent = Boolean(scrub?.drawing);
  return (
    <View
      accessible={false}
      accessibilityActions={[
        ...(page < pageCount - 1 ? [{ name: 'increment', label: accessibilityLabels.next }] : []),
        ...(page > 0 ? [{ name: 'decrement', label: accessibilityLabels.previous }] : []),
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') startTurn(page + 1, -1);
        else if (event.nativeEvent.actionName === 'decrement') startTurn(page - 1, 1);
      }}
      onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View>
          <PagerPage
            key={`page-${page}`}
            index={page}
            role="current"
            hidden={hideCurrent}
            cross={cross}
            crossOut={crossOut}
            crossIn={crossIn}
            shootToken={scrub && !scrub.failed ? scrub.token : null}
            onHeight={onPageHeight}
            onShot={shot}>
            {renderPage(page, uniformHeight ? tallest : 0)}
          </PagerPage>
          {scrub ? (
            <PagerPage
              key={`page-${scrub.to}`}
              index={scrub.to}
              role="incoming"
              hidden={!scrub.crossing}
              cross={cross}
              crossOut={crossOut}
              crossIn={crossIn}
              shootToken={!scrub.failed ? scrub.token : null}
              onHeight={onPageHeight}
              onShot={shot}>
              {renderPage(scrub.to, uniformHeight ? tallest : 0)}
            </PagerPage>
          ) : null}
        </View>
      </GestureDetector>
      {scrub?.outgoing ? (
        <View pointerEvents="none" style={styles.dust}>
          <CardDust
            direction={scrub.direction}
            height={canvasHeight + DUST_TOP + DUST_BOTTOM}
            incoming={scrub.crossing ? null : scrub.incoming}
            inProgress={inProgress}
            offsetX={DUST_SIDE}
            offsetY={DUST_TOP}
            outgoing={scrub.outgoing}
            outProgress={outProgress}
            token={scrub.token}
            width={width + DUST_SIDE * 2}
            onDrawn={drawn}
          />
        </View>
      ) : null}
    </View>
  );
}

function disposeLater(shot: CardShot) {
  // A frame later: a draw already in flight may still be sampling it.
  requestAnimationFrame(() => requestAnimationFrame(() => disposeViewPhotograph(shot.image)));
}

/**
 * One page: the current one in the flow, or the incoming one laid over it,
 * unseen until the dust or a cross-fade shows it. A real native view, so it
 * can be photographed whether or not it is shown.
 */
function PagerPage({
  index,
  role,
  hidden,
  cross,
  crossOut,
  crossIn,
  shootToken,
  onHeight,
  onShot,
  children,
}: {
  index: number;
  role: 'current' | 'incoming';
  hidden: boolean;
  cross: SharedValue<number>;
  crossOut: SharedValue<number>;
  crossIn: SharedValue<number>;
  shootToken: number | null;
  onHeight: (height: number) => void;
  onShot: (role: 'outgoing' | 'incoming', token: number, shot: CardShot | null) => void;
  children: ReactNode;
}) {
  const ref = useRef<ViewInstance>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    onHeight(height);
  };
  useEffect(() => {
    if (shootToken === null || !size) return;
    let live = true;
    const frame = requestAnimationFrame(() => {
      photographView(ref, size.width, size.height)
        .then((image) => (image ? { image, width: size.width, height: size.height } : null))
        .catch(() => null)
        .then((shot) => {
          if (live) onShot(role === 'current' ? 'outgoing' : 'incoming', shootToken, shot);
          else if (shot) disposeLater(shot);
        });
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- one photograph per turn, once the page has a size.
  }, [shootToken, size?.height]);
  // From shared values and the page's own index only, never from `role`: the
  // incoming page becomes the current one without waiting for a new worklet.
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: crossOut.get() === index ? 1 - cross.get() : crossIn.get() === index ? cross.get() : 1,
  }));
  return (
    <Animated.View
      pointerEvents={role === 'current' && !hidden ? 'box-none' : 'none'}
      style={[role === 'incoming' ? styles.incoming : null, fadeStyle]}>
      <View
        ref={ref}
        collapsable={false}
        onLayout={onLayout}
        pointerEvents="box-none"
        accessibilityElementsHidden={role !== 'current'}
        importantForAccessibility={role === 'current' ? 'auto' : 'no-hide-descendants'}
        style={hidden ? styles.unseen : null}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  incoming: { position: 'absolute', left: 0, right: 0, top: 0 },
  unseen: { opacity: 0 },
  dust: { position: 'absolute', left: -DUST_SIDE, top: -DUST_TOP },
});
