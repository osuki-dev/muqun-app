import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  type ScrollViewInstance,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type ViewInstance,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
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

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { CARD_DUST_EFFECT, CardDust, type CardShot } from '@/components/card-dust';
import { useConnectionStatuses } from '@/hooks/use-home-reachability';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { connectionStatusLabel } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { ComputerCard } from '@/lib/home-computer-cards';
import {
  DECK_AT_REST,
  deckCommits,
  deckMoved,
  deckMovedKey,
  deckOrder,
  deckReform,
  deckScrub,
  deckSwipeMove,
  type DeckMove,
} from '@/lib/home-computer-deck';
import { riseIn, timing } from '@/lib/motion';
import { type ActiveServerConnection } from '@/lib/server-reachability';
import { disposeViewPhotograph, photographView } from '@/lib/view-photograph';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeTaskCards } from '@/stores/home-task-cards';

/** The rest of the dissolve after a commit, and a whole one for a peek tap. */
const DUST_COMMIT_MS = 280;
/** The ash flowing back into the card when the pull is let go short. */
const DUST_CANCEL_SPRING = { stiffness: 220, damping: 24, reduceMotion: ReduceMotion.Never };
/** How long a commit let go before its photographs waits for them. */
const EARLY_RELEASE_WAIT_MS = 400;
/** The cross-fade that stands in for the dust. */
const CROSS_FADE_MS = 200;
/** Room the ash may blow into around the card: sideways and upwards. */
const DUST_SIDE = 56;
const DUST_TOP = 72;
const DUST_BOTTOM = 8;

/**
 * One move between computers while it plays: which card leaves, which one
 * comes, the two photographs the dust is drawn from, and whether the dust is
 * already standing in for the real cards.
 */
type Scrub = {
  token: number;
  move: DeckMove;
  /** The order when it began; the deck holds it until the move ends. */
  order: string[];
  incomingId: string;
  direction: number;
  outgoing: CardShot | null;
  incoming: CardShot | null;
  /** A photograph could not be taken: this move cross-fades. */
  failed: boolean;
  /** The canvas has drawn: the real front card is hidden under it. */
  drawing: boolean;
  /** Started by a tap or an accessibility action: it plays once both are in. */
  auto: boolean;
  /** Cross-fading instead of the dust. */
  crossing?: boolean;
};

/** Every card in the sheaf is as tall as the tallest; each reports its own content height. */
export type DeckCardLayout = {
  minHeight: number;
  onContentHeight: (height: number) => void;
};

export type DeckCardActions = {
  accessibilityActions: { name: string; label: string }[];
  onAccessibilityAction: (event: AccessibilityActionEvent) => void;
};

