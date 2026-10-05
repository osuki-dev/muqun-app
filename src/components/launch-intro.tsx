import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import {
  Bell,
  Bot,
  FolderTree,
  Keyboard,
  Palette,
  ShieldCheck,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useEffectEvent, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Button } from '@/components/themed-button';
import { appChrome } from '@/constants/appearance';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { markLaunchIntroSeen } from '@/lib/launch-intro-seen';
import { DURATION, timing } from '@/lib/motion';

/**
 * The first launch, and only the first: one page that says what the app is
 * for, then the app.
 *
 * Drawn inside `@osuki-dev/react-native-splash`'s overlay so it begins from
 * the native splash itself: the first frame is the flat mark on the app's
 * paper, exactly what the OS was showing, and `phase === 'visible'` is the
 * cue to move. The mark shrinks into the header, at the column's left edge,
 * and the page rises under it, its features arriving one after another; on
 * exit the whole sheet drops and fades, which is the app's first screen
 * appearing from behind it.
 *
 * One page rather than a pager. A wizard of four cards and a Next button asks
 * the reader to page through a brochure before they may use the app; a single
 * page they can take in at a glance, or scroll when the text is large, says
 * the same things and leaves the pace to them. On a phone the headline sits
 * over the features, with the one action pinned at the foot; from 768 pt the
 * headline and the action take the left column and the features the right, so
 * a tablet reads a spread rather than a phone column with a gulf beside it.
 *
 * Copy comes through the hook's `t`, not the global one, for the reason
 * `_layout.tsx` and every screen give: React Compiler memoises a global `t`
 * call across a language switch. The features are 3.1.0's, in the order a
 * reader meets them: the agents, the terminal, the question, the changes, the
 * Pad, the machine, the theme. Nothing on the page needs a Gateway to be true.
 *
 * "Skip intro" and "Get started" both record the intro as seen. Seen is a
 * decision the reader made, and skipping is one; showing it again next launch
 * would be the app not taking no for an answer.
 */

type IntroFeature = {
  key: string;
  icon: LucideIcon;
  title: string;
  body: string;
};

/** The header mark, in points: the native mark shrunk to a badge beside Skip. */
const HEADER_MARK_SIZE = 40;
/** The phone column's margin, and the room above the header mark. */
const GUTTER = 24;
/** From this width the page is a two-column spread. */
const SPREAD_MIN_WIDTH = 768;
/** The spread never runs wider than this, so a large tablet reads a page rather than a poster. */
const SPREAD_MAX_WIDTH = 1040;
/** A phone column, or one turned sideways, never runs wider than this. */
const COLUMN_MAX_WIDTH = 560;
const FEATURE_TILE = 36;
/**
 * The headline, set the way Home sets its wordmark: semibold, with the
 * tracking pulled in harder the larger it is set.
 */
