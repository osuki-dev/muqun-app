import { resolveFontStyle, Text, useThemeTokens, type ResolvedFontStyle } from '@osuki-dev/ui';
import { Search, X } from 'lucide-react-native';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  View,
  type AccessibilityProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { FieldPlaceholder } from '@/components/field-placeholder';
import { PressableScale } from '@/components/pressable-scale';
import { AGENT_TYPE } from '@/constants/agent-type';
import { appChrome } from '@/constants/appearance';
import { SheetFrame } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { KeyboardInset } from '@/components/keyboard-inset';
import { fadeIn, PRESET, timing } from '@/lib/motion';

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
  /**
   * Between the heading block and the first control -- and a row's breathing
   * room above and below. See `ROW_MIN_HEIGHT` for why a row takes the smaller
   * of the two numbers rather than `snug`.
   */
  gap: 8,
  /** The column gap across a row, and the lead over a form's first field. */
  snug: 14,
  /** The sheet's left and right margin. */
  gutter: 20,
  /** Above a group heading, and below the last row. */
  section: 24,
} as const;

/**
 * The row floor: a touch target, not a slab.
 *
 * A row is `padding + text`, and the padding used to be `snug` (14) on top of a
 * 52 floor -- which is two numbers both sized for a *one-line* row, applied to
 * a two-line one. The arithmetic, at the kit's own scale (`bodySmall` 14/21,
 * `caption` 12/16.8, `rowCopy` gap 2):
 *
 * | Row | Text | Padding | Height |
 * |---|---|---|---|
 * | one line, before | 21 | 28 | 52 (the floor won) |
 * | two lines, before | 40 | 28 | **68** |
 * | one line, now | 21 | 16 | **44** (the floor wins) |
 * | two lines, now | 40 | 16 | **56** |
 *
 * 68 dp of pitch for two lines of text is a card with air around it, which is
 * the one thing this system is not -- the owner read the workspace list as a
 * stack of cards for exactly that reason. So the floor drops to 44, which is
 * the platform touch target and the whole job of a floor, and the padding drops
 * to `gap`: a one-line row is still 44 tall and comfortable to hit, and a
 * two-line row hugs its own two lines instead of being padded out to a third.
 *
 * Both numbers are in this one file because 14 sheets draw this row.
 */
const ROW_MIN_HEIGHT = 44;

/** The row's own breathing room, above and below. See `ROW_MIN_HEIGHT`. */
const ROW_PADDING_VERTICAL = SHEET_LADDER.gap;

/**
 * The lead between a row's title and its caption.
 *
 * Deliberately below the ladder's smallest rung: the two lines are one thought
 * about one thing, and `tight` (4) between them made the caption read as a
 * second row rather than as the first one's subtitle.
 */
const ROW_COPY_GAP = 2;

/** The selection mark: a rule at the sheet's edge, not a box around the row. */
const SELECTION_RULE_WIDTH = 2;

/**
 * How wide the rule goes at the top of a confirmation swell, as a multiple.
 *
 * Three, which is six points: enough to catch the eye of somebody who has been
 * watching a progress bar a few lines below it, and small enough that the mark
 * is still a rule at its widest rather than a block sliding out of the gutter.
 */
