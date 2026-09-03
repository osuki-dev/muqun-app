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
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Toggle } from '@/components/toggle';
import { appChrome } from '@/constants/appearance';
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
 * One group of rows, with its instrument label above it.
 *
 * The label is `variant="label"` -- the design system's 11pt all-caps
 * instrument style, the same one the segmented controls' own labels use. It
 * used to be a `caption` with `title.toUpperCase()` applied in JavaScript,
 * which is the mistake `i18n/labels.ts` is written to prevent: case is a
 * language's business, `toUpperCase()` on 日本語 does nothing and on some
 * scripts does something wrong. `textTransform` is a rendering instruction the
 * platform applies per script, and it costs no catalog churn.
 */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  useRenderTally('SettingsSection');
  return (
    <View style={styles.section}>
      <Text variant="label" style={styles.sectionTitle}>
        {title}
      </Text>
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
export function SettingsCard({ children }: { children: ReactNode }) {
  const theme = useThemeTokens();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.sectionBody, { backgroundColor: theme.colors.surface }]}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <SettingsSeparator /> : null}
          {row}
        </Fragment>
      ))}
    </View>
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
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text variant="bodySmall" color={labelColor} style={styles.rowLabel}>
          {label}
        </Text>
        <Text variant="caption" color={detailColor} style={styles.rowDetail}>
          {detail}
        </Text>
      </View>
      <Toggle
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        // Maestro cannot target a bare Switch: rightOf/below match layout
        // containers, not positions, so give each switch its label as an id.
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
 * No `accessibilityLabel`: React Native builds one by concatenating the two
 * lines, which is what the e2e flow taps, and an explicit label here would
 * silently change those strings.
 */
export function SettingsNavRow({
  icon: Icon,
  label,
  detail,
  trailing: Trailing,
  onPress,
}: {
  icon?: LucideIcon;
  label: string;
  detail?: string;
  trailing: LucideIcon;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  useRenderTally('SettingsNavRow');
  return (
    <PressableScale accessibilityRole="button" onPress={onPress} style={styles.row}>
      {Icon ? (
        <View style={[styles.chip, { backgroundColor: theme.colors.surfaceRaised }]}>
          <Icon size={18} color={theme.colors.textMuted} strokeWidth={2} />
        </View>
      ) : null}
      <View style={styles.rowCopy}>
        <Text variant="bodySmall" style={styles.rowLabel}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" color={theme.colors.textMuted} style={styles.rowDetail}>
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
 * The value sits *beside* the label rather than under it, which is the one
 * place this row departs from `SettingsNavRow`. A navigation row's second line
 * describes where the row goes; this one's is the current answer, and an answer
 * belongs at the end of the sentence its label starts. `detail` keeps its usual
 * job underneath -- what the choice means, not what it is.
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
  detail,
  accessibilityLabel,
  testID,
  onPress,
}: {
  label: string;
  /** The current answer, written the way the sheet writes it. */
  value: string;
  detail?: string;
  accessibilityLabel: string;
  testID?: string;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  useRenderTally('SettingsChoiceRow');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      style={styles.row}>
      <View style={styles.rowCopy}>
        <Text variant="bodySmall" style={styles.rowLabel}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" color={theme.colors.textMuted} style={styles.rowDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {/* Muted, not accent. The decision area is the sheet; a coral value here
          would put the accent on the report of the choice as well as on the
          making of it. */}
      <Text
        variant="bodySmall"
        color={theme.colors.textMuted}
        numberOfLines={1}
        style={styles.choiceValue}>
        {value}
      </Text>
      <ChevronRight size={18} color={theme.colors.textMuted} strokeWidth={2} />
    </PressableScale>
  );
}

/** A row that only states a fact -- the build number, and nothing to press. */
export function SettingsInfoRow({
  icon: Icon,
  label,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  detail: ReactNode;
}) {
  const theme = useThemeTokens();
  useRenderTally('SettingsInfoRow');
  return (
    <View style={styles.row}>
      <View style={[styles.chip, { backgroundColor: theme.colors.surfaceRaised }]}>
        <Icon size={18} color={theme.colors.textMuted} strokeWidth={2} />
      </View>
      <View style={styles.rowCopy}>
        <Text variant="bodySmall" style={styles.rowLabel}>
          {label}
        </Text>
        <Text selectable variant="caption" color={theme.colors.textMuted} style={styles.rowDetail}>
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
  sectionTitle: { paddingHorizontal: LADDER.tight, letterSpacing: 0.8 },
  sectionBody: {
    borderRadius: appChrome.radius.popover,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  separatorTrack: { paddingHorizontal: LADDER.gutter },
  separator: { height: StyleSheet.hairlineWidth },
  row: {
    minHeight: ROW_MIN_HEIGHT,
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  // Shrinks before the label does: a language written in its own script is
  // short, but "Muqun follows the language your phone is set to." is not, and
  // the chevron must not be pushed off the end by either of them.
  choiceValue: { flexShrink: 1, textAlign: 'right' },
  rowLabel: { lineHeight: 20, includeFontPadding: false },
  rowDetail: { lineHeight: 17, includeFontPadding: false },
  chip: {
    width: CHIP_SIZE,
    height: CHIP_SIZE,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { padding: LADDER.gutter, gap: LADDER.snug },
});
