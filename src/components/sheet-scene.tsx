import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Search } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { KeyboardInset } from '@/components/keyboard-inset';
import { PRESET, timing } from '@/lib/motion';

/**
 * The furniture every bottom sheet in Muqun is built from.
 *
 * A sheet here is a quick picker or an inspector sliding over live content -- a
 * terminal, an agent timeline, the home list -- usually over an image-backed
 * theme pack. What it was, before this module, was the SaaS card kit: a boxed
 * header card with an X circle, a boxed search field, a boxed segmented
 * control, a boxed list with radio circles, five radii on one screen. Cards
 * inside a card fight the artwork instead of sitting on it.
 *
 * So: one frosted ground plate and nothing boxed on it. The only rounded things
 * inside a sheet are controls -- the segmented pill, the variant chips -- and
 * the only emphasis is the left selection rule, which is the same mark the
 * agent timeline uses for the reader's own messages. No radios, no checkmarks,
 * no second surface.
 *
 * `sheet-design.md` is the spec; this file is the only place it is spelled out
 * in numbers, so a sheet cannot drift from it row by row.
 */

/**
 * The sheet's own spacing vocabulary. Wider than the settings page's `LADDER`
 * because a sheet has one column and no cards to inset from: the gutter is the
 * terminal composer's, so a sheet opened over the composer keeps the same left
 * edge.
 */
export const SHEET_LADDER = {
  /** The lead between a title and its caption, and inside a row's stack. */
  tight: 4,
  /** Between the heading block and the first control. */
  gap: 8,
  /** A row's breathing room above and below. */
  snug: 14,
  /** The sheet's left and right margin. */
  gutter: 20,
  /** Above a group heading, and below the last row. */
  section: 24,
} as const;

/** Two lines of body/caption with the ladder's padding: the row floor. */
const ROW_MIN_HEIGHT = 52;

/** The selection mark: a rule at the sheet's edge, not a box around the row. */
const SELECTION_RULE_WIDTH = 2;

/**
 * The scene: the ground, the grabber, the heading, and one column of content.
 *
 * Exactly two subviews inside the frame, which is the most a native form sheet
 * lays out around a scroll view -- the ground is one of them and costs no
 * layout, so the scroller is still the only thing the sheet measures. See
 * `sheet-ground.tsx`.
 */
export function SheetScene({
  testID,
  title,
  caption,
  header,
  children,
}: {
  testID?: string;
  /** Says the action: "Choose a model", "Switch workspace", "Changes". */
  title: string;
  /** The current value, live -- never a hint. */
  caption?: string;
  /** Search, segmented control: anything pinned above the scroller. */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SheetFrame testID={testID} tint="surface">
      <View collapsable={false} style={styles.scene}>
        <View style={styles.fixedTop}>
          <SheetHandle />
          <SheetSceneHeading title={title} caption={caption} />
          {header}
        </View>
        {children}
      </View>
    </SheetFrame>
  );
}

/**
 * The title and the current value under it.
 *
 * No X circle: on a form sheet the grabber and the swipe are the close, and a
 * button that repeats a gesture the platform already gives is chrome. The X
 * survives only in fullscreen frames, where there is no grabber -- which is
 * why `SheetHandle` and this heading are a pair.
 */
