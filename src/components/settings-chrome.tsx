import { useSurfaceBackground } from '@/hooks/use-surface-background';
/**
 * The settings page's furniture: the section surface, the five kinds of row that
 * go in it, and the one spacing ladder they all measure from.
 *
 * Before card #678 every one of these was an anonymous `View` with its own
 * numbers, and the numbers disagreed: a toggle row was inset 14 on the left and
 * 8 on the right, a navigation row 12 on both, a control block 14, and the
 * servers list 14 again but with its hairlines drawn at a different width. So
 * no two labels in a column started at the same x, and the page read as several
 * lists stacked rather than one. Everything here measures from `LADDER`, which
 * is the design system's `spacing` scale and nothing else.
 *
 * There is deliberately no entrance animation on any of it. The page arrives on
 * the navigator's push, and a section that rises *again* underneath a slide is
 * two transitions telling the same story. Motion on this screen is spent only
 * where a state changes under the finger.
 */
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { StyleSheet, type TextStyle, View } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { Toggle } from '@/components/toggle';
import { ThemedSurface } from '@/components/themed-surface';
import { useSheetGroundPlate } from '@/components/sheet-ground';
import { useRenderTally } from '@/lib/render-tally';

/**
 * The page's whole spacing vocabulary: the design system's four-point grid, and
 * nothing off it.
 *
 * Five numbers, named rather than inlined, because the point of the exercise is
 * that a reader can see there are five and not thirteen. The page it replaces
 * used 3, 5, 6, 7, 10, 12, 13, 14, 18 and 24 -- ten values across three ranges
 * that each meant "a bit of room", chosen row by row as the sections landed.
 *
 * Stated as literals because these styles are built at module scope, where the
 * theme hook cannot be read. `gutter`, `section` and `gap` are `spacing.md`,
 * `spacing.lg` and `spacing.sm` from `@osuki-dev/ui`; `snug` and `tight` are the
 * two grid steps below them.
 */
export const LADDER = {
  /** Optical only: the section label's indent, the lead between two lines. */
  tight: 4,
  /** Between a section's label and its card; inside a row's own stack. */
  gap: 8,
  /** A row's breathing room above and below, and beside its glyph. */
  snug: 12,
  /** The page's left and right margin, and the row inset inside a card. */
  gutter: 16,
  /** Between one section and the next. */
  section: 24,
} as const;

/** Tall enough for two lines of 14/12 with the ladder's padding above and below. */
const ROW_MIN_HEIGHT = 60;

/**
 * The rounded square behind a navigation row's glyph.
 *
 * 36, the same disc the home card gives its `...` button, so the two screens
 * agree on how big a row's affordance is.
 */
const CHIP_SIZE = 36;

/**
 * The share of a choice row the label column keeps, whatever the value says.
 *
 * A choice row is a label, an optional caption under it, and the current answer
 * at the end. The answer's width is the *font's* business -- it is a theme's
 * name or a family name the reader installed -- and without a floor the label
 * column is whatever is left, which on a wide face is nothing: measured on the
 * reader's own italic font, `rowCopy` was driven to zero and "Terminal colours
 * follow the theme" wrapped one word per line down four rows while "Lanterns in
 * the Overworld" sat beside it at full width.
 *
 * The arithmetic is why it collapses rather than sharing: `flex: 1` is a
 * flex-basis of zero, and Yoga distributes shrink in proportion to basis, so a
 * column with basis zero shrinks by zero and the value takes everything. A
 * percentage floor is the one thing that survives that, because a minimum is
 * clamped after the distribution rather than weighted inside it.
 *
 * 55%, not half: the label is the question and the value is the answer, and a
 * question that cannot be read is worse than an answer that ellipsizes -- the
 * answer is one tap from being shown in full.
 */
const CHOICE_LABEL_FLOOR = '55%';

