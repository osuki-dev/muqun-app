import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Search } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { SheetFrame } from '@/components/sheet-ground';
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
  headingTrailing,
  header,
  contentSized = false,
  children,
}: {
  testID?: string;
  /** Says the action: "Choose a model", "Switch workspace", "Changes". */
  title: string;
  /** The current value, live -- never a hint. */
  caption?: string;
  /** One quiet control on the title's line. See `SheetSceneHeading`. */
  headingTrailing?: ReactNode;
  /** Search, segmented control: anything pinned above the scroller. */
  header?: ReactNode;
  /**
   * Whether the sheet is sized to what it holds rather than to a detent.
   *
   * A `fitToContents` sheet has no height to hand down, so a column that asked
   * for `flex: 1` inside it measured zero and the sheet arrived as an empty
   * strip. Content-sized scenes size themselves instead.
   */
  contentSized?: boolean;
  children: ReactNode;
}) {
  return (
    <SheetFrame testID={testID} tint="surface" frosted>
      <View collapsable={false} style={contentSized ? undefined : styles.scene}>
        <View style={styles.fixedTop}>
          <SheetHandle />
          <SheetSceneHeading title={title} caption={caption} trailing={headingTrailing} />
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
export function SheetSceneHeading({
  title,
  caption,
  trailing,
}: {
  title: string;
  caption?: string;
  /**
   * One quiet control on the title's line -- the commands sheet's edit toggle.
   * Not a close: the grabber and the swipe are the close. Anything that lands
   * here is `textMuted` until it is on, and `primary` when it is.
   */
  trailing?: ReactNode;
}) {
  const { colors } = useThemeTokens();
  return (
    <View style={styles.heading}>
      <View style={styles.headingCopy}>
        <Text variant="subheading" style={styles.headingTitle}>
          {title}
        </Text>
        {caption ? (
          <Text variant="caption" color={colors.textMuted} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {trailing}
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
  return (
    <View style={[styles.groupHeading, first ? styles.groupHeadingFirst : null]}>
      <Text
        variant="caption"
        weight="semibold"
        color={colors.textMuted}
        style={styles.groupHeadingText}>
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
  selectedTestID,
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
  /**
   * An id that exists only while this row is the current one.
   *
   * The rule is drawn whether or not it is lit, so a flow cannot ask "is it
   * visible" of the mark itself. A node that appears with the selection can be
   * waited on, which is what the language flow has always done.
   */
  selectedTestID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useThemeTokens();
  // No plate on any of this. A row is plain text on the ground, because the
  // ground is frosted (`SHEET_FROST_ALPHA`) and the wallpaper is texture under
  // it rather than a photograph behind it. Plating each run instead turned the
  // sheet into a scatter of stickers -- busier than the cards it replaced.
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
        testID={selected ? selectedTestID : undefined}
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
        <View style={styles.rowCopy}>
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
          <Text variant="caption" color={colors.textSubtle} style={styles.rowMeta}>
            {disabledCaption}
          </Text>
        ) : meta ? (
          <View style={styles.rowMeta}>{meta}</View>
        ) : null}
      </PressableScale>
      {trailing}
    </View>
  );
}

/**
 * One field on a sheet, and the whole of what a form is made of here.
 *
 * The same treatment as the search field: flush with the ground under one
 * hairline, with its label above it as a caption. A boxed input on a sheet is
 * the card again -- and a form is not a different visual system from a picker,
 * it is the same ground with fields on it instead of rows.
 *
 * Uncontrolled in the sense that matters: this owns no state. The screen keeps
 * the value, because the screen is what validates and submits it.
 */
export function SheetSceneField({
  label,
  hint,
  error,
  children,
}: {
  /** Sentence case, `textMuted`, above the value. Never a placeholder-only field. */
  label: string;
  /** What the value is for, when the label cannot say it in three words. */
  hint?: string;
  /** Why the value is not accepted. Replaces the hint while it is there. */
  error?: string;
  /** The input itself: a `TextInput`, a row of chips, a toggle. */
  children: ReactNode;
}) {
  const { colors } = useThemeTokens();
  return (
    <View style={styles.field}>
      <Text variant="caption" color={colors.textMuted}>
        {label}
      </Text>
      <View style={[styles.fieldValue, { borderBottomColor: colors.border }]}>{children}</View>
      {error ? (
        <Text variant="caption" color={colors.danger} style={styles.fieldNote}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color={colors.textSubtle} style={styles.fieldNote}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** The text style a flush field's own `TextInput` takes. */
export function useSheetSceneInputStyle(): StyleProp<TextStyle> {
  const { colors } = useThemeTokens();
  return [styles.fieldInput, { color: colors.text }];
}

/**
 * The one thing a form sheet is for, at the bottom, full width.
 *
 * One primary action and no more: a sheet that offers two equal buttons is a
 * sheet that has not decided what it is for. Anything else on it is
 * `SheetSceneQuietAction`, which is a line of text and not a second button.
 */
export function SheetSceneAction({
  label,
  onPress,
  disabled = false,
  busy = false,
  leading,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  leading?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.action,
        { backgroundColor: colors.primary },
        disabled && !busy ? { opacity: appChrome.opacity.disabled } : null,
      ]}>
      {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : leading}
      <Text variant="bodySmall" weight="bold" color={colors.onPrimary}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** A secondary action: a line of text under the primary one, never a button. */
export function SheetSceneQuietAction({
  label,
  onPress,
  tone = 'muted',
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  /** `danger` for the one that throws something away. */
  tone?: 'muted' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={styles.quietAction}>
      <Text
        variant="caption"
        weight="semibold"
        color={tone === 'danger' ? colors.danger : colors.textMuted}>
        {label}
      </Text>
    </PressableScale>
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
  heading: {
    marginTop: SHEET_LADDER.tight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.snug,
  },
  headingCopy: { flex: 1, minWidth: 0, gap: SHEET_LADDER.tight },
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
  field: { paddingTop: SHEET_LADDER.snug, gap: SHEET_LADDER.tight },
  fieldValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldInput: { flex: 1, fontSize: 15, padding: 0, includeFontPadding: false },
  fieldNote: { lineHeight: 16 },
  action: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SHEET_LADDER.gap,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    marginTop: SHEET_LADDER.snug,
  },
  quietAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