/** A horizontal computer selector above one card, retaining the dust transition. */
export function HomeComputerDeck({
  cards,
  servers,
  activeConnection,
  onSelectServer,
  renderCard,
  signatures,
}: {
  /** Two or more, in the cards' own order. */
  cards: readonly ComputerCard[];
  servers: readonly GatewayRecord[];
  activeConnection?: ActiveServerConnection;
  onSelectServer: (serverId: string) => void;
  /** What each card shows, as a string that changes when its height may. */
  signatures: Readonly<Record<string, string>>;
  renderCard: (card: ComputerCard, actions?: DeckCardActions, layout?: DeckCardLayout) => ReactNode;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  // Diagnosis: the ash dissolve is switched off so switching can be compared
  // without it; every move takes the plain cross-fade path Reduce Motion uses.
  const reduced = useReducedMotion() || DECK_DUST_OFF;
  const isFocused = useIsFocused();
  const remembered = useHomeTaskCards((state) => state.deckFront);
  const setDeckFront = useHomeTaskCards((state) => state.setDeckFront);
  const [held, setHeld] = useState<string[] | null>(null);
  const [scrub, setScrub] = useState<Scrub | null>(null);
  const [width, setWidth] = useState(0);
  // Each card's own height, as it last laid out, and what it showed then. The
  // deck is as tall as the tallest, so moving between computers never makes
  // the page jump; a card behind the front is laid out again, unseen, when
  // what it shows changes.
  const [heights, setHeights] = useState<
    Readonly<Record<string, { height: number; signature: string }>>
  >({});
  const ids = cards.map((card) => card.serverId);
  const order = scrub ? scrub.order : deckOrder(held, ids, remembered);
  const orderKey = order.join('\n');
  const count = order.length;
  const frontId = order[0];

  // The geometry's truth, on the UI thread: a move ends by changing the order
  // and its progress there in one step, so no frame mixes the two.
  const ring = useSharedValue(orderKey);
  const move = useSharedValue<DeckMove>(DECK_AT_REST);
  const progress = useSharedValue(0);
  // After a commit, until React has caught up: the dust stays at its end.
  const settled = useSharedValue(0);
  const busy = useSharedValue(0);
  const ready = useSharedValue(0);
  // The incoming card's photograph has landed: a commit can reform it.
  const incomingReady = useSharedValue(0);
  const skip = useSharedValue(0);
  const direction = useSharedValue(-1);
  // The cross-fade: how far it is, and the card fading out.
  const cross = useSharedValue(0);
  const crossFrom = useSharedValue('');
  // The card a cross-fade brings in.
  const crossIn = useSharedValue('');
  const deckWidth = useSharedValue(0);
  const frontHeight = useSharedValue(0);
  const token = useSharedValue(0);
  // A commit or a cross-fade is under way: a second request for one is ignored.
  const playing = useSharedValue(0);

  useLayoutEffect(() => {
    if (busy.get() === 0) ring.set(orderKey);
  }, [busy, orderKey, ring]);

  const outProgress = useDerivedValue(() =>
    settled.get() === 1 ? 1 : Math.max(0, progress.get())
  );
  const inProgress = useDerivedValue(() =>
    settled.get() === 1 ? 0 : deckReform(Math.max(0, progress.get()))
  );

  const cardOf = (serverId: string) => cards.find((card) => card.serverId === serverId);
  const cardHeight = Math.max(96, heights[frontId ?? '']?.height ?? 0);
  const reportHeight = (serverId: string, height: number) => {
    const rounded = Math.ceil(height);
    const signature = signatures[serverId] ?? '';
    setHeights((current) =>
      current[serverId]?.height === rounded && current[serverId]?.signature === signature
        ? current
        : { ...current, [serverId]: { height: rounded, signature } }
    );
  };
  const layoutOf = (serverId: string): DeckCardLayout => ({
    minHeight: cardHeight,
    onContentHeight: (height) => reportHeight(serverId, height),
  });
  const frontMeasured = frontId !== undefined && heights[frontId] !== undefined;
  useEffect(() => {
    // The first height is set, not animated: the deck arrives at its size.
    // A new signature at the same height does not restart this animation.
    if (!frontMeasured) return;
    frontHeight.set(frontHeight.get() === 0 ? cardHeight : withTiming(cardHeight, timing('short')));
  }, [cardHeight, frontHeight, frontMeasured]);

  // A move has ended on the UI thread: React takes the new order, and the
  // canvas goes in the same commit the new front card is shown in.
  const moved = useStableHandler((next: string) => {
    busy.set(0);
    playing.set(0);
    ready.set(0);
    setHeld(next.split('\n'));
    setScrub(null);
    // After the commit that shows the new front: it may have faded in.
    requestAnimationFrame(() => {
      cross.set(0);
      crossIn.set('');
    });
  });
  const cancelled = useStableHandler(() => {
    token.set(token.get() + 1);
    cancelAnimation(progress);
    cancelAnimation(cross);
    progress.set(0);
    cross.set(0);
    crossFrom.set('');
    crossIn.set('');
    move.set(DECK_AT_REST);
    settled.set(0);
    incomingReady.set(0);
    skip.set(0);
    busy.set(0);
    playing.set(0);
    ready.set(0);
    setScrub(null);
  });
  // A retained Home can lose focus or enter a hidden Activity mid-transition.
  // Restore live card hit targets even when native animation completion never runs.
  useEffect(() => {
    if (!isFocused) cancelled();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') cancelled();
    });
    return () => {
      subscription.remove();
      cancelled();
    };
  }, [cancelled, isFocused]);

  const committed = useStableHandler((front: string) => {
    setDeckFront(front);
    onSelectServer(front);
  });

  // The stand-in for the dust: the front card cross-fades into the incoming
  // one, which is already mounted under it, and the order changes once it has
  // (Reduce Motion, a photograph that failed, a release before the
  // photographs were in, or no shader on this device). Under Reduce Motion
  // the sheets take their new levels without travelling.
  const faded = useStableHandler((next: string) => {
    playing.set(0);
    setHeld(next.split('\n'));
    setScrub(null);
    requestAnimationFrame(() => {
      cross.set(0);
      crossFrom.set('');
      crossIn.set('');
      busy.set(0);
      ready.set(0);
    });
  });
  const crossFade = useStableHandler((commit: boolean) => {
    token.set(token.get() + 1);
    if (!commit || !scrub) {
      setScrub(null);
      progress.set(
        withSpring(0, DUST_CANCEL_SPRING, () => {
          'worklet';
          move.set(DECK_AT_REST);
          busy.set(0);
        })
      );
      return;
    }
    if (playing.get() === 1) return;
    playing.set(1);
    const next = deckMoved(scrub.order, scrub.move);
    committed(next[0]!);
    const key = next.join('\n');
    crossFrom.set(scrub.order[0]!);
    crossIn.set(scrub.incomingId);
    setScrub({ ...scrub, crossing: true });
    progress.set(withTiming(1, timing(CROSS_FADE_MS)));
    cross.set(
      withTiming(1, timing(CROSS_FADE_MS, { reduceMotion: ReduceMotion.Never }), (finished) => {
        'worklet';
        if (!finished) return;
        ring.set(key);
        move.set(DECK_AT_REST);
        progress.set(0);
        scheduleOnRN(faded, key);
      })
    );
  });

  /** Start a move: freeze the order, mount the incoming card, ask for photographs. */
  const beginMove = useStableHandler((next: DeckMove, towards: number, auto: boolean) => {
    const id = deckMoved(order, next)[0];
    if (!id || id === frontId) {
      busy.set(0);
      return;
    }
    const nextToken = token.get() + 1;
    token.set(nextToken);
    incomingReady.set(0);
    const dust = CARD_DUST_EFFECT !== null && !reduced;
    setScrub({
      token: nextToken,
      move: next,
      order,
      incomingId: id,
      direction: towards,
      outgoing: null,
      incoming: null,
      failed: !dust,
      drawing: false,
      auto,
    });
  });

  const shot = useStableHandler((serverId: string, forToken: number, image: CardShot | null) => {
    if (token.get() !== forToken) {
      if (image) disposeLater(image);
      return;
    }
    const incoming = serverId === scrub?.incomingId;
    // Too late: the real card is already fading in under the ash.
    if (incoming && scrub?.crossing) {
      if (image) disposeLater(image);
      return;
    }
    if (incoming && image) incomingReady.set(1);
    setScrub((current) => {
      if (!current || current.token !== forToken) return current;
      const role = serverId === current.incomingId ? 'incoming' : 'outgoing';
      return { ...current, [role]: image, failed: current.failed || !image };
    });
  });

  // The canvas has its first frame: hide the real card under it.
  const drawn = useStableHandler((forToken: number) => {
    if (token.get() !== forToken) return;
    setScrub((current) =>
      current && current.token === forToken ? { ...current, drawing: true } : current
    );
    ready.set(1);
  });

  // The photographs go a frame after the canvas that drew them.
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

  const startMove = useStableHandler((next: DeckMove, towards: number) => {
    if (busy.get() === 1 || count < 2) return;
    busy.set(1);
    direction.set(towards);
    move.set(next);
    beginMove(next, towards, true);
  });
  const selectComputer = useStableHandler((id: string) => {
    const position = order.indexOf(id);
    if (position > 0) startMove(position, -1);
  });

  // The commit's worklets, built once over stable shared values and handlers.
  const { playCommit } = useMemo(() => {
    const finishMove = (finished?: boolean) => {
      'worklet';
      const current = move.get();
      if (!finished || current === DECK_AT_REST) return;
      const next = deckMovedKey(ring.get(), current);
      ring.set(next);
      move.set(DECK_AT_REST);
      settled.set(1);
      progress.set(0);
      scheduleOnRN(moved, next);
    };
    return {
      playCommit: () => {
        'worklet';
        const current = move.get();
        if (current === DECK_AT_REST || playing.get() === 1) return;
        playing.set(1);
        scheduleOnRN(committed, deckMovedKey(ring.get(), current).split('\n')[0]!);
        const remaining = 1 - Math.min(1, Math.max(0, progress.get()));
        progress.set(
          withTiming(
            1,
            {
              duration: Math.max(160, DUST_COMMIT_MS * remaining),
              easing: Easing.linear,
              reduceMotion: ReduceMotion.Never,
            },
            finishMove
          )
        );
      },
    };
  }, [committed, move, moved, playing, progress, ring, settled]);

  // A commit whose incoming photograph has not landed: the outgoing card
  // still blows away, and the real incoming card fades in beneath it.
  const commitUnderAsh = useStableHandler(() => {
    if (!scrub || playing.get() === 1) return;
    crossIn.set(scrub.incomingId);
    setScrub({ ...scrub, crossing: true });
    cross.set(withTiming(1, timing(DUST_COMMIT_MS, { reduceMotion: ReduceMotion.Never })));
    playCommit();
  });

  // Let go before the dust could play. A cancel has nothing to undo; a commit
  // plays the dust once the photographs land, or cross-fades if they do not
  // land soon.
  const releasedEarly = useStableHandler((commit: boolean) => {
    if (!commit || !scrub || scrub.failed) {
      crossFade(commit);
      return;
    }
    setScrub({ ...scrub, auto: true });
  });

  // Both taps and released swipes must finish if a GPU capture never lands.
  // Otherwise `drawing` can leave the real card hidden and untappable forever.
  const waitingToken = scrub?.auto ? scrub.token : null;
  useEffect(() => {
    if (waitingToken === null) return;
    const timer = setTimeout(() => {
      if (token.get() !== waitingToken || playing.get() === 1) return;
      if (ready.get() === 1) commitUnderAsh();
      else crossFade(true);
    }, EARLY_RELEASE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waitingToken, token, playing, ready, commitUnderAsh, crossFade]);

  const gesture = useComputerGesture({
    beginMove,
    busy,
    cancelled,
    commitUnderAsh,
    releasedEarly,
    deckWidth,
    direction,
    incomingReady,
    move,
    playCommit,
    progress,
    ready,
    reduced,
    ring,
    skip,
  });

  // A tap or an accessibility action plays once both photographs are in.
  useEffect(() => {
    if (!scrub?.auto) return;
    if (scrub.failed) {
      crossFade(true);
      return;
    }
    if (scrub.drawing && scrub.incoming) playCommit();
  }, [scrub?.auto, scrub?.failed, scrub?.drawing, scrub?.incoming, crossFade, playCommit]);

  const actions: DeckCardActions = {
    accessibilityActions: [
      { name: 'increment', label: t`Next computer` },
      { name: 'decrement', label: t`Previous computer` },
    ],
    onAccessibilityAction: (event) => {
      if (event.nativeEvent.actionName === 'increment') startMove(deckSwipeMove(-1, count), -1);
      else if (event.nativeEvent.actionName === 'decrement') startMove(deckSwipeMove(1, count), 1);
    },
  };

  const onDeckLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    deckWidth.set(next);
    setWidth(next);
  };

  const deckStyle = useAnimatedStyle(() => ({
    height: frontHeight.get(),
  }));
  // The ash may blow above and beside the card, never below the deck.
  const dustStyle = useAnimatedStyle(() => ({
    height: DUST_TOP + frontHeight.get() + DUST_BOTTOM,
  }));
  const slotStyle = useAnimatedStyle(() => ({
    top: 0,
    height: frontHeight.get(),
  }));
  // The front card's own shadow, which its photograph does not carry: it
  // thins while neither card is whole and is back when the new one is.
  const plateStyle = useAnimatedStyle(() => ({
    opacity: Math.max(
      0,
      Math.min(1, Math.max(1 - outProgress.get() * 2, 1 - inProgress.get() * 2))
    ),
  }));

  const incomingKey = scrub?.incomingId ?? '';
  const unmeasured = cards.filter(
    (card) =>
      card.serverId !== frontId &&
      card.serverId !== incomingKey &&
      heights[card.serverId]?.signature !== (signatures[card.serverId] ?? '')
  );
  const incomingCard = scrub ? cardOf(scrub.incomingId) : undefined;
  const frontCard = frontId ? cardOf(frontId) : undefined;
  const hideFront = Boolean(scrub?.drawing);
  const canvasHeight = Math.max(scrub?.outgoing?.height ?? 0, scrub?.incoming?.height ?? 0);

  return (
    <View style={styles.computers}>
      <ComputerTabs
        servers={servers.filter((server) => ids.includes(server.serverId))}
        selectedId={frontId}
        activeConnection={activeConnection}
        onSelect={selectComputer}
        ring={ring}
        move={move}
        progress={progress}
      />
      <Animated.View
        testID="home-computer-deck"
        onLayout={onDeckLayout}
        style={[styles.deck, deckStyle]}>
        <Animated.View
          entering={riseIn()}
          pointerEvents="box-none"
          style={[styles.slot, slotStyle]}>
          <Animated.View
            pointerEvents="none"
            style={[styles.plate, { borderRadius: profile.chrome.surface }, plateStyle]}
          />
          <GestureDetector gesture={gesture}>
            <View
              style={[
                styles.slotCards,
                { borderRadius: profile.chrome.surface, borderTopLeftRadius: 0 },
              ]}>
              {[frontCard, incomingCard]
                .filter((card): card is ComputerCard => Boolean(card))
                .map((card) => (
                  <DeckSlotCard
                    key={card.serverId}
                    serverId={card.serverId}
                    role={card.serverId === frontId ? 'front' : 'incoming'}
                    hidden={card.serverId === frontId ? hideFront : true}
                    crossing={Boolean(scrub?.crossing)}
                    cross={cross}
                    crossFrom={crossFrom}
                    crossIn={crossIn}
                    shootToken={scrub && !scrub.failed ? scrub.token : null}
                    onShot={shot}>
                    {renderCard(card, actions, layoutOf(card.serverId))}
                  </DeckSlotCard>
                ))}
              {/* Cards not measured yet, laid out once unseen so the deck knows
                the tallest before anyone moves to them. */}
              {unmeasured.map((card) => (
                <View
                  key={`measure-${card.serverId}`}
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.slotCard, styles.unseen]}>
                  {renderCard(card, undefined, layoutOf(card.serverId))}
                </View>
              ))}
            </View>
          </GestureDetector>
          {scrub?.outgoing ? (
            <Animated.View pointerEvents="none" style={[styles.dust, dustStyle]}>
              <CardDust
                direction={scrub.direction}
                height={canvasHeight + DUST_TOP + DUST_BOTTOM}
                incoming={scrub.incoming}
                inProgress={inProgress}
                offsetX={DUST_SIDE}
                offsetY={DUST_TOP}
                outgoing={scrub.outgoing}
                outProgress={outProgress}
                token={scrub.token}
                width={width + DUST_SIDE * 2}
                onDrawn={drawn}
              />
            </Animated.View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Temporarily true: switch computers with a cross-fade instead of the ash dissolve. */
const DECK_DUST_OFF = true;

function disposeLater(shot: CardShot) {
  // A frame later: a draw already in flight may still be sampling it.
  requestAnimationFrame(() => requestAnimationFrame(() => disposeViewPhotograph(shot.image)));
}

function ComputerTabs({
  servers,
  selectedId,
  activeConnection,
  onSelect,
  ring,
  move,
  progress,
}: {
  ring: SharedValue<string>;
  move: SharedValue<DeckMove>;
  progress: SharedValue<number>;
  servers: readonly GatewayRecord[];
  selectedId: string | undefined;
  activeConnection?: ActiveServerConnection;
  onSelect: (id: string) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const currentId = useGatewayConnectionStore((state) => state.record?.serverId);
  const statuses = useConnectionStatuses(
    servers.map((server) => server.serverId),
    currentId,
    activeConnection
  );
  const scroll = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  useEffect(() => {
    const frame = selectedId ? frames[selectedId] : undefined;
    if (!frame || !width) return;
    const left = Math.max(0, frame.x - 8);
    const right = frame.x + frame.width + 8;
    if (left < offset.current) scroll.current?.scrollTo({ x: left, animated: true });
    else if (right > offset.current + width)
      scroll.current?.scrollTo({ x: right - width, animated: true });
  }, [selectedId, frames, width]);
  const indicatorStyle = useAnimatedStyle(() => {
    const current = ring.get();
    const from = frames[current.split('\n')[0] ?? ''];
    const next = move.get();
    const to =
      next === DECK_AT_REST ? from : frames[deckMovedKey(current, next).split('\n')[0] ?? ''];
    const amount = Math.max(0, Math.min(1, progress.get()));
    return {
      opacity: from ? 1 : 0,
      left: (from?.x ?? 0) + ((to?.x ?? from?.x ?? 0) - (from?.x ?? 0)) * amount + 12,
      width: Math.max(
        0,
        (from?.width ?? 24) + ((to?.width ?? from?.width ?? 24) - (from?.width ?? 24)) * amount - 24
      ),
    };
  });
  return (
    <ScrollView
      ref={scroll}
      testID="home-computer-tabs"
      horizontal
      style={[
        styles.tabViewport,
        {
          backgroundColor: background(theme.colors.surface),
          borderTopLeftRadius: profile.chrome.surface,
          borderTopRightRadius: profile.chrome.surface,
        },
      ]}
      showsHorizontalScrollIndicator={false}
      bounces={false}
      keyboardShouldPersistTaps="handled"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onScroll={(event) => {
        offset.current = event.nativeEvent.contentOffset.x;
      }}
      scrollEventThrottle={16}
      contentContainerStyle={styles.tabs}>
      {servers.map((server) => {
        const selected = server.serverId === selectedId;
        const status = statuses[server.serverId] ?? 'unknown';
        const ink = selected ? theme.colors.primary : theme.colors.textMuted;
        return (
          <PressableScale
            key={server.serverId}
            testID={`home-deck-peek-${server.serverId}`}
            accessibilityRole="button"
            accessibilityLabel={t`Bring ${server.label} to the front`}
            accessibilityHint={_(connectionStatusLabel[status])}
            accessibilityState={{ selected }}
            onPress={() => onSelect(server.serverId)}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              setFrames((current) =>
                current[server.serverId]?.x === x && current[server.serverId]?.width === width
                  ? current
                  : { ...current, [server.serverId]: { x, width } }
              );
            }}
            style={styles.tab}>
            <Text
              variant="bodySmall"
              weight={selected ? 'semibold' : 'medium'}
              color={ink}
              numberOfLines={1}
              style={styles.tabName}>
              {server.label}
            </Text>
          </PressableScale>
        );
      })}
      <Animated.View
        pointerEvents="none"
        style={[styles.tabAccent, { backgroundColor: theme.colors.primary }, indicatorStyle]}
      />
    </ScrollView>
  );
}

/**
 * A card in the front slot: the front one, or the incoming one rendered
 * unseen while a move photographs it. A real native view (not flattened), so
 * it can be photographed whether or not it is shown.
 */
function DeckSlotCard({
  serverId,
  role,
  hidden,
  cross,
  crossFrom,
  crossIn,
  crossing,
  shootToken,
  onShot,
  children,
}: {
  serverId: string;
  role: 'front' | 'incoming';
  hidden: boolean;
  cross: SharedValue<number>;
  /** The card fading out of a cross-fade. */
  crossFrom: SharedValue<string>;
  /** The card fading in. */
  crossIn: SharedValue<string>;
  /** A cross-fade is showing the incoming card. */
  crossing?: boolean;
  /** The move asking for a photograph, or null. */
  shootToken: number | null;
  onShot: (serverId: string, token: number, shot: CardShot | null) => void;
  children: ReactNode;
}) {
  const ref = useRef<ViewInstance>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };
  useEffect(() => {
    if (shootToken === null || !size) return;
    let live = true;
    const frame = requestAnimationFrame(() => {
      // Do not retry a gesture capture with a GPU-to-CPU readback; use the
      // existing cross-fade when this device cannot share the texture.
      photographView(ref, size.width, size.height, { allowReadback: false })
        .then((image) => (image ? { image, width: size.width, height: size.height } : null))
        .catch(() => null)
        .then((shot) => {
          if (live) onShot(serverId, shootToken, shot);
          else if (shot) disposeLater(shot);
        });
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- one photograph per move, once the card has a size.
  }, [shootToken, size?.height]);
  // Read from shared values only, never from `role`: when the incoming card
  // becomes the front, its opacity must not wait for a new worklet to run.
  // Whether a card is seen at all is React's, so it changes in the same
  // commit as the canvas over it.
  const fadeStyle = useAnimatedStyle(() => ({
    opacity:
      crossFrom.get() === serverId ? 1 - cross.get() : crossIn.get() === serverId ? cross.get() : 1,
  }));
  return (
    <Animated.View
      pointerEvents={role === 'front' && !hidden ? 'box-none' : 'none'}
      style={[styles.slotCard, fadeStyle]}>
      <View
        ref={ref}
        collapsable={false}
        onLayout={onLayout}
        pointerEvents="box-none"
        accessibilityElementsHidden={role !== 'front'}
        importantForAccessibility={role === 'front' ? 'auto' : 'no-hide-descendants'}
        style={
          (role === 'front' && hidden) || (role === 'incoming' && !crossing) ? styles.unseen : null
        }>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  deck: { minWidth: 0, minHeight: 96 },
  computers: { minWidth: 0 },
  tabViewport: { flexGrow: 0, minWidth: 0, width: '100%' },
  tabs: { gap: 2, paddingHorizontal: 4 },
  tabAccent: { position: 'absolute', bottom: 0, height: 2, borderRadius: 1 },
  tab: {
    minHeight: 36,
    maxWidth: 200,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tabName: { minWidth: 0, flexShrink: 1 },
  slot: { position: 'absolute', left: 0, right: 0, zIndex: 100 },
  plate: {
    ...StyleSheet.absoluteFill,
  },
  // Clipped to the deck's height, so a taller card is revealed as the deck grows.
  slotCards: { flex: 1, overflow: 'hidden' },
  slotCard: { position: 'absolute', left: 0, right: 0, top: 0 },
  unseen: { opacity: 0 },
  dust: {
    position: 'absolute',
    left: -DUST_SIDE,
    right: -DUST_SIDE,
    top: -DUST_TOP,
    overflow: 'hidden',
  },
});

function useComputerGesture({
  beginMove,
  busy,
  cancelled,
  commitUnderAsh,
  releasedEarly,
  deckWidth,
  direction,
  incomingReady,
  move,
  playCommit,
  progress,
  ready,
  reduced,
  ring,
  skip,
}: {
  beginMove: (next: DeckMove, towards: number, auto: boolean) => void;
  busy: SharedValue<number>;
  cancelled: () => void;
  commitUnderAsh: () => void;
  releasedEarly: (commit: boolean) => void;
  deckWidth: SharedValue<number>;
  direction: SharedValue<number>;
  incomingReady: SharedValue<number>;
  move: SharedValue<number>;
  playCommit: () => void;
  progress: SharedValue<number>;
  ready: SharedValue<number>;
  reduced: boolean;
  ring: SharedValue<string>;
  skip: SharedValue<number>;
}) {
  return useMemo(
    () =>
      Gesture.Pan()
        // Sideways only: past `failOffsetY` the page's scroll has the touch.
        // Let vertical scrolling win before a diagonal drag can start
        // photographing cards. Once this pan activates, it cannot yield back.
        .activeOffsetX([-12, 12])
        .failOffsetY([-8, 8])
        .onBegin(() => {
          // A pan that fails before activation does not own an existing transition.
          skip.set(1);
        })
        .onStart(() => {
          const count = ring.get().split('\n').length;
          if (busy.get() === 1 || count < 2) {
            skip.set(1);
            return;
          }
          skip.set(0);
          busy.set(1);
          direction.set(0);
        })
        .onUpdate((event) => {
          if (skip.get() === 1) return;
          // The side is the one the pull first goes towards, latched for the move.
          if (direction.get() === 0) {
            if (event.translationX === 0) return;
            const towards = event.translationX < 0 ? -1 : 1;
            const next = deckSwipeMove(towards, ring.get().split('\n').length);
            direction.set(towards);
            move.set(next);
            scheduleOnRN(beginMove, next, towards, false);
          }
          progress.set(
            reduced ? 0 : deckScrub(event.translationX, deckWidth.get(), direction.get())
          );
        })
        .onEnd((event, success) => {
          if (skip.get() === 1) return;
          if (!success) {
            scheduleOnRN(cancelled);
            return;
          }
          if (direction.get() === 0) {
            busy.set(0);
            return;
          }
          // An interrupted active gesture also ends here, but must never
          // change the computer receiving the reader's next goal.
          const commit =
            success &&
            deckCommits(event.translationX, event.velocityX, deckWidth.get(), direction.get());
          // Not drawing yet: wait for the photographs (or cross-fade).
          if (ready.get() !== 1) {
            scheduleOnRN(releasedEarly, commit);
            return;
          }
          // Nothing to reform from yet: the real card fades in under the ash.
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
              move.set(DECK_AT_REST);
              scheduleOnRN(cancelled);
            })
          );
        })
        .onFinalize((_event, success) => {
          // Cancellation can bypass onEnd when the native recognizer is interrupted.
          if (!success && skip.get() === 0 && busy.get() === 1) scheduleOnRN(cancelled);
        }),
    [
      beginMove,
      busy,
      cancelled,
      commitUnderAsh,
      releasedEarly,
      deckWidth,
      direction,
      incomingReady,
      move,
      playCommit,
      progress,
      ready,
      reduced,
      ring,
      skip,
    ]
  );
}