/**
 * The instrument label that names a group of rows -- the one this app draws
 * over every section it has, on every screen.
 *
 * The look is the hugging plate `SettingsSection` invented: a compact pill
 * exactly as wide as the word inside it, never a bar across the content. That
 * was the settings page's private style, and the price of keeping it private
 * was eight other headings that each re-decided what a heading is -- a
 * `caption` here, a `label` there, a `toUpperCase()` call in JavaScript on the
 * artifacts screen, and the panels sheet's tab headings stretched across the
 * whole sheet by a `flex: 1` on the text itself. The last of those is what a
 * reader sees as a full-width plate under a heading where every other section
 * on the same screen gets a small one.
 *
 * `variant="label"` -- the design system's 11pt all-caps instrument style --
 * rather than a caption with `title.toUpperCase()` applied in JavaScript, which
 * is the mistake `i18n/labels.ts` is written to prevent: case is a language's
 * business, `toUpperCase()` on Japanese does nothing and on some scripts does
 * something wrong. `textTransform` is a rendering instruction the platform
 * applies per script, and it costs no catalog churn.
 *
 * The plate comes from `useSheetGroundPlate`, which is where every plate in the
 * app now comes from, and it is drawn only when a pack supplies
 * `shell.background`. On a flat ground the label is read against the ground
 * either way and a plate there is a box nobody asked for; over an author's
 * photograph it is the only thing keeping an 11pt muted label legible.
 *
 * The colour is the *ground's*, read from the frame rather than hardcoded. This
 * label used to mix its plate from `colors.background` wherever it was drawn,
 * which is right on the settings page and wrong on a sheet tinted from
 * `surface`: measured, a rgb(242,244,245) plate on a rgb(249,251,252) ground,
 * a plate announcing itself instead of protecting a label.
 *
 * `alignSelf: 'flex-start'` is what makes it hug, and it is right for the
 * column a section normally lives in. A heading that is a *row* -- a label with
 * a count or an action opposite it -- passes `style` to put the pill back on
 * the row's centre line. The pill itself does not change.
 *
 * `bleed` is why the word does not move when a pack is installed. The plate
 * sets `paddingHorizontal` to 8 where the bare label has 4, which used to push
 * every heading in the app 4pt right of the card it names the moment a
 * wallpaper appeared. The plate keeps its padding and gives back the
 * difference as a negative margin, so the *text* starts where it always did and
 * the plate grows outward around it.
 *
 * Where this is deliberately *not* used: a heading that already sits inside
 * something painted -- the file-mention popover's "Files in this workspace",
 * the pairing aperture's SSH-host label -- because a plate on a panel that
 * carries its own fill is the second layer of paint this component exists to
 * avoid. Those two are also sentences rather than instrument labels, and an
 * uppercased sentence is a different thing to read.
 */
export function SectionLabel({
  title,
  color,
  numberOfLines,
  testID,
  style,
}: {
  title: ReactNode;
  /** Defaults to the design system's own label ink. */
  color?: string;
  numberOfLines?: number;
  testID?: string;
  /** Applied last, so a row-shaped heading can re-align the pill it hugs with. */
  style?: TextStyle | TextStyle[];
}) {
  const plate = useSheetGroundPlate();
  /**
   * The label's text starts where the card's row text starts.
   *
   * It used to start at the card's outer edge, so "Servers" sat twelve points
   * to the left of the `osk` row it names -- two left edges on a page whose
   * whole argument is that there is one. The card insets its rows by
   * `LADDER.gutter`, so the label is pushed in by the same amount, less
   * whatever horizontal padding it is already carrying.
   *
   * Computed from the plate rather than branched on it, which is what keeps
   * the bleed working: with a plate the padding is the plate's, without one it
   * is the bare label's, and the glyphs land on the same x either way -- so a
   * plate appearing does not move the text it is protecting.
   */
  const indent = LADDER.gutter - (plate.paddingHorizontal ?? LADDER.tight);
  /*
   * This label used to carry its own trailing slack here -- an extra
   * `paddingRight` of 0.3em, added when a reader's italic face made this
   * heading read APPEARANC. It is gone, and it is worth saying why rather than
   * just deleting it, because it is the fix everybody reaches for first.
   *
   * It never worked. `TextView` clips its drawing to `width -
   * compoundPaddingRight`, and Yoga has already added that same padding to the
   * width, so the clip lands on the advance edge whatever the padding is.
   * Measured on the device against a 0, an 8 and a 24 point right padding: the
   * ink stopped at the identical pixel in all three. What the padding did do
   * was make the plate lopsided, which is what it was really being judged on.
   *
   * The clip is fixed where it can be, in `components/text.tsx`, by making the
   * line itself longer than the glyphs. The plate is symmetrical again.
   */
  return (
    <Text
      variant="label"
      color={color}
      numberOfLines={numberOfLines}
      testID={testID}
      style={[
        styles.sectionTitle,
        // Android letter tracking clips Thai combining clusters in compact labels.
        typeof title === 'string' && /[\u0e00-\u0e7f]/u.test(title) ? { letterSpacing: 0 } : {},
        plate,
        {
          marginLeft: indent,
          // The right side only ever bleeds, and only when a plate is there.
          marginRight:
            plate.paddingHorizontal === undefined ? 0 : LADDER.tight - plate.paddingHorizontal,
        },
        // Spread rather than nested, because the kit's `Text` takes a flat
        // `TextStyle[]` and nothing narrower.
        ...(style ? (Array.isArray(style) ? style : [style]) : []),
      ]}>
      {title}
    </Text>
  );
}

