import { useLingui as useLinguiRuntime } from '@lingui/react';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { Monitor } from 'lucide-react-native';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type ViewInstance,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { CARD_DUST_EFFECT, CardDust, type CardShot } from '@/components/card-dust';
import { StatusDot } from '@/components/status-dot';
import { appChrome } from '@/constants/appearance';
import { useConnectionStatuses } from '@/hooks/use-home-reachability';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { connectionStatusLabel } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { FINISHED_ROWS_SHOWN, HOME_CARD_INSET, type ComputerCard } from '@/lib/home-computer-cards';
import {
  DECK_AT_REST,
  DECK_ENTRY_DROP,
  DECK_ENTRY_SCALE,
  DECK_MAX_PEEKS,
  DECK_PEEK_STRIP,
  deckCommits,
  deckLevelPose,
  deckIncomingLevel,
  deckMoved,
  deckMovedKey,
  deckOrder,
  deckPeekBand,
  deckReform,
  deckScrub,
  deckSheetLevel,
  deckSwipeMove,
  deckTilt,
  type DeckMove,
} from '@/lib/home-computer-deck';
import { riseIn, timing } from '@/lib/motion';
import {
  statusNeedsPairing,
  type ActiveServerConnection,
  type ConnectionStatus,
} from '@/lib/server-reachability';
import { disposeViewPhotograph, photographView } from '@/lib/view-photograph';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeTaskCards } from '@/stores/home-task-cards';

/** The rest of the dissolve after a commit, and a whole one for a peek tap. */
const DUST_COMMIT_MS = 360;
/** The ash flowing back into the card when the pull is let go short. */
const DUST_CANCEL_SPRING = { stiffness: 220, damping: 24, reduceMotion: ReduceMotion.Never };
/** How long a commit let go before its photographs waits for them. */
const EARLY_RELEASE_WAIT_MS = 400;
/** The cross-fade that stands in for the dust. */
const CROSS_FADE_MS = 200;
/** Between one sheet arriving and the one in front of it, back to front. */
const ENTRY_STAGGER_MS = 40;
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
};

export type DeckCardActions = {
  accessibilityActions: { name: string; label: string }[];
  onAccessibilityAction: (event: AccessibilityActionEvent) => void;
};

/**
 * The phone's Computers section with two or more computers: the front card
 * whole, and the others peeking out behind it as sheets of the same paper,
 * each showing only its header line.
 *
 * A sideways pull on the front card scrubs it into ash from the edge the
 * finger pulls towards, while the next card reforms in its place; the sheets
 * behind move up one level with it. Past the commit distance, or on a flick,
 * the rest blows away; short of it, the ash flows back. Left brings the next
 * computer, right the previous. A peek brings its computer forward the same
 * way. The front computer is the composer's target and is remembered.
 *
 * Only the front card renders rows; during a move the incoming one is
 * rendered, unseen, long enough to be photographed. Every frame of a move is
 * shared values and one shader; React renders when a move starts, when its
 * photographs land and when it ends, never per frame.
 */
