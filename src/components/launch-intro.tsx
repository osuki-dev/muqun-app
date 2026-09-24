import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Bell, Bot, ScanLine, SquareTerminal, type LucideIcon } from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Button } from '@/components/themed-button';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { markLaunchIntroSeen } from '@/lib/launch-intro-seen';
import { DURATION, timing } from '@/lib/motion';

/**
 * The first launch, and only the first: four pages that say what the app is
 * for, then the app.
 *
 * Drawn inside `@osuki-dev/react-native-splash`'s overlay so it begins from
 * the native splash itself: the first frame is the flat mark on the app's
 * paper, exactly what the OS was showing, and `phase === 'visible'` is the
 * cue to move. The mark shrinks into a header and the pages rise under it;
 * on exit the whole sheet drops and fades, which is the app's first screen
 * appearing from behind it.
 *
 * Copy comes through the hook's `t`, not the global one, for the reason
 * `_layout.tsx` and every screen give: React Compiler memoises a global `t`
 * call across a language switch. The first page is the one that makes the app
 * the reader's own -- themes -- and the other three are the README's verbs:
 * answer the question, draw the real terminal, stay on your own machine.
 * Nothing on any of them needs a Gateway to be true.
 *
 * "Skip intro" and "Get started" both record the intro as seen. Seen is a
 * decision the reader made, and skipping is one; showing it again next launch
 * would be the app not taking no for an answer.
 */

type IntroPage = {
  key: string;
  icon: LucideIcon;
  title: string;
  body: string;
};

/** The header mark, in points: the native 128 pt mark shrunk to a badge. */
const HEADER_MARK_SCALE = 0.56;
/** Pages never run wider than this, so an iPad reads a column rather than a poster. */
const PAGE_MAX_WIDTH = 560;
const ART_SIZE = { compact: 132, regular: 168 } as const;

