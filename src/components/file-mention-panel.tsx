import { useSurfaceBackground } from '@/hooks/use-surface-background';
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
import { Icon, useThemeTokens, type IconName, PressableScale } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { appChrome } from '@/constants/appearance';
import type { MentionComputer } from '@/lib/composer-mentions';
import { FILE_MENTION_VISIBLE_ROWS, type FileMentionHit } from '@/lib/file-mentions';

const NO_COMPUTERS: readonly MentionComputer[] = [];

/** Tall enough for five rows; past that the list scrolls rather than grows. */
const ROW_HEIGHT = 52;

interface FileMentionPanelProps {
  /** Which screen this is on: the terminal says workspace, OpenCode says project. */
  scope?: 'workspace' | 'project';
  hits: FileMentionHit[];
  /** What was typed after the `@`. Empty means this is the opening screen. */
  query: string;
  /** Short landscape workspaces cannot fit the full five-row tray above the IME. */
  visibleRows?: number;
  onSelect: (hit: FileMentionHit) => void;
  /**
   * The computers to offer above the files, already ranked (current first,
   * then reachable, then unreachable; `orderMentionComputers`).
   */
  computers?: readonly MentionComputer[];
  onSelectComputer?: (computer: MentionComputer) => void;
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
  scope = 'workspace',
  computers = NO_COMPUTERS,
  onSelectComputer,
}: FileMentionPanelProps) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  if (hits.length === 0 && computers.length === 0) return null;

  return (
    <View
      accessibilityLabel={t`Mentions`}
      style={[
        styles.panel,
        { borderRadius: profile.chrome.popover },
        {
          backgroundColor: surfaceBackground(theme.colors.surface),
        },
      ]}>
      <ScrollView
        // The keyboard stays up through the tap: dismissing it would scroll the
        // composer out from under the thumb between touch down and touch up.
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: ROW_HEIGHT * visibleRows }}>
        {/* The other computers, pinned above the files: the current target
            first and marked, the reachable ones next, the unreachable ones
            greyed and not pickable. */}
        {computers.length > 0 ? (
          <>
            <Text variant="caption" color={theme.colors.textMuted} style={styles.heading}>
              <Trans>Computers</Trans>
            </Text>
            {computers.map((computer) => (
              <ComputerMentionRow
                key={computer.serverId}
                computer={computer}
                onSelect={onSelectComputer}
              />
            ))}
          </>
        ) : null}
        {query || hits.length === 0 ? null : (
          // Only on the opening screen. The gateway has no notion of "recently
          // opened", so this says what it actually answers -- the files nearest
          // the workspace root -- rather than claiming a recency it does not have.
          <Text variant="caption" color={theme.colors.textMuted} style={styles.heading}>
            {/* The terminal's files are its Herdr workspace's; OpenCode's are its
              project's. One panel, and each screen's own word for where it is. */}
            {scope === 'project' ? (
              <Trans>Files in this project</Trans>
            ) : (
              <Trans>Files in this workspace</Trans>
            )}
          </Text>
        )}
        {hits.map((hit) => (
          <FileMentionRow key={hit.path} hit={hit} onSelect={onSelect} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * One computer in the Computers group. The dock's current target sits on the
 * accent's subtle fill and says so; an unreachable one is greyed, says why,
 * and cannot be picked.
 */
function ComputerMentionRow({
  computer,
  onSelect,
}: {
  computer: MentionComputer;
  onSelect?: (computer: MentionComputer) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const tone = computer.current
    ? theme.colors.primary
    : computer.reachable
      ? theme.colors.text
      : theme.colors.textDisabled;
  const caption = computer.current
    ? t`Current`
    : computer.revoked
      ? t`Link revoked · re-linking…`
      : computer.reachable
        ? null
        : t`Unreachable`;
  const label = t`Mention ${computer.name}`;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}, ${caption}` : label}
      accessibilityState={{ disabled: !computer.reachable }}
      testID={`computer-mention-${computer.serverId}`}
      disabled={!computer.reachable}
      onPress={() => onSelect?.(computer)}
      style={[
        styles.row,
        computer.current && {
          backgroundColor: surfaceBackground(theme.colors.primarySubtle),
          borderRadius: profile.chrome.control,
        },
      ]}>
      <Icon name="Monitor" size={18} color={tone} />
      <View style={styles.rowText}>
        <Text variant="bodySmall" color={tone} numberOfLines={1}>
          {computer.name}
        </Text>
        {caption ? (
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
    </PressableScale>
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