export function SheetSceneHeading({ title, caption }: { title: string; caption?: string }) {
  const { colors } = useThemeTokens();
  const plate = useSheetGroundPlate();
  return (
    <View style={styles.heading}>
      <View style={[styles.headingCopy, plate]}>
        <Text variant="subheading" style={styles.headingTitle}>
          {title}
        </Text>
        {caption ? (
          <Text variant="caption" color={colors.textMuted} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The search field: flush with the ground, one hairline under it.
 *
 * A boxed field on a sheet is a card inside a card. The underline is the whole
 * affordance, which is enough because a field with a glyph and a placeholder on
 * an otherwise empty line is unambiguous.
 */
export function SheetSceneSearch({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  testID,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  return (
    <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
      <Search size={16} color={colors.textSubtle} />
      <TextInput
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.searchInput, { color: colors.text }]}
      />
    </View>
  );
}

/**
 * A group's name, in sentence case.
 *
 * `caption`, not the kit's `label`: `label` carries `textTransform:
 * 'uppercase'`, and an all-caps group heading is a sign rather than a name --
 * it also makes a provider like "OpenCode" unreadable as itself.
 */
export function SheetSceneGroupHeading({ title, first }: { title: string; first?: boolean }) {
  const { colors } = useThemeTokens();
  const plate = useSheetGroundPlate();
  return (
    <View style={[styles.groupHeading, first ? styles.groupHeadingFirst : null]}>
      <Text
        variant="caption"
        weight="semibold"
        color={colors.textMuted}
        style={[styles.groupHeadingText, plate]}>
        {title}
      </Text>
    </View>
  );
}

/**
 * One row, and the left rule that marks it as current.
 *
 * The rule rather than a radio or a tick: a radio asks the reader to read a
 * control, and the answer to "which one is this" should be readable from the
 * shape of the column alone. It is also the mark the agent timeline puts beside
 * the reader's own messages, so one device means "this is yours / this is
 * current" everywhere in the app.
 *
 * Out then in, never both at once: when selection moves, the rule that is
 * leaving fades on the shorter preset and the arriving one starts only once it
 * has gone -- the pair `workspace-title-switcher.tsx` established.
 */
export function SheetSceneRow({
  title,
  caption,
  meta,
  selected = false,
  disabled = false,
  disabledCaption,
  leading,
  trailing,
  onPress,
  accessibilityLabel,
  testID,
  style,
}: {
  title: string;
  caption?: string;
  /** Right-aligned in the row: a time, a token count, a diff stat. */
  meta?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** Why it is disabled, in the host's vocabulary: "Set up on the host". */
  disabledCaption?: string;
  leading?: ReactNode;
  /** Under the row, and only when it is the selected one: variant chips. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useThemeTokens();
  // The same plate the heading takes, for the same reason: `text` and
  // `textMuted` are proven against the theme's surfaces and never against an
  // author's photograph. One per row and shrink-to-fit, so it reads as
  // protected text rather than as the card this system exists to remove. Empty
  // on a pack with no `shell.background`, which is every built-in one.
  const plate = useSheetGroundPlate();
  const rule = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    if (selected) {
      rule.value = withDelay(PRESET.dropdown, withTiming(1, timing('short')));
    } else {
      rule.value = withTiming(0, timing('dropdown'));
    }
  }, [selected, rule]);

  const ruleStyle = useAnimatedStyle(() => ({ opacity: rule.value }));

  const titleColor = disabled ? colors.textSubtle : selected ? colors.primary : colors.text;

  return (
    <View style={[styles.rowWrap, style]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.rule, { backgroundColor: colors.primary }, ruleStyle]}
      />
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={accessibilityLabel ?? title}
        disabled={disabled || !onPress}
        onPress={onPress}
        style={styles.row}>
        {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
        <View style={[styles.rowCopy, plate]}>
          <Text
            variant="bodySmall"
            weight={selected ? 'semibold' : 'regular'}
            color={titleColor}
            numberOfLines={1}
            style={styles.rowTitle}>
            {title}
          </Text>
          {caption ? (
            <Text variant="caption" color={colors.textMuted} numberOfLines={2}>
              {caption}
            </Text>
          ) : null}
        </View>
        {disabled && disabledCaption ? (
          <Text variant="caption" color={colors.textSubtle} style={[styles.rowMeta, plate]}>
            {disabledCaption}
          </Text>
        ) : meta ? (
          // Plated too: a time or a token count on the right of the row is text
          // on the wallpaper exactly as much as the title is.
          <View style={[styles.rowMeta, plate]}>{meta}</View>
        ) : null}
      </PressableScale>
      {trailing}
    </View>
  );
}

/** The hairline between one group and the next, and nowhere else. */
export function SheetSceneGroupRule() {
  const { colors } = useThemeTokens();
  return <View style={[styles.groupRule, { backgroundColor: colors.border }]} />;
}

/**
 * The end of a scroller's content: the sheet's own bottom room plus whatever
 * the keyboard is standing on, so the last row is always reachable.
 */
export function SheetSceneFooter({ bottomInset = 0 }: { bottomInset?: number }) {
  return (
    <>
      <View style={{ height: SHEET_LADDER.section + bottomInset }} />
      <KeyboardInset />
    </>
  );
}

export const sheetSceneStyles = StyleSheet.create({
  /** For a scroller that fills the sheet under the pinned heading. */
  scroller: { flex: 1, minHeight: 0, overflow: 'hidden' },
  /** For that scroller's content container: the gutter, and nothing else. */
  scrollerContent: { paddingHorizontal: SHEET_LADDER.gutter },
  /** For a sheet with no scroller of its own, sized to what it holds. */
  column: { paddingHorizontal: SHEET_LADDER.gutter, gap: SHEET_LADDER.gap },
});

const styles = StyleSheet.create({
  // The stack renders form sheets over a transparent background so the native
  // sheet keeps its own corners; without filling the height, that transparency
  // shows as a strip under the content.
  scene: { flex: 1 },
  fixedTop: {
    flexShrink: 0,
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingTop: SHEET_LADDER.gap,
    paddingBottom: SHEET_LADDER.gap,
    gap: SHEET_LADDER.gap,
  },
  heading: { marginTop: SHEET_LADDER.tight },
  headingCopy: { gap: SHEET_LADDER.tight, alignSelf: 'flex-start', maxWidth: '100%' },
  headingTitle: { includeFontPadding: false },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    paddingBottom: SHEET_LADDER.gap,
    marginTop: SHEET_LADDER.gap,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
    includeFontPadding: false,
  },
  groupHeading: {
    marginTop: SHEET_LADDER.section,
    marginBottom: SHEET_LADDER.gap,
  },
  groupHeadingFirst: { marginTop: SHEET_LADDER.gap },
  groupHeadingText: { alignSelf: 'flex-start', includeFontPadding: false },
  rowWrap: { position: 'relative' },
  rule: {
    position: 'absolute',
    // Out to the sheet's own edge, not the gutter: the mark belongs to the
    // sheet, the text belongs to the column.
    left: -SHEET_LADDER.gutter,
    top: 0,
    bottom: 0,
    width: SELECTION_RULE_WIDTH,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.snug,
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: SHEET_LADDER.snug,
  },
  rowLeading: { alignItems: 'center', justifyContent: 'center' },
  // Shrink-to-fit rather than `flex: 1`, so the plate hugs the two lines
  // instead of becoming a full-width slab -- which is the card again.
  rowCopy: { flexShrink: 1, minWidth: 0, gap: 2 },
  rowTitle: { includeFontPadding: false },
  rowMeta: { flexShrink: 0, marginLeft: 'auto' },
  groupRule: { height: StyleSheet.hairlineWidth, marginTop: SHEET_LADDER.gap },
});