/**
 * One group of rows, with its instrument label above it.
 */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  useRenderTally('SettingsSection');
  return (
    <View style={styles.section}>
      <SectionLabel title={title} style={styles.settingsSectionTitle} />
      <SettingsCard>{children}</SettingsCard>
    </View>
  );
}

/**
 * The grouped surface itself, without the instrument label above it.
 *
 * Lifted out of `SettingsSection` by card #683, which needed the same rounded
 * surface block inside a sheet, where the sheet's own title is
 * already saying what the list is and a second heading over it would be the
 * same word twice. A section is this card plus its label; nothing about the
 * card is re-decided in the sheet.
 */
export function SettingsCard({
  children,
  flush = false,
}: {
  children: ReactNode;
  /**
   * No surface of its own: the rows sit straight on the ground with their
   * hairlines and nothing else.
   *
   * For a sheet. A card inside a frosted sheet is the second layer of paint
   * `sheet-scene.tsx` exists to remove, but the interleaved separators and the
   * row insets are the same list either way -- so the shape stays here and only
   * the fill goes. The settings page keeps its cards; a page is not a sheet.
   */
  flush?: boolean;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const rows = Children.toArray(children);
  if (flush) {
    return (
      <View style={styles.sectionBodyFlush}>
        {rows.map((row, position) => (
          <Fragment
            key={isValidElement(row) && row.key != null ? row.key : `settings-row-${position}`}>
            {position > 0 ? <SettingsSeparator /> : null}
            {row}
          </Fragment>
        ))}
      </View>
    );
  }
  return (
    <ThemedSurface
      slot="cards.decoration"
      baseColor={theme.colors.surface}
      style={[styles.sectionBody, { borderRadius: profile.chrome.surface }]}>
      {rows.map((row, position) => (
        <Fragment
          key={isValidElement(row) && row.key != null ? row.key : `settings-row-${position}`}>
          {position > 0 ? <SettingsSeparator /> : null}
          {row}
        </Fragment>
      ))}
    </ThemedSurface>
  );
}

/**
 * The hairline between two rows, inset to the rows' own text column.
 *
 * Inset rather than full-bleed, which is the other half of the alignment fix:
 * a rule that runs the full width of the card reads as a table, and this is a
 * list. The servers list already drew its separators this way; now everything
 * does.
 */
export function SettingsSeparator() {
  const theme = useThemeTokens();
  return (
    <View style={styles.separatorTrack}>
      <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
    </View>
  );
}

/**
 * A row that is one switch and the sentence explaining it.
 */
export function SettingsToggleRow({
  label,
  detail,
  value,
  disabled = false,
  onValueChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  useRenderTally('SettingsToggleRow');
  // A row that cannot be operated says so with the whole row, not with the
  // switch alone. Greying the control and leaving the label at full-strength ink
  // reads as a live setting next to a broken switch; the label is what is being
  // turned off, so the label dims with it. The detail line carries the reason --
  // "set up Face ID in system settings first" -- so it dims to the same tier
  // rather than below it, and stays the most legible thing in a dimmed row.
  const labelColor = disabled ? theme.colors.textDisabled : theme.colors.text;
  const detailColor = disabled ? theme.colors.textDisabled : theme.colors.textMuted;
  return (
    <View style={[styles.row, { paddingVertical: profile.settingsRowPaddingVertical }]}>
      <View style={styles.rowCopy}>
        <Text variant="bodySmall" color={labelColor} style={styles.rowLabel}>
          {label}
        </Text>
        <Text variant="caption" color={detailColor} numberOfLines={3} style={styles.rowDetail}>
          {detail}
        </Text>
      </View>
      <Toggle
        accessibilityLabel={label}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        // A stable id lets device tests target this switch independently of
        // the label's surrounding layout containers.
        testID={`toggle-${label}`}
      />
    </View>
  );
}

/**
 * A row that goes somewhere -- another screen, a browser, a mail client.
 *
 * The glyph's disc, when there is one, is `surfaceRaised` and never the accent.
 * Four of these rows used to carry a coral chip apiece, which on a page whose
 * only real decisions are a theme and a server put more accent on "privacy
 * policy" than on either of them. The home screen settled this for the card
 * menus in card #629 -- "deliberately never the accent: rename and unpair are
 * utilities" -- and navigation is the same kind of thing.
 *
 * `icon` is optional, and the rule for when to pass it is per *card*, not per
 * row: every row in a group carries a glyph or none of them does. A single
 * chipped row among switches indents one label by 52 points and leaves the
 * column ragged, which is the exact defect this pass exists to remove.
 *
 * Name the row explicitly: Android can otherwise replace the inferred child
 * label with the busy state. Keep the same title/detail order as the visible row.
 */
export function SettingsNavRow({
  icon: Icon,
  label,
  detail,
  trailing: Trailing,
  onPress,
  disabled = false,
  busy = false,
  accessibilityRole = 'button',
  testID,
}: {
  icon?: LucideIcon;
  label: string;
  detail?: string;
  trailing: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  /**
   * What the row *is*, for a reader who cannot see where it points.
   *
   * A button by default, because most rows on this page change something in the
   * app. `link` for the ones that hand the reader to a browser: the trailing
   * glyph says "this leaves Muqun" to everybody else, and a screen reader that
   * announces "button" instead is the one audience the glyph does not reach.
   * Sighted readers lose nothing either way -- the role draws nothing.
   */
  accessibilityRole?: 'button' | 'link';
  testID?: string;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  useRenderTally('SettingsNavRow');
  return (
    <PressableScale
      accessibilityRole={accessibilityRole}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={[styles.row, { paddingVertical: profile.settingsRowPaddingVertical }]}>
      {Icon ? (
        <View
          style={[
            styles.chip,
            { borderRadius: profile.chrome.control },
            { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
          ]}>
          <Icon size={18} color={theme.colors.textMuted} strokeWidth={2} />
        </View>
      ) : null}
      <View style={styles.rowCopy}>
        <Text variant="bodySmall" style={styles.rowLabel}>
          {label}
        </Text>
        {detail ? (
          <Text
            variant="caption"
            color={theme.colors.textMuted}
            numberOfLines={3}
            style={styles.rowDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Trailing size={18} color={theme.colors.textMuted} strokeWidth={2} />
    </PressableScale>
  );
}

/**
 * A row that names a choice made somewhere else, and opens the sheet where it
 * is made.
 *
 * Card #683's row. The theme and the language are decided once per install and
 * were spending the whole of the first screen on it -- five preview cards and a
 * nine-option list, both of them permanently open on a page whose other twenty
 * rows are switches. Here the answer is stated, in the value column, and the
 * question is one tap away.
 *
 * Values normally sit beside the label. Long names can use `valuePosition="below"`
 * to occupy a third line beneath the description.
 *
 * `accessibilityLabel` is passed explicitly here, and it is the one row on this
 * page that does. `SettingsNavRow` deliberately lets React Native concatenate
 * its lines, but a pressable that merges three of them announces "Theme,
 * Terminal colours follow the theme., Osuki" -- the answer buried in the middle
 * of the explanation. The caller composes "Theme, Osuki" through Lingui, so the
 * order is the language's to decide and the e2e flow has one stable string to
 * assert the round trip on.
 */
export function SettingsChoiceRow({
  label,
  value,
  valuePosition = 'trailing',
  detail,
  accessibilityLabel,
  testID,
  onPress,
}: {
  label: string;
  /** The current answer, written the way the sheet writes it. */
  value: string;
  /** Long names can occupy a third line beneath the description. */
  valuePosition?: 'trailing' | 'below';
  detail?: string;
  accessibilityLabel: string;
  testID?: string;
  onPress: () => void;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  useRenderTally('SettingsChoiceRow');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      style={[styles.row, { paddingVertical: profile.settingsRowPaddingVertical }]}>
      <View style={[styles.rowCopy, valuePosition === 'trailing' && styles.rowCopyFloor]}>
        <Text variant="bodySmall" style={styles.rowLabel}>
          {label}
        </Text>
        {detail ? (
          <Text
            variant="caption"
            color={theme.colors.textMuted}
            numberOfLines={3}
            style={styles.rowDetail}>
            {detail}
          </Text>
        ) : null}
        {valuePosition === 'below' ? (
          <Text
            variant="bodySmall"
            color={theme.colors.textMuted}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.choiceValueBelow}>
            {value}
          </Text>
        ) : null}
      </View>
      {valuePosition === 'trailing' ? (
        <Text
          variant="bodySmall"
          color={theme.colors.textMuted}
          numberOfLines={2}
          ellipsizeMode="tail"
          style={styles.choiceValue}>
          {value}
        </Text>
      ) : null}
      <ChevronRight size={18} color={theme.colors.textMuted} strokeWidth={2} />
    </PressableScale>
  );
}

/**
 * A row that only states a fact -- the build number, and nothing to press.
 *
 * `testID` is optional and sits on the row rather than on either line of it.
 * A row with nothing to press has no accessibility node of its own for a device
 * test to name, so the only durable handle on "the Images row exists and reads
 * a size" is an id on the container; without one a flow has to match the label
 * text, which is a translated string and stops being true the moment the suite
 * runs in anything but English.
 */
export function SettingsInfoRow({
  icon: Icon,
  label,
  detail,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  detail: ReactNode;
  testID?: string;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  useRenderTally('SettingsInfoRow');
  return (
    <View
      testID={testID}
      style={[styles.row, { paddingVertical: profile.settingsRowPaddingVertical }]}>
      <View
        style={[
          styles.chip,
          { borderRadius: profile.chrome.control },
          { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
        ]}>
        <Icon size={18} color={theme.colors.textMuted} strokeWidth={2} />
      </View>
      <View style={styles.rowCopy}>
        <Text variant="bodySmall" style={styles.rowLabel}>
          {label}
        </Text>
        <Text
          selectable
          variant="caption"
          color={theme.colors.textMuted}
          numberOfLines={3}
          style={styles.rowDetail}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

/**
 * A row whose control is too big to sit beside its label -- a theme grid, a
 * segmented control, a language list. Label above, control below, and an
 * optional caption under that saying what the current choice means.
 */
export function SettingsBlock({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: ReactNode;
  children: ReactNode;
}) {
  useRenderTally('SettingsBlock');
  return (
    <View style={styles.block}>
      <Text variant="bodySmall" style={styles.rowLabel}>
        {label}
      </Text>
      {children}
      {caption}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: LADDER.gap },
  // `alignSelf` is the hug. Without it the label stretches to its column's
  // width and the plate under it becomes a bar.
  sectionTitle: {
    alignSelf: 'flex-start',
    paddingHorizontal: LADDER.tight,
    letterSpacing: 0.8,
  },
  // On a settings section the plate starts at the card edge, while its text
  // keeps the same gutter as the rows below. Other SectionLabel placements
  // retain their compact, symmetric plate.
  settingsSectionTitle: {
    marginLeft: 0,
    paddingLeft: LADDER.gutter,
  },
  sectionBodyFlush: { overflow: 'hidden' },
  sectionBody: {
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  separatorTrack: { paddingHorizontal: LADDER.gutter },
  separator: { height: StyleSheet.hairlineWidth },
  row: {
    minHeight: ROW_MIN_HEIGHT,
    paddingHorizontal: LADDER.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  /**
   * The floor, applied only where there is something to be crushed by.
   *
   * A minimum rather than a basis: `flex: 1` above is a basis of zero, and Yoga
   * hands shrink out in proportion to basis, so this column's share of the
   * shrinking is zero and the value beside it takes the row. A minimum is
   * clamped after that distribution instead of weighted inside it, which is why
   * it is the one form that holds.
   */
  rowCopyFloor: { minWidth: CHOICE_LABEL_FLOOR },
  // Shrinks before the label does: a language written in its own script is
  // short, but "Muqun follows the language your phone is set to." is not, and
  // the chevron must not be pushed off the end by either of them.
  //
  // `flexShrink` alone was not enough. Shrink is weighted by flex basis, and
  // this one's basis is its own content, so on a wide face it was the only
  // child with any weight and it took everything -- see `rowCopyFloor`. With
  // the floor in place this is what spends the remainder: up to two lines,
  // right-aligned, ending at the chevron.
  choiceValue: { flexShrink: 1, minWidth: 0, textAlign: 'right' },
  choiceValueBelow: { marginTop: 6, includeFontPadding: false },
  /**
   * No `lineHeight` on either line, deliberately.
   *
   * These two carried 20 and 17, which are the kit's own 14x1.5 and 12x1.4
   * rounded down -- numbers measured off the system face and then frozen. A
   * face with taller ascenders than the one they were measured on has its
   * accents clipped by them, and `includeFontPadding: false` removes the very
   * padding Android would otherwise have used to absorb the difference. The
   * ratio belongs to the type scale, so the type scale keeps it and these
   * only turn off the Android padding that would make the two lines drift
   * apart.
   */
  rowLabel: { includeFontPadding: false },
  rowDetail: { includeFontPadding: false },
  chip: {
    width: CHIP_SIZE,
    height: CHIP_SIZE,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { padding: LADDER.gutter, gap: LADDER.snug },
});