const HEADLINE = {
  compact: { fontSize: 32, lineHeight: 37, letterSpacing: -1 },
  regular: { fontSize: 44, lineHeight: 49, letterSpacing: -1.6 },
} as const;

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
  // The mark starts centred in the overlay, which is not always the window:
  // measure the overlay so the mark lands exactly on its slot in the header.
  const [sheetHeight, setSheetHeight] = useState(height);

  const features: IntroFeature[] = [
    {
      key: 'agents',
      icon: Bot,
      title: t`Several agents, one computer`,
      body: t`OpenCode, DeepSeek and T3 Code side by side, each with its own tile, sessions and workbench.`,
    },
    {
      key: 'terminal',
      icon: SquareTerminal,
      title: t`The real terminal`,
      body: t`Drawn on the GPU with Skia, with real keys and full tmux control. nvim, less and REPLs behave.`,
    },
    {
      key: 'answer',
      icon: Bell,
      title: t`The question comes to you`,
      body: t`When an agent stops for a decision, it arrives as a push. Approve or deny from the Lock Screen.`,
    },
    {
      key: 'changes',
      icon: FolderTree,
      title: t`Changes as a tree`,
      body: t`Every changed file in one folder tree with line totals. Open a patch, or discard a file from its menu.`,
    },
    {
      key: 'pad',
      icon: Keyboard,
      title: t`A spread on the Pad`,
      body: t`On a tablet, Home opens as a two-page spread and the on-screen keyboard is a whole keyboard.`,
    },
    {
      key: 'gateway',
      icon: ShieldCheck,
      title: t`Your machine, your rules`,
      body: t`Scan the QR code of a Gateway on your own computer. No account, no relay, end-to-end encrypted.`,
    },
    {
      key: 'themes',
      icon: Palette,
      title: t`Make it yours`,
      body: t`Cover Courier comes built in. Install a theme or pick a colour pack, and the whole app follows.`,
    },
  ];

  const spread = width >= SPREAD_MIN_WIDTH;
  const pageWidth = Math.min(width - GUTTER * 2, spread ? SPREAD_MAX_WIDTH : COLUMN_MAX_WIDTH);
  const pageLeft = (width - pageWidth) / 2;
  const headline = spread ? HEADLINE.regular : HEADLINE.compact;
  const tileColor = surfaceBackground(theme.colors.primarySubtle);

  // Where the mark lands: the header's left slot, under the status bar.
  const logoHeight = mirror.logo.style.height;
  const markScale =
    typeof logoHeight === 'number' && logoHeight > 0 ? HEADER_MARK_SIZE / logoHeight : 1;
  const markShiftX = pageLeft + HEADER_MARK_SIZE / 2 - width / 2;
  const markShiftY = insets.top + GUTTER + HEADER_MARK_SIZE / 2 - sheetHeight / 2;

  const reveal = useSharedValue(0);
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

  const done = () => {
    markLaunchIntroSeen();
    onDone();
  };

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ translateY: exit.value * 48 }],
  }));
  // From the centred native mark to the badge at the head of the column.
  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(reveal.value, [0, 1], [0, markShiftX]) },
      { translateY: interpolate(reveal.value, [0, 1], [0, markShiftY]) },
      { scale: interpolate(reveal.value, [0, 1], [1, markScale]) },
    ],
  }));
  const pageStyle = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.value, [0.2, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(reveal.value, [0, 1], [32, 0]) }],
  }));

  const action = (
    <View style={spread ? styles.spreadAction : styles.phoneAction}>
      <Button variant="primary" onPress={done} testID="launch-intro-start">
        {t`Get started`}
      </Button>
    </View>
  );
  const intro = (
    <View style={spread ? styles.spreadLead : styles.phoneLead}>
      <Text
        weight="semibold"
        accessibilityRole="header"
        style={[headline, { color: theme.colors.text }]}>
        {t`Every agent on your computer, in your hand.`}
      </Text>
      <Text variant="body" color={theme.colors.textMuted} style={styles.lede}>
        {t`Muqun pairs with a Gateway on your own machine and puts its coding agents and terminals on your phone or tablet.`}
      </Text>
      {spread ? action : null}
    </View>
  );
  const list = (
    <View style={spread ? styles.spreadList : styles.phoneList}>
      {features.map((feature, index) => (
        <FeatureRow
          key={feature.key}
          feature={feature}
          index={index}
          count={features.length}
          reveal={reveal}
          tileColor={tileColor}
          iconColor={theme.colors.primary}
          textColor={theme.colors.text}
          mutedColor={theme.colors.textMuted}
        />
      ))}
    </View>
  );

  return (
    <Animated.View
      style={[mirror.container.style, sheetStyle]}
      onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
      {mirror.hasLogo ? (
        <Animated.Image {...mirror.logo} style={[mirror.logo.style, markStyle]} />
      ) : null}

      <Animated.View
        style={[
          styles.page,
          { paddingTop: insets.top + GUTTER, paddingBottom: insets.bottom },
          pageStyle,
        ]}>
        {/* The header: an empty slot the mark lands in, and the quiet way out. */}
        <View style={[styles.header, { width: pageWidth }]}>
          <View style={styles.markSlot} />
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
        </View>

        <ScrollView
          style={styles.scroller}
          contentContainerStyle={[
            styles.scrollContent,
            spread && styles.spreadScrollContent,
            { paddingHorizontal: pageLeft },
          ]}
          showsVerticalScrollIndicator={false}>
          {spread ? (
            <View style={styles.spread}>
              {intro}
              {list}
            </View>
          ) : (
            <>
              {intro}
              {list}
            </>
          )}
        </ScrollView>

        {spread ? null : <View style={[styles.footer, { width: pageWidth }]}>{action}</View>}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * One feature: the icon on its tile, and two lines that say it.
 *
 * Each row arrives a beat after the one above it, on the same reveal clock as
 * the rest of the page, so Reduce Motion -- which lands that clock at once --
 * lands every row with it.
 */
function FeatureRow({
  feature,
  index,
  count,
  reveal,
  tileColor,
  iconColor,
  textColor,
  mutedColor,
}: {
  feature: IntroFeature;
  index: number;
  count: number;
  reveal: SharedValue<number>;
  tileColor: string;
  iconColor: string;
  textColor: string;
  mutedColor: string;
}) {
  const start = 0.35 + (index / count) * 0.4;
  const end = Math.min(start + 0.25, 1);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.value, [start, end], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(reveal.value, [start, end], [12, 0], Extrapolation.CLAMP) },
    ],
  }));
  const Icon = feature.icon;
  return (
    <Animated.View style={[styles.feature, style]} testID={`launch-intro-feature-${feature.key}`}>
      <View style={[styles.tile, { backgroundColor: tileColor }]}>
        <Icon size={18} color={iconColor} strokeWidth={1.8} />
      </View>
      <View style={styles.featureCopy}>
        <Text variant="bodySmall" weight="semibold" color={textColor}>
          {feature.title}
        </Text>
        <Text variant="bodySmall" color={mutedColor}>
          {feature.body}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center' },
  header: {
    height: HEADER_MARK_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  markSlot: { width: HEADER_MARK_SIZE, height: HEADER_MARK_SIZE },
  skipButton: { paddingHorizontal: 4, paddingVertical: 8 },
  pressed: { opacity: 0.6 },
  scroller: { alignSelf: 'stretch' },
  scrollContent: { flexGrow: 1, paddingTop: 20, paddingBottom: 28, gap: 32 },
  spreadScrollContent: { justifyContent: 'center' },
  spread: { flexDirection: 'row', alignItems: 'center', gap: 64 },
  phoneLead: { gap: 12 },
  spreadLead: { flex: 5, gap: 16 },
  lede: { lineHeight: 24 },
  phoneList: { gap: 20 },
  spreadList: { flex: 6, gap: 22 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  tile: {
    width: FEATURE_TILE,
    height: FEATURE_TILE,
    borderRadius: appChrome.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: { flex: 1, gap: 2, paddingTop: 1 },
  footer: { paddingTop: 12, paddingBottom: 20 },
  phoneAction: { alignSelf: 'stretch' },
  spreadAction: { alignSelf: 'flex-start', minWidth: 220, marginTop: 16 },
});
