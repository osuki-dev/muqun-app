import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, Button, Text } from '@osuki-dev/ui';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { ReleaseIntroArt } from '@/components/release-intro-art';
import { useAppActive } from '@/hooks/use-app-active';
import { markLaunchIntroSeen } from '@/lib/launch-intro-seen';
import { DURATION, timing } from '@/lib/motion';

const HEADER_MARK_SIZE = 40;
const GUTTER = 24;
/** The compact page's header, footer and copy, which the art leaves room for. */
const COMPACT_COPY_BUDGET = 440;
const ART_MIN_HEIGHT = 160;

/**
 * The 4.0 release introduction. Home mounts underneath it as usual; only the
 * reader's Skip or final Continue marks this edition as seen. Nothing advances
 * on a timer, and the decorative renderer never owns navigation or readiness.
 * The first frame still mirrors the native splash before the mark moves into
 * the header. Text and controls remain ordinary native, scrollable content.
 */
export function LaunchIntro({
  phase,
  finish,
  onDone,
}: SplashRenderContext & { onDone: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const mirror = useSplashMirror();
  const active = useAppActive();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [sheetHeight, setSheetHeight] = useState(height);
  const [index, setIndex] = useState(0);
  const scroll = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [index]);
  const pages = [
    {
      key: 'home',
      title: t`From a goal to work in motion.`,
      body: t`Choose a computer and an agent, then send your goal from Home. Follow tasks and decisions in the same place.`,
    },
    {
      key: 'git',
      title: t`Your checkout, in one workspace.`,
      body: t`Changes and Lazygit now live together. Move between linked worktrees when your Gateway supports them.`,
    },
    {
      key: 'updates',
      title: t`Know what is coming next.`,
      body: t`Read release notes before downloading. Follow real download progress, then restart when the update is ready—or leave it for later.`,
    },
  ];
  const page = pages[index]!;
  const position = index + 1;
  const count = pages.length;
  const last = position === count;
  const spread = width >= 768;
  // The page is measured inside the side safe area: iPhone Duo stacks its
  // camera, clock and status icons down the right edge, so Skip and the copy
  // must not reach under them. The splash ground stays full-bleed.
  const safeWidth = width - insets.left - insets.right;
  const pageWidth = Math.min(safeWidth - GUTTER * 2, spread ? 1040 : 560);
  const pageInset = (safeWidth - pageWidth) / 2;
  const pageLeft = insets.left + pageInset;
  // A short window (the Duo's outer display) cannot hold the full-width art
  // and the copy, so the art gives way first and the copy stays readable
  // without scrolling. Taller phones keep the art at its natural size.
  const artMaxHeight = spread
    ? undefined
    : Math.max(ART_MIN_HEIGHT, height - insets.top - insets.bottom - COMPACT_COPY_BUDGET);
  const logoHeight = mirror.logo.style.height;
  const markScale =
    typeof logoHeight === 'number' && logoHeight > 0 ? HEADER_MARK_SIZE / logoHeight : 1;
  const markShiftX = pageLeft + HEADER_MARK_SIZE / 2 - width / 2;
  const markShiftY = insets.top + GUTTER + HEADER_MARK_SIZE / 2 - sheetHeight / 2;
  const reveal = useSharedValue(0);
  const exit = useSharedValue(0);
  const followPhase = useEffectEvent(() => {
    if (!active) {
      cancelAnimation(reveal);
      cancelAnimation(exit);
      if (phase === 'visible') reveal.set(1);
      if (phase === 'exiting') finish();
      return;
    }
    if (phase === 'visible') {
      reveal.set(withDelay(DURATION.micro, withTiming(1, timing('long'))));
    } else if (phase === 'exiting') {
      exit.set(
        withTiming(1, timing('medium'), (finished) => {
          if (finished) scheduleOnRN(finish);
        })
      );
    }
  });
  useEffect(() => {
    followPhase();
  }, [phase, active]);
  useEffect(
    () => () => {
      cancelAnimation(reveal);
      cancelAnimation(exit);
    },
    [reveal, exit]
  );
  const announcePage = useEffectEvent(() => {
    if (phase === 'visible' && active) {
      AccessibilityInfo.announceForAccessibility(
        `${t`Step ${position} of ${count}`}. ${page.title} ${page.body}`
      );
    }
  });
  useEffect(() => {
    announcePage();
  }, [index, phase, active]);

  const done = () => {
    markLaunchIntroSeen();
    onDone();
  };
  const sheetStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.get() }));
  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(reveal.get(), [0, 1], [0, markShiftX]) },
      { translateY: interpolate(reveal.get(), [0, 1], [0, markShiftY]) },
      { scale: interpolate(reveal.get(), [0, 1], [1, markScale]) },
    ],
  }));
  const pageStyle = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.get(), [0.2, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(reveal.get(), [0, 1], [24, 0]) }],
  }));
  const actions = (
    <View style={styles.actions}>
      {index > 0 ? (
        <Button
          variant="ghost"
          onPress={() => setIndex((current) => Math.max(0, current - 1))}
          testID="launch-intro-back">
          {t`Back`}
        </Button>
      ) : null}
      <Button
        variant="primary"
        style={styles.next}
        onPress={last ? done : () => setIndex((current) => Math.min(count - 1, current + 1))}
        testID={last ? 'launch-intro-start' : 'launch-intro-next'}>
        {last ? t`Get started` : t`Continue`}
      </Button>
    </View>
  );
  const copy = (
    <View style={styles.copy} testID={`launch-intro-feature-${page.key}`}>
      <View style={styles.eyebrow}>
        <Text variant="label" color={theme.colors.primary}>{t`New in 4.0`}</Text>
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          accessibilityLabel={t`Step ${position} of ${count}`}>
          {`${position} / ${count}`}
        </Text>
      </View>
      <Text
        weight="semibold"
        accessibilityRole="header"
        style={[
          spread ? styles.headlineRegular : styles.headlineCompact,
          { color: theme.colors.text },
        ]}>
        {page.title}
      </Text>
      <Text variant="body" color={theme.colors.textMuted} style={styles.lede}>
        {page.body}
      </Text>
      <View
        style={styles.steps}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {pages.map((item, step) => (
          <View
            key={item.key}
            style={[
              styles.step,
              { backgroundColor: step === index ? theme.colors.primary : theme.colors.border },
            ]}
          />
        ))}
      </View>
      {spread ? actions : null}
    </View>
  );
  const art = (
    <ReleaseIntroArt scene={index} visible={phase === 'visible'} maxHeight={artMaxHeight} />
  );

  return (
    <Animated.View
      style={[mirror.container.style, sheetStyle]}
      onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
      {mirror.hasLogo ? (
        <Animated.Image {...mirror.logo} style={[mirror.logo.style, markStyle]} />
      ) : null}
      <Animated.View
        pointerEvents={phase === 'visible' ? 'auto' : 'none'}
        accessibilityElementsHidden={phase !== 'visible'}
        importantForAccessibility={phase === 'visible' ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.page,
          {
            paddingTop: insets.top + GUTTER,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
          pageStyle,
        ]}>
        <View style={[styles.header, { width: pageWidth }]}>
          <View style={styles.markSlot} />
          <Pressable
            onPress={done}
            accessibilityRole="button"
            testID="launch-intro-skip"
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
            <Text variant="label" color={theme.colors.textMuted}>{t`Skip intro`}</Text>
          </Pressable>
        </View>
        <ScrollView
          ref={scroll}
          style={styles.scroller}
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: pageInset }]}
          showsVerticalScrollIndicator={false}>
          {spread ? (
            <View style={styles.spread}>
              {copy}
              <View style={styles.spreadArt}>{art}</View>
            </View>
          ) : (
            <>
              {art}
              {copy}
            </>
          )}
        </ScrollView>
        {spread ? null : <View style={[styles.footer, { width: pageWidth }]}>{actions}</View>}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { ...StyleSheet.absoluteFill, alignItems: 'center' },
  header: {
    minHeight: HEADER_MARK_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  markSlot: { width: HEADER_MARK_SIZE, height: HEADER_MARK_SIZE },
  skipButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  pressed: { opacity: 0.6 },
  scroller: { alignSelf: 'stretch', flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 24,
    gap: 8,
  },
  spread: { flexDirection: 'row', alignItems: 'center', gap: 48 },
  spreadArt: { flex: 1 },
  copy: { flex: 1, gap: 16 },
  eyebrow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  headlineCompact: { fontSize: 32, lineHeight: 38, letterSpacing: -1 },
  headlineRegular: { fontSize: 44, lineHeight: 50, letterSpacing: -1.5 },
  lede: { lineHeight: 25 },
  steps: { flexDirection: 'row', gap: 6, marginTop: 4, marginBottom: 8 },
  step: { width: 24, height: 3, borderRadius: 2 },
  footer: { paddingTop: 12, paddingBottom: 20 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  next: { flex: 1 },
});