const RULE_CONFIRM_WIDTH = 3;

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
  captionLines,
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
  /** See `SheetSceneHeading`: two only where the caption is a sentence. */
  captionLines?: number;
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
          <SheetSceneHeading
            title={title}
            caption={caption}
            captionLines={captionLines}
            trailing={headingTrailing}
          />
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
  captionLines = 1,
  trailing,
}: {
  title: string;
  caption?: string;
  /**
   * How many lines the caption may take, and one unless a sheet says so.
   *
   * A caption is normally the current value -- a model's name, a branch, a
   * pack -- and a value that wraps is a value that has grown a paragraph. The
   * exception is a sheet whose heading is a step rather than a state: pairing
   * says what to do next, in a sentence, and the sentence clipped at one line
   * ("A Gateway on a machine you can SSH into, even one that only listens on
   * its own…") is the caption failing at its only job.
   */
  captionLines?: number;
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
          <Text variant="caption" color={colors.textMuted} numberOfLines={captionLines}>
            {caption}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/**
 * The face a sheet's own fields are drawn in -- the typed value and the
 * placeholder alike.
 *
 * A `TextInput` is not a kit `Text`. It takes no variant, and it takes nothing
 * from the theme on its own: React Native reads `fontFamily` off the input's
 * own style, and that one declaration is what draws both the value and the
 * placeholder. A field that sets no family gets the platform's UI face for
 * both -- which is how every sheet in the app came to show its labels in the
 * reader's chosen font and the fields directly under them in the system's, one
 * line apart. The placeholder is where it was loudest, because a placeholder
 * is the only text on an empty field and there is nothing beside it to
 * excuse the mismatch.
 *
 * Asking `resolveFontStyle` for the `body` role is the same question the kit's
 * `Text` asks for everything from `heading` to `bodySmall`, so the field and
 * the caption above it land on one face by construction rather than by two
 * files happening to agree. `'regular'` rather than anything heavier for the
 * reason `interface-font-registry.ts` argues at length: a reader's font is one
 * file carrying one weight, and asking Android for 700 of a family that
 * registered only under `Typeface.NORMAL` falls through to a system lookup
 * that has never heard of it.
 */
function useSheetSceneFieldFont(): ResolvedFontStyle {
  const { fonts, typeStyles } = useThemeTokens();
  return resolveFontStyle(fonts, typeStyles.body.fontFamily, 'regular');
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
  clearAccessibilityLabel,
  testID,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  /**
   * What the × says. Given one, the field grows a clear button while there is
   * something to clear -- on a sheet the keyboard covers half of, selecting the
   * text and deleting it is four gestures for one intention.
   */
  clearAccessibilityLabel?: string;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  const fieldFont = useSheetSceneFieldFont();
  return (
    <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
      <Search size={16} color={colors.textSubtle} />
      <View style={styles.searchField}>
        <TextInput
          testID={testID}
          accessibilityLabel={accessibilityLabel}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          // Drawn by `FieldPlaceholder`; the hint stays for the screen reader.
          placeholderTextColor="transparent"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.searchInput, fieldFont, { color: colors.text }]}
        />
        <FieldPlaceholder
          text={placeholder}
          visible={value.length === 0}
          color={colors.textSubtle}
          style={[styles.searchPlaceholder, fieldFont]}
        />
      </View>
      {clearAccessibilityLabel && value.length > 0 ? (
        <PressableScale
          testID={testID ? `${testID}-clear` : undefined}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          hitSlop={10}
          onPress={() => onChangeText('')}
          style={styles.searchClear}>
          <X size={15} color={colors.textMuted} />
        </PressableScale>
      ) : null}
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
export function SheetSceneGroupHeading({
  title,
  first,
  meta,
  testID,
}: {
  title: string;
  first?: boolean;
  /**
   * The one fact about the group, right-aligned on the heading's own line.
   *
   * A count belongs here rather than on a divider bar of its own. The files
   * sheet used to draw `Today ──── 23` -- a rule across the whole width with a
   * number at the end of it -- which is a second kind of separator on a surface
   * that already has one, and it made a day read as a band rather than as a
   * name. The heading says what the group is; the meta says how much of it
   * there is.
   */
  meta?: ReactNode;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  return (
    <View testID={testID} style={[styles.groupHeading, first ? styles.groupHeadingFirst : null]}>
      <Text
        variant="caption"
        weight="semibold"
        color={colors.textMuted}
        numberOfLines={1}
        style={styles.groupHeadingText}>
        {title}
      </Text>
      {meta ? <View style={styles.groupHeadingMeta}>{meta}</View> : null}
    </View>
  );
}

/**
 * One quiet control on the heading's line: a glyph, and nothing around it.
 *
 * The refresh on the files, panels and changes sheets used to be a 38pt circle
 * of `GlassChrome` -- next to an X circle in the same material, which is how
 * three inspectors ended up wearing the chrome of a toolbar. A sheet has one
 * ground and no second surface, so a control on it is its glyph plus a 44pt
 * touch target, and the only thing that changes when it is working is the
 * glyph.
 */
export function SheetSceneQuietControl({
  accessibilityLabel,
  onPress,
  busy = false,
  testID,
  children,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  /** Replaces the glyph with a spinner, without taking the control away. */
  busy?: boolean;
  testID?: string;
  children: ReactNode;
}) {
  const { colors } = useThemeTokens();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy }}
      onPress={onPress}
      style={styles.quietControl}>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : children}
    </PressableScale>
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
  captionKind = 'text',
  meta,
  selected = false,
  disabled = false,
  disabledCaption,
  busy = false,
  leading,
  trailing,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityValue,
  testID,
  selectedTestID,
  crossfadeTitle = false,
  confirmKey,
  style,
}: {
  title: string;
  /**
   * The second line, and a node rather than a string where one run of it is
   * coloured -- the panels sheet puts an agent's status word in front of its
   * path, in the status colour, on the caption's own line.
   */
  caption?: ReactNode;
  /**
   * What kind of thing the caption is, and therefore which end of it to keep.
   *
   * Prose wraps to two lines and clips at the end, because the start of a
   * sentence is the part that says what it is about. A filesystem path is the
   * other way round: `/Users/ryu/Work/muqun/app-worktrees/opencode-c3` and
   * `/Users/ryu/Work/muqun/app-worktrees/opencode-b2` differ only in the run
   * that a tail clip throws away, and two rows reading
   * `/Users/ryu/Work/muqun/app-worktre…` are two rows the reader cannot tell
   * apart. So a path keeps its tail, loses its head, and stays on one line --
   * wrapping a path to two lines breaks it at no meaningful boundary and
   * doubles the row for a string the reader scans rather than reads.
   *
   * A prop on the row rather than a `numberOfLines`/`ellipsizeMode` pair at
   * every call site: which end of a path matters is a fact about paths, and
   * five sheets list them.
   */
  captionKind?: 'text' | 'path';
  /** Right-aligned in the row: a time, a token count, a diff stat. */
  meta?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** Why it is disabled, in the host's vocabulary: "Set up on the host". */
  disabledCaption?: string;
  /**
   * Work is happening on this row: a download, an install.
   *
   * Only reaches `accessibilityState`, because the drawing of it belongs to
   * whatever the row is doing -- a progress bar in `trailing`, a step name in
   * `meta`. What a screen reader cannot pick up from either of those is that
   * the row is *mid-something*, which is the one thing `busy` says.
   */
  busy?: boolean;
  leading?: ReactNode;
  /** Under the row, and only when it is the selected one: variant chips. */
  trailing?: ReactNode;
  onPress?: () => void;
  /**
   * The row's own actions, where a row has any: rename and close on the panels
   * sheet. A long press rather than a swipe or a trailing button, because it is
   * the gesture every other list in this app already answers to.
   */
  onLongPress?: () => void;
  accessibilityLabel?: string;
  /**
   * What the row is doing, for a reader who cannot see it doing it.
   *
   * The row's label replaces everything inside it, so a caption or a trailing
   * run that changes -- an install's step, a count -- is drawn and never said.
   * A value is the one slot a screen reader announces *after* the label
   * without the caller having to build a sentence out of two translated
   * strings, so that is where a row's live state goes.
   */
  accessibilityValue?: AccessibilityProps['accessibilityValue'];
  testID?: string;
  /**
   * An id that exists only while this row is the current one.
   *
   * The rule is drawn whether or not it is lit, so a flow cannot ask "is it
   * visible" of the mark itself. A node that appears with the selection can be
   * waited on, which is what the language flow has always done.
   */
  selectedTestID?: string;
  /**
   * Whether a change of title is a change the reader made.
   *
   * Off by default: a row whose title changes because the list was refiltered
   * has not renamed anything, and animating that is noise. On for the rows that
   * can actually be renamed, where the new name fades in where the old one was
   * rather than replacing it between two frames -- the same beat the strip's
   * chips use when an auto-title lands.
   */
  crossfadeTitle?: boolean;
  /**
   * A value that changes when the thing this row names has just been settled.
   *
   * The selection rule is already lit -- the row was the current one before and
   * is the current one after -- so the arrival of, say, a font the reader has
   * spent fifteen seconds waiting for lands on a row that looks exactly as it
   * did. This is the beat that says it happened: the rule swells and comes
   * back, once, at the moment the title cross-fades to the new name.
   *
   * A key rather than a boolean because it is an event, not a state; the row
   * flashes when the value changes and does nothing on the first render, so a
   * sheet that opens on an already-installed font does not congratulate the
   * reader for something they did last week.
   */
  confirmKey?: string | number;
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

  /**
   * The confirmation swell, kept apart from `rule` so the two cannot fight.
   *
   * `rule` answers selection and is where the mark lives the rest of the time;
   * this one is a single out-and-back on top of it. It stays at nought except
   * for the beat after `confirmKey` changes, so an unselected row can flash
   * too (`opacity` takes whichever is higher) without the flash leaving the
   * mark lit afterwards.
   */
  const confirm = useSharedValue(0);
  const confirmSeen = useRef(confirmKey);
  useEffect(() => {
    if (confirmKey === undefined || confirmKey === confirmSeen.current) return;
    confirmSeen.current = confirmKey;
    confirm.value = withSequence(withTiming(1, timing('short')), withTiming(0, timing('long')));
  }, [confirm, confirmKey]);

  const ruleStyle = useAnimatedStyle(() => ({
    opacity: Math.max(rule.value, confirm.value),
    // Sideways from its own centre line, and never a change of length: the
    // rule already spans the row's full height, so a swell along it would be
    // the row appearing to grow. Widening is a mark that thickens and settles.
    transform: [{ scaleX: 1 + confirm.value * (RULE_CONFIRM_WIDTH - 1) }],
  }));

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
        accessibilityState={{ selected, disabled, busy }}
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityValue={accessibilityValue}
        disabled={disabled || !(onPress || onLongPress)}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={onLongPress ? 280 : undefined}
        style={styles.row}>
        {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
        <View style={styles.rowCopy}>
          {/* Keyed on the title, so a rename fades in where the old name was.
              Written as two branches rather than one spread: `key` is React's
              own, and spreading an object that carries it is a warning. */}
          {crossfadeTitle ? (
            <Animated.View key={title} entering={fadeIn('short')}>
              <Text
                variant="bodySmall"
                weight={selected ? 'semibold' : 'regular'}
                color={titleColor}
                numberOfLines={1}
                style={styles.rowTitle}>
                {title}
              </Text>
            </Animated.View>
          ) : (
            <Text
              variant="bodySmall"
              weight={selected ? 'semibold' : 'regular'}
              color={titleColor}
              numberOfLines={1}
              style={styles.rowTitle}>
              {title}
            </Text>
          )}
          {caption ? (
            <Text
              variant="caption"
              color={colors.textMuted}
              numberOfLines={captionKind === 'path' ? 1 : 2}
              ellipsizeMode={captionKind === 'path' ? 'head' : undefined}>
              {caption}
            </Text>
          ) : null}
        </View>
        {disabled && disabledCaption ? (
          /* Its own style, not `rowMeta`.
             `disabledCaption` is a free-form string the gateway hands over --
             a model's status, say -- so unlike the fixed, short things `meta`
             carries it cannot be trusted to stay narrow. Borrowing `meta`'s
             rigidity meant the row's title was the only thing left that could
             give. */
          <Text
            variant="caption"
            color={colors.textSubtle}
            numberOfLines={2}
            style={styles.rowDisabledMeta}>
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

/**
 * The text style a flush field's own `TextInput` takes.
 *
 * The family comes from `useSheetSceneFieldFont`, which is most of the point
 * of this hook existing: a dozen sheets pass whatever it returns straight into
 * a `TextInput`, so the difference between the reader's font reaching those
 * fields and not reaching them is this one line.
 *
 * It is the interface face, because what a flush field usually holds is
 * prose -- a session name, a worktree name, a port. The handful that hold
 * something the reader types character for character (a path, a git ref, a
 * URL) layer `useMonoFontFamily()` over this at the call site; the literal is
 * theirs to know about, not this hook's.
 */
export function useSheetSceneInputStyle(): StyleProp<TextStyle> {
  const { colors } = useThemeTokens();
  const fieldFont = useSheetSceneFieldFont();
  return [styles.fieldInput, fieldFont, { color: colors.text }];
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
  searchClear: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchField: {
    flex: 1,
    justifyContent: 'center',
  },
  searchPlaceholder: {
    fontSize: AGENT_TYPE.prose.size,
  },
  searchInput: {
    // A `TextInput` is not a kit `Text` and cannot take a variant, so the one
    // number it needs comes from the type scale rather than from this file: a
    // field holds what the reader wrote, which is what `prose` sizes. It was a
    // literal 15 here and another in `fieldInput`, which is two sizes on one
    // sheet and neither of them on the scale.
    fontSize: AGENT_TYPE.prose.size,
    padding: 0,
    includeFontPadding: false,
  },
  // Still `section` above and `gap` below, unchanged by the tighter row: the
  // heading's own margins are measured from the row's *edge*, and a row that
  // lost 6 dp of padding at each end gives back 32 dp above a heading instead
  // of 38 and 16 below instead of 22. The heading stays nearer the group it
  // names than the group it follows, which is the only thing these two numbers
  // are for.
  groupHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    marginTop: SHEET_LADDER.section,
    marginBottom: SHEET_LADDER.gap,
  },
  groupHeadingFirst: { marginTop: SHEET_LADDER.gap },
  groupHeadingText: { flexShrink: 1, includeFontPadding: false },
  groupHeadingMeta: { flexShrink: 0, marginLeft: 'auto' },
  quietControl: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowWrap: { position: 'relative' },
  rule: {
    position: 'absolute',
    // Out to the sheet's own edge, not the gutter: the mark belongs to the
    // sheet, the text belongs to the column.
    left: -SHEET_LADDER.gutter,
    top: 0,
    bottom: 0,
    width: SELECTION_RULE_WIDTH,
    // The confirmation swell grows from the sheet's edge inwards rather than
    // from the rule's own centre: the scroller clips at exactly this left
    // edge, so a centred swell would lose its outer half and land narrower
    // and lopsided.
    transformOrigin: 'left center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.snug,
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: ROW_PADDING_VERTICAL,
  },
  rowLeading: { alignItems: 'center', justifyContent: 'center' },
  // Shrink-to-fit rather than `flex: 1`, so the plate hugs the two lines
  // instead of becoming a full-width slab -- which is the card again.
  rowCopy: { flexShrink: 1, minWidth: 0, gap: ROW_COPY_GAP },
  rowTitle: { includeFontPadding: false },
  /**
   * Rigid on purpose, and correct for what it holds.
   *
   * `meta` is a time, a token count, a diff stat: short, bounded, and written
   * by this app. It should not be squeezed by a long title.
   */
  rowMeta: { flexShrink: 0, marginLeft: 'auto' },
  /**
   * The disabled caption is the opposite case and needs the opposite rule.
   *
   * It is whatever the gateway says -- a model's status, for one -- so its
   * width is not ours to predict. Held rigid, it took as much of the row as
   * it liked and `rowCopy` beside it, the only other thing that can shrink,
   * gave up the row's title: in a wide face the model names in the model
   * sheet came down to a few characters each, in the one list a reader opens
   * to tell models apart. It shrinks and wraps to two lines now, which is the
   * same bargain the settings rows struck -- a floor for the title, and the
   * value spending what is left.
   */
  rowDisabledMeta: { flexShrink: 1, minWidth: 0, marginLeft: 'auto', textAlign: 'right' },
  groupRule: { height: StyleSheet.hairlineWidth, marginTop: SHEET_LADDER.gap },
  field: { paddingTop: SHEET_LADDER.snug, gap: SHEET_LADDER.tight },
  fieldValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // The search field's face, for the same reason. No `lineHeight`: Android
  // clips a single-line input to it and the descenders go with it.
  fieldInput: { flex: 1, fontSize: AGENT_TYPE.prose.size, padding: 0, includeFontPadding: false },
  /**
   * No `lineHeight` here either, for the reason the field above it already
   * gives: 16 is the scale's own 12x1.4 rounded down, and an explicit line
   * box clips a taller face. This is the line that tells the reader what went
   * wrong with what they just typed, and it wraps -- so it is the last place
   * that should be losing its accents.
   */
  fieldNote: {},
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
