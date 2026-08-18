/**
 * The `@` file mention picker: a short list of workspace files floating over the
 * composer, close enough to the caret that picking one reads as finishing the
 * word rather than as leaving the message.
 *
 * It never occupies the screen on its own. With nothing to show it renders
 * nothing at all -- no "searching", no "no results", no spinner -- because the
 * only thing worse than a mention panel that is slow is one that covers the
 * keyboard while it thinks. A gateway that is offline or still working simply
 * looks like an `@` that has not offered anything yet, and typing carries on.
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Icon, Text, useThemeTokens, type IconName } from '@osuki-dev/ui';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { FILE_MENTION_VISIBLE_ROWS, type FileMentionHit } from '@/lib/file-mentions';

/** Tall enough for five rows; past that the list scrolls rather than grows. */
const ROW_HEIGHT = 52;

interface FileMentionPanelProps {
  hits: FileMentionHit[];
  /** What was typed after the `@`. Empty means this is the opening screen. */
  query: string;
  /** Short landscape workspaces cannot fit the full five-row tray above the IME. */
  visibleRows?: number;
  onSelect: (hit: FileMentionHit) => void;
}

/**
 * The gateway decides `kind` from the file name alone, so this is a five-way
 * map and not a lookup table that has to keep up with extensions.
 */
function iconForKind(kind: string): IconName {
  switch (kind) {
    case 'image':
      return 'Image';
    case 'markdown':
      return 'FileText';
    case 'pdf':
      return 'FileType';
    case 'binary':
      return 'Binary';
    default:
      return 'FileCode';
  }
}

export function FileMentionPanel({
  hits,
  query,
  visibleRows = FILE_MENTION_VISIBLE_ROWS,
  onSelect,
}: FileMentionPanelProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  if (hits.length === 0) return null;

  return (
    <View
      accessibilityLabel={t`File mentions`}
      style={[
        styles.panel,
        {
          backgroundColor: theme.colors.surface,
        },
      ]}>
      {query ? null : (
        // Only on the opening screen. The gateway has no notion of "recently
        // opened", so this says what it actually answers -- the files nearest
        // the workspace root -- rather than claiming a recency it does not have.
        <Text variant="caption" color={theme.colors.textMuted} style={styles.heading}>
          <Trans>Files in this workspace</Trans>
        </Text>
      )}
      <ScrollView
        // The keyboard stays up through the tap: dismissing it would scroll the
        // composer out from under the thumb between touch down and touch up.
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: ROW_HEIGHT * visibleRows }}>
        {hits.map((hit) => (
          <FileMentionRow key={hit.path} hit={hit} onSelect={onSelect} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * One row: the name the user is thinking of, and under it the path that is
 * actually going into the message, in the case the gateway sent it.
 *
 * Assembled from the design system's `Icon` and `Text` rather than from its
 * `ListItem`, which upper cases its subtitle and would turn `src/theme.ts` into
 * `SRC/THEME.TS` -- a path has to be shown exactly as it will be inserted.
 * `SheetListItem` keeps the case but labels itself with the title, which would
 * make two same-named files in different directories indistinguishable to
 * anything reading the accessibility tree.
 */
function FileMentionRow({
  hit,
  onSelect,
}: {
  hit: FileMentionHit;
  onSelect: (hit: FileMentionHit) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  // A file at the root has nothing above it, so the second line would only
  // repeat the first; the row drops to one line rather than saying it twice.
  const nested = hit.path !== hit.name;
  return (
    <PressableScale
      accessibilityLabel={t`Mention ${hit.path}`}
      testID={`file-mention-${hit.path}`}
      onPress={() => onSelect(hit)}
      style={styles.row}>
      <Icon name={iconForKind(hit.kind)} size={18} color={theme.colors.textMuted} />
      <View style={styles.rowText}>
        <Text variant="bodySmall" color={theme.colors.text} numberOfLines={1}>
          {hit.name}
        </Text>
        {nested ? (
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {hit.path}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 12,
    marginBottom: 7,
    borderRadius: appChrome.radius.popover,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingVertical: 4,
    boxShadow: appChrome.shadow.popover,
  },
  heading: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 2,
  },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
});