export function LaunchIntro({
  phase,
  finish,
  onDone,
}: SplashRenderContext & { onDone: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const mirror = useSplashMirror();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef<Animated.ScrollView>(null);
  const [page, setPage] = useState(0);
  // A horizontal ScrollView does not size its pages to its own height, and a
  // page taller than the scroller is clipped at the top. Measure once and
  // give every page exactly that height, so the column can centre inside it.
  const [scrollerHeight, setScrollerHeight] = useState(0);

  const pages: IntroPage[] = [
    {
      key: 'opencode',
      icon: Bot,
      title: t`OpenCode Agent`,
      body: t`Direct control for OpenCode autonomous coding. Follow real-time reasoning, inspect code diffs, review step-by-step todos, and guide tasks on the go.`,
    },
    {
      key: 'terminal',
      icon: SquareTerminal,
      title: t`The real terminal`,
      body: t`Output lands on a hardware-accelerated terminal grid with instant-response keys and full tmux control. nvim, less and REPLs behave.`,
    },
    {
      key: 'answer',
      icon: Bell,
      title: t`The question comes to you`,
      body: t`When an agent halts for confirmation, the prompt arrives as a push. Approve or deny from the Lock Screen, and track live progress on Dynamic Island and widgets.`,
    },
    {
      key: 'gateway',
      icon: ScanLine,
      title: t`Your machine, your rules`,
      body: t`Scan the QR code of a Gateway running on your own computer. No account, no relay, end-to-end encrypted, and 32 handcrafted themes to make it yours.`,
    },
  ];
  const last = pages.length - 1;
  const widthClass = width >= 768 ? 'regular' : 'compact';

  const reveal = useSharedValue(0);
  const scrollX = useSharedValue(0);
  const exit = useSharedValue(0);

  // Only the phase drives this. Everything else it reads -- the shared values,
  // which are stable, and `finish` -- is read when the phase changes rather
  // than being a reason to run, which is what an effect event is for.
  const followPhase = useEffectEvent(() => {
    if (phase === 'visible') {
      reveal.set(withDelay(DURATION.micro, withTiming(1, timing('long'))));
      return;
    }
    if (phase !== 'exiting') return;
    exit.set(
      withTiming(1, timing('long'), (finished) => {
        if (finished) scheduleOnRN(finish);
      })
    );
  });
  useEffect(() => {
    followPhase();
  }, [phase]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.set(event.contentOffset.x);
  });

  const done = () => {
    markLaunchIntroSeen();
    onDone();
  };
  const next = () => {
    if (page >= last) {
      done();
      return;
    }
    const nextPage = page + 1;
    setPage(nextPage);
    scrollRef.current?.scrollTo({ x: nextPage * width, animated: true });
  };

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ translateY: exit.value * 48 }],
  }));
  // From the centred native mark to a small badge at the top of the column.
  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(reveal.value, [0, 1], [0, -height * 0.3]) },
      { scale: interpolate(reveal.value, [0, 1], [1, HEADER_MARK_SCALE]) },
    ],
  }));
  const pagesStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: interpolate(reveal.value, [0, 1], [40, 0]) }],
  }));
  const skipStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));

  return (
    <Animated.View style={[mirror.container.style, sheetStyle]}>
      {mirror.hasLogo ? (
        <Animated.Image {...mirror.logo} style={[mirror.logo.style, markStyle]} />
      ) : null}

      <Animated.View style={[styles.skip, { top: insets.top + 8 }, skipStyle]}>
        <Pressable
          onPress={done}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t`Skip intro`}
          testID="launch-intro-skip"
          style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
          <Text variant="label" color={theme.colors.textMuted}>
            {t`Skip intro`}
          </Text>
        </Pressable>
      </Animated.View>

      <Animated.View
        style={[styles.pages, { top: height * 0.3, bottom: insets.bottom }, pagesStyle]}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          onMomentumScrollEnd={(event) =>
            setPage(Math.round(event.nativeEvent.contentOffset.x / width))
          }
          scrollEventThrottle={16}
          onLayout={(event) => setScrollerHeight(event.nativeEvent.layout.height)}
          style={styles.scroller}>
          {pages.map((item, index) => (
            <Page
              key={item.key}
              index={index}
              width={width}
              height={scrollerHeight}
              artSize={ART_SIZE[widthClass]}
              scrollX={scrollX}
              page={item}
              tileColor={surfaceBackground(theme.colors.primarySubtle)}
              iconColor={theme.colors.primary}
              textColor={theme.colors.text}
              mutedColor={theme.colors.textMuted}
            />
          ))}
        </Animated.ScrollView>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {pages.map((item, index) => (
              <Dot
                key={item.key}
                index={index}
                width={width}
                scrollX={scrollX}
                color={theme.colors.primary}
              />
            ))}
          </View>
          <View style={styles.action}>
            <Button variant="primary" onPress={next} testID="launch-intro-next">
              {page >= last ? t`Get started` : t`Next`}
            </Button>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function Page({
  index,
  width,
  height,
  artSize,
  scrollX,
  page,
  tileColor,
  iconColor,
  textColor,
  mutedColor,
}: {
  index: number;
  width: number;
  height: number;
  artSize: number;
  scrollX: SharedValue<number>;
  page: IntroPage;
  tileColor: string;
  iconColor: string;
  textColor: string;
  mutedColor: string;
}) {
  const range = [(index - 1) * width, index * width, (index + 1) * width];
  const artStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateX: interpolate(
          scrollX.value,
          range,
          [width * 0.3, 0, -width * 0.3],
          Extrapolation.CLAMP
        ),
      },
      {
        rotateZ: `${interpolate(scrollX.value, range, [10, 0, -10], Extrapolation.CLAMP)}deg`,
      },
    ],
  }));
  const copyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateX: interpolate(
          scrollX.value,
          range,
          [width * 0.12, 0, -width * 0.12],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));
  const Icon = page.icon;
  return (
    <View
      style={[
        styles.page,
        // Centred in the room under the header mark, then lifted: optically
        // the column reads as centred when it sits a little above the middle.
        height > 0 ? { width, height, paddingBottom: height * 0.12 } : { width },
      ]}>
      <View style={styles.column}>
        <Animated.View
          style={[
            styles.art,
            {
              width: artSize,
              height: artSize,
              borderRadius: artSize * 0.26,
              backgroundColor: tileColor,
            },
            artStyle,
          ]}>
          <Icon size={artSize * 0.46} color={iconColor} strokeWidth={1.6} />
        </Animated.View>
        <Animated.View style={[styles.copy, copyStyle]}>
          <Text variant="heading" style={[styles.title, { color: textColor }]}>
            {page.title}
          </Text>
          <Text variant="body" style={[styles.body, { color: mutedColor }]}>
            {page.body}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

function Dot({
  index,
  width,
  scrollX,
  color,
}: {
  index: number;
  width: number;
  scrollX: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const range = [(index - 1) * width, index * width, (index + 1) * width];
    return {
      width: interpolate(scrollX.value, range, [8, 24, 8], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, range, [0.3, 1, 0.3], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  skip: { position: 'absolute', right: 20 },
  skipButton: { paddingHorizontal: 12, paddingVertical: 8 },
  pressed: { opacity: 0.6 },
  pages: { position: 'absolute', left: 0, right: 0 },
  scroller: { flex: 1 },
  page: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  column: { width: '100%', maxWidth: PAGE_MAX_WIDTH, alignItems: 'center', gap: 28 },
  art: { alignItems: 'center', justifyContent: 'center' },
  copy: { alignItems: 'center', gap: 10 },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', lineHeight: 24 },
  footer: { alignItems: 'center', gap: 22, paddingTop: 12, paddingBottom: 28 },
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { height: 8, borderRadius: 4 },
  action: { width: '100%', maxWidth: 360, paddingHorizontal: 28 },
});