export function HomeComputerDeck({
  cards,
  servers,
  activeConnection,
  onSelectServer,
  renderCard,
}: {
  /** Two or more, in the cards' own order. */
  cards: readonly ComputerCard[];
  servers: readonly GatewayRecord[];
  activeConnection?: ActiveServerConnection;
  onSelectServer: (serverId: string) => void;
  renderCard: (card: ComputerCard, actions: DeckCardActions) => ReactNode;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const reduced = useReducedMotion();
  const remembered = useHomeTaskCards((state) => state.deckFront);
  const setDeckFront = useHomeTaskCards((state) => state.setDeckFront);
  const [held, setHeld] = useState<string[] | null>(null);
  const [scrub, setScrub] = useState<Scrub | null>(null);
  const [width, setWidth] = useState(0);
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
  const skip = useSharedValue(0);
  const direction = useSharedValue(-1);
  // The cross-fade: how far it is, and the card fading out.
  const cross = useSharedValue(0);
  const crossFrom = useSharedValue('');
  const deckWidth = useSharedValue(0);
  const frontHeight = useSharedValue(0);
  const band = useSharedValue(deckPeekBand(count));
  const token = useSharedValue(0);
  // A commit or a cross-fade is under way: a second request for one is ignored.
  const playing = useSharedValue(0);

  useLayoutEffect(() => {
    if (busy.get() === 0) ring.set(orderKey);
  }, [busy, orderKey, ring]);
  useEffect(() => {
    band.set(withTiming(deckPeekBand(count), timing('short')));
  }, [band, count]);

  const outProgress = useDerivedValue(() =>
    settled.get() === 1 ? 1 : Math.max(0, progress.get())
  );
  const inProgress = useDerivedValue(() =>
    settled.get() === 1 ? 0 : deckReform(Math.max(0, progress.get()))
  );

  const cardOf = (serverId: string) => cards.find((card) => card.serverId === serverId);

  // A move has ended on the UI thread: React takes the new order, and the
  // canvas goes in the same commit the new front card is shown in.
  const moved = useStableHandler((next: string) => {
    busy.set(0);
    playing.set(0);
    ready.set(0);
    setHeld(next.split('\n'));
    setScrub(null);
  });
  const cancelled = useStableHandler(() => {
    busy.set(0);
    playing.set(0);
    ready.set(0);
    setScrub(null);
  });
  const committed = useStableHandler((front: string) => {
    // The deck takes the incoming card's height while the dust plays.
    if (scrub?.incoming && scrub.incomingId === front) {
      frontHeight.set(
        withTiming(
          scrub.incoming.height,
          timing(DUST_COMMIT_MS, { reduceMotion: ReduceMotion.Never })
        )
      );
    }
    setDeckFront(front);
    onSelectServer(front);
  });

  // The stand-in for the dust: the front card cross-fades into the incoming
  // one, which is already mounted under it, and the order changes once it has
  // (Reduce Motion, a photograph that failed, a release before the
  // photographs were in, or no shader on this device). Under Reduce Motion
  // the sheets take their new levels without travelling.
  const faded = useStableHandler((next: string) => {
    setHeld(next.split('\n'));
    setScrub(null);
    requestAnimationFrame(() => {
      cross.set(0);
      crossFrom.set('');
      busy.set(0);
      playing.set(0);
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

  // Let go before the dust was drawing. A cancel has nothing to undo; a commit
  // plays the dust once the photographs land, or cross-fades if they do not
  // land soon.
  const releasedEarly = useStableHandler((commit: boolean) => {
    if (!commit || !scrub || scrub.failed) {
      crossFade(commit);
      return;
    }
    const waiting = scrub.token;
    setScrub({ ...scrub, auto: true });
    setTimeout(() => {
      if (token.get() === waiting && ready.get() !== 1) crossFade(true);
    }, EARLY_RELEASE_WAIT_MS);
  });

  const startMove = useStableHandler((next: DeckMove, towards: number) => {
    if (busy.get() === 1 || count < 2) return;
    busy.set(1);
    direction.set(towards);
    move.set(next);
    beginMove(next, towards, true);
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

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        // Sideways only: past `failOffsetY` the page's scroll has the touch.
        .activeOffsetX([-8, 8])
        .failOffsetY([-12, 12])
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
        .onEnd((event) => {
          if (skip.get() === 1) return;
          if (direction.get() === 0) {
            busy.set(0);
            return;
          }
          const commit = deckCommits(
            event.translationX,
            event.velocityX,
            deckWidth.get(),
            direction.get()
          );
          if (ready.get() !== 1) {
            scheduleOnRN(releasedEarly, commit);
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
        }),
    [
      beginMove,
      busy,
      cancelled,
      releasedEarly,
      deckWidth,
      direction,
      move,
      playCommit,
      progress,
      ready,
      reduced,
      ring,
      skip,
    ]
  );

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
  const onFrontHeight = (height: number) => {
    frontHeight.set(frontHeight.get() === 0 ? height : withTiming(height, timing('short')));
  };

  const deckStyle = useAnimatedStyle(() => ({
    height: band.get() + frontHeight.get(),
  }));
  // The ash may blow above and beside the card, but nothing is drawn below
  // the deck's current height: a taller incoming card shows as the deck grows.
  const dustStyle = useAnimatedStyle(() => ({
    height: DUST_TOP + frontHeight.get() + DUST_BOTTOM,
  }));
  const slotStyle = useAnimatedStyle(() => ({
    top: band.get(),
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

  const visibleLevels = Math.min(count - 1, DECK_MAX_PEEKS);
  const incomingCard = scrub ? cardOf(scrub.incomingId) : undefined;
  const frontCard = frontId ? cardOf(frontId) : undefined;
  const hideFront = Boolean(scrub?.drawing);
  const canvasHeight = Math.max(scrub?.outgoing?.height ?? 0, scrub?.incoming?.height ?? 0);
  const serverOf = (serverId: string) => servers.find((server) => server.serverId === serverId);

  return (
    <Animated.View
      testID="home-computer-deck"
      onLayout={onDeckLayout}
      style={[styles.deck, deckStyle]}>
      {order.map((serverId, position) => {
        const card = cardOf(serverId);
        const server = serverOf(serverId);
        if (!card || !server) return null;
        return (
          <DeckSheet
            key={serverId}
            entering={riseIn(
              Math.max(0, visibleLevels - Math.min(position, visibleLevels)) * ENTRY_STAGGER_MS,
              ENTRY_STAGGER_MS * DECK_MAX_PEEKS
            )}
            serverId={serverId}
            position={position}
            band={band}
            ring={ring}
            move={move}
            progress={progress}
            frontHeight={frontHeight}>
            {/* The front's own strip waits under it, unseen, for when it goes to the back. */}
            <PeekStrip
              card={card}
              server={server}
              activeConnection={activeConnection}
              more={
                position === DECK_MAX_PEEKS && count > DECK_MAX_PEEKS + 1
                  ? count - DECK_MAX_PEEKS - 1
                  : 0
              }
              onPress={() => startMove(position, -1)}
            />
          </DeckSheet>
        );
      })}
      <Animated.View
        entering={riseIn(visibleLevels * ENTRY_STAGGER_MS, ENTRY_STAGGER_MS * DECK_MAX_PEEKS)}
        pointerEvents="box-none"
        style={[styles.slot, slotStyle]}>
        <Animated.View
          pointerEvents="none"
          style={[styles.plate, { borderRadius: profile.chrome.surface }, plateStyle]}
        />
        <GestureDetector gesture={gesture}>
          <View style={[styles.slotCards, { borderRadius: profile.chrome.surface }]}>
            {frontCard ? (
              <DeckSlotCard
                key={frontCard.serverId}
                serverId={frontCard.serverId}
                role="front"
                hidden={hideFront}
                cross={cross}
                crossFrom={crossFrom}
                shootToken={scrub && !scrub.failed ? scrub.token : null}
                onHeight={onFrontHeight}
                onShot={shot}>
                {renderCard(frontCard, actions)}
              </DeckSlotCard>
            ) : null}
            {incomingCard && incomingCard.serverId !== frontId ? (
              <DeckSlotCard
                key={incomingCard.serverId}
                serverId={incomingCard.serverId}
                role="incoming"
                hidden
                cross={cross}
                crossFrom={crossFrom}
                shootToken={scrub && !scrub.failed ? scrub.token : null}
                onShot={shot}>
                {renderCard(incomingCard, actions)}
              </DeckSlotCard>
            ) : null}
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
  );
}

function disposeLater(shot: CardShot) {
  // A frame later: a draw already in flight may still be sampling it.
  requestAnimationFrame(() => requestAnimationFrame(() => disposeViewPhotograph(shot.image)));
}

/**
 * One sheet of the sheaf, as tall as the front card, at the level the ring
 * and the move in progress put it. Its stacking follows the level it is
 * headed for, so a sheet never passes over the one it is moving behind.
 */
function DeckSheet({
  entering,
  serverId,
  position,
  band,
  ring,
  move,
  progress,
  frontHeight,
  children,
}: {
  entering: ReturnType<typeof riseIn>;
  serverId: string;
  position: number;
  band: SharedValue<number>;
  /** The order on the UI thread, ids joined by a newline. */
  ring: SharedValue<string>;
  move: SharedValue<DeckMove>;
  progress: SharedValue<number>;
  frontHeight: SharedValue<number>;
  children: ReactNode;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const tilt = deckTilt(serverId);
  const sheetStyle = useAnimatedStyle(() => {
    const order = ring.get().split('\n');
    const at = order.indexOf(serverId);
    const current = move.get();
    // Eased, so a sheet settles into its level rather than stopping there.
    const raw = Math.min(1, Math.max(0, progress.get()));
    const p = 1 - (1 - raw) * (1 - raw);
    const sheet = deckSheetLevel(Math.max(0, at), order.length, p, current);
    const pose = deckLevelPose(sheet.level);
    const enter = sheet.enter;
    const scale =
      enter < 1 ? DECK_ENTRY_SCALE + (pose.scale - DECK_ENTRY_SCALE) * enter : pose.scale;
    return {
      top: band.get(),
      height: frontHeight.get(),
      opacity: at < 0 ? 0 : pose.opacity * sheet.fade,
      transform: [
        { translateY: pose.translateY + DECK_ENTRY_DROP * (1 - enter) },
        { scale },
        { rotate: `${tilt * Math.min(1, sheet.level)}deg` },
      ],
    };
  });
  // On the sheet's outermost view, so it orders it among its siblings.
  const layerStyle = useAnimatedStyle(() => {
    const order = ring.get().split('\n');
    const at = order.indexOf(serverId);
    const current = move.get();
    const sheet = deckSheetLevel(Math.max(0, at), order.length, 0, current);
    const incoming = current !== DECK_AT_REST && at === deckIncomingLevel(current);
    return { zIndex: incoming ? 0 : 50 - sheet.rest * 10 };
  });
  return (
    <Animated.View pointerEvents="box-none" style={[styles.sheetLayer, layerStyle]}>
      <Animated.View entering={entering} pointerEvents="box-none" style={styles.sheetLayer}>
        <Animated.View
          pointerEvents={position === 0 ? 'none' : 'box-none'}
          accessibilityElementsHidden={position === 0 || position > DECK_MAX_PEEKS}
          importantForAccessibility={
            position === 0 || position > DECK_MAX_PEEKS ? 'no-hide-descendants' : 'auto'
          }
          style={[
            styles.sheet,
            {
              backgroundColor: background(theme.colors.surface),
              borderRadius: profile.chrome.surface,
            },
            sheetStyle,
          ]}>
          {children}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The header line a sheet behind the front shows: the computer, its
 * connection and what is open on it. A button that brings it forward.
 */
function PeekStrip({
  card,
  server,
  activeConnection,
  more,
  onPress,
}: {
  card: ComputerCard;
  server: GatewayRecord;
  activeConnection?: ActiveServerConnection;
  /** Computers further back than the last peek, counted on it. */
  more: number;
  onPress: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const selectedId = useGatewayConnectionStore((state) => state.record?.serverId);
  const status: ConnectionStatus =
    useConnectionStatuses([server.serverId], selectedId, activeConnection)[server.serverId] ??
    'unknown';
  const statusColor = statusNeedsPairing(status)
    ? theme.colors.warning
    : status === 'offline' || status === 'reconnecting' || status === 'unknown'
      ? theme.colors.textSubtle
      : theme.colors.success;
  const waiting = card.now.filter((row) => row.task.state === 'waiting').length;
  const running = card.now.filter((row) => row.task.state === 'working').length;
  const failed =
    card.finished.slice(0, FINISHED_ROWS_SHOWN).filter((task) => task.state === 'failed').length +
    card.pending.filter((item) => item.failed).length;
  const counts = [
    waiting > 0 ? t`${plural(waiting, { one: '# needs you', other: '# need you' })}` : null,
    running > 0 ? t`${plural(running, { one: '# running', other: '# running' })}` : null,
    failed > 0 ? t`${plural(failed, { one: '# failed', other: '# failed' })}` : null,
  ].filter((part): part is string => part !== null);
  return (
    <PressableScale
      testID={`home-deck-peek-${server.serverId}`}
      accessibilityRole="button"
      accessibilityLabel={t`Bring ${server.label} to the front`}
      accessibilityHint={_(connectionStatusLabel[status])}
      onPress={onPress}
      style={styles.strip}>
      <Monitor size={16} color={theme.colors.primary} />
      <Text variant="caption" weight="semibold" numberOfLines={1} style={styles.stripName}>
        {server.label}
      </Text>
      <StatusDot color={statusColor} filled={status !== 'unknown'} pulse={false} />
      <View style={styles.fill} />
      {counts.length > 0 ? (
        <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
          {counts.join(' · ')}
        </Text>
      ) : null}
      {more > 0 ? (
        <View style={[styles.more, { backgroundColor: background(theme.colors.surfaceRaised) }]}>
          <Text variant="caption" color={theme.colors.textMuted}>
            {`+${more}`}
          </Text>
        </View>
      ) : null}
    </PressableScale>
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
  shootToken,
  onHeight,
  onShot,
  children,
}: {
  serverId: string;
  role: 'front' | 'incoming';
  hidden: boolean;
  cross: SharedValue<number>;
  /** The card fading out of a cross-fade. */
  crossFrom: SharedValue<string>;
  /** The move asking for a photograph, or null. */
  shootToken: number | null;
  onHeight?: (height: number) => void;
  onShot: (serverId: string, token: number, shot: CardShot | null) => void;
  children: ReactNode;
}) {
  const ref = useRef<ViewInstance>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    onHeight?.(height);
  };
  useEffect(() => {
    if (role === 'front' && size) onHeight?.(size.height);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- when this card becomes the front: its height is already known.
  }, [role]);
  useEffect(() => {
    if (shootToken === null || !size) return;
    let live = true;
    const frame = requestAnimationFrame(() => {
      photographView(ref, size.width, size.height)
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
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: role === 'incoming' ? cross.get() : crossFrom.get() === serverId ? 1 - cross.get() : 1,
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
        style={role === 'front' && hidden ? styles.unseen : null}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  deck: { minWidth: 0 },
  sheetLayer: { ...StyleSheet.absoluteFill },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
    transformOrigin: '50% 0%',
    boxShadow: appChrome.shadow.deckSheet,
  },
  strip: {
    height: DECK_PEEK_STRIP,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: HOME_CARD_INSET,
  },
  stripName: { flexShrink: 1, minWidth: 0 },
  more: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  fill: { flexGrow: 1 },
  slot: { position: 'absolute', left: 0, right: 0, zIndex: 100 },
  plate: {
    ...StyleSheet.absoluteFill,
    boxShadow: appChrome.shadow.deckSheet,
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
