import { memo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Folder, FolderOpen, MoreHorizontal, Trash2 } from 'lucide-react-native';

import { AgentActionMenu } from '@/components/agent-action-menu';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import type { PaneChatColors } from '@/components/pane-chat-blocks';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { gitFileStatusWord } from '@/i18n/labels';
import {
  CHANGE_TREE_DIR_ROW_HEIGHT,
  CHANGE_TREE_FILE_ROW_HEIGHT,
  CHANGE_TREE_ROW_INSET,
  changeTreeIndentOf,
  type ChangeTreeActionsRow,
  type ChangeTreeContextRow,
  type ChangeTreeDirRow,
  type ChangeTreeFileRow,
} from '@/lib/change-tree';

/**
 * The agent Changes sheet's tree rows, drawn inside the shared diff list.
 *
 * Each row is laid out at the list's full content width -- so a patch's
 * horizontal pan carries it -- and its visible part is counter-translated by
 * the same offset as the gutter, so a directory or a file name never pans off
 * the screen.
 *
 * A name is one line, always: a long one is cut in the middle, which keeps
 * both the folder it starts with and the extension it ends with, and every
 * row has the fixed height `change-tree.ts` gives it. A name wrapped onto two
 * lines ("player-repo-drizzle" over ".ts") reads as two files.
 */

/** What the tree rows ask of the screen that owns them. */
export interface ChangeTreeHandlers {
  onToggleDir: (path: string) => void;
  onMoreContext: (path: string) => void;
  /** Open a file's actions. Absent when there are none to offer. */
  onFileActions?: (path: string) => void;
  onDiscard: (path: string) => void;
}

/** An `Animated.View` style that holds the row's visible part at the viewport. */
type Pinned = React.ComponentProps<typeof Animated.View>['style'];

export const ChangeTreeDirRowView = memo(function ChangeTreeDirRowView({
  row,
  width,
  pinnedWidth,
  colors,
  pinned,
  onToggle,
}: {
  row: ChangeTreeDirRow;
  width: number;
  pinnedWidth: number;
  colors: PaneChatColors;
  pinned: Pinned;
  onToggle: (path: string) => void;
}) {
  const { t } = useLingui();
  const Icon = row.collapsed ? Folder : FolderOpen;
  return (
    <PressableScale
      testID={`agent-changes-dir-${row.path}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: !row.collapsed }}
      accessibilityLabel={row.collapsed ? t`Show ${row.path}` : t`Hide ${row.path}`}
      pressedScale={0.995}
      onPress={() => onToggle(row.path)}
      style={{ width }}>
      <Animated.View
        style={[
          styles.row,
          styles.dirRow,
          pinned,
          { width: pinnedWidth, paddingLeft: changeTreeIndentOf(row.depth) },
        ]}>
        <Icon size={15} color={colors.subtle} />
        <Text
          variant="bodySmall"
          color={colors.muted}
          numberOfLines={1}
          ellipsizeMode="middle"
          hugSlack={false}
          style={styles.flexOne}>
          {row.name}
        </Text>
        {row.collapsed ? (
          <Text variant="caption" color={colors.subtle}>
            {row.fileCount}
          </Text>
        ) : null}
      </Animated.View>
    </PressableScale>
  );
});

export const ChangeTreeFileRowView = memo(function ChangeTreeFileRowView({
  row,
  width,
  pinnedWidth,
  colors,
  fill,
  pinned,
  hasSeparator,
  onToggle,
  onActions,
}: {
  row: ChangeTreeFileRow;
  width: number;
  pinnedWidth: number;
  colors: PaneChatColors;
  fill: string;
  pinned: Pinned;
  hasSeparator: boolean;
  onToggle: (path: string) => void;
  onActions?: (path: string) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const word = _(gitFileStatusWord[row.file.status] ?? gitFileStatusWord.unknown);
  return (
    <PressableScale
      testID={`agent-changes-file-${row.path}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: row.expanded }}
      accessibilityLabel={row.expanded ? t`Hide ${row.path}` : t`Show ${row.path}`}
      feedback="selection"
      pressedScale={0.995}
      onPress={() => onToggle(row.path)}
      onLongPress={onActions ? () => onActions(row.path) : undefined}
      style={{
        width,
        backgroundColor: row.expanded ? fill : 'transparent',
        borderBottomColor: colors.border,
        borderBottomWidth: hasSeparator ? StyleSheet.hairlineWidth : 0,
      }}>
      <Animated.View
        style={[
          styles.row,
          styles.fileRow,
          pinned,
          { width: pinnedWidth, paddingLeft: changeTreeIndentOf(row.depth) },
        ]}>
        <View style={styles.flexOne}>
          <Text variant="bodySmall" numberOfLines={1} ellipsizeMode="middle" hugSlack={false}>
            {row.name}
          </Text>
          {row.note === 'error' && row.error ? (
            <Text variant="caption" numberOfLines={1} color={colors.status.error}>
              {row.error}
            </Text>
          ) : row.unchanged && row.expanded ? (
            <Text variant="caption" numberOfLines={1} color={colors.subtle}>
              <Trans>No changes</Trans>
            </Text>
          ) : row.note === 'empty' ? (
            <Text variant="caption" numberOfLines={1} color={colors.subtle}>
              <Trans>No textual change</Trans>
            </Text>
          ) : row.truncated && row.expanded ? (
            <Text variant="caption" numberOfLines={1} color={colors.subtle}>
              <Trans>Patch too long; showing the start of it.</Trans>
            </Text>
          ) : null}
        </View>
        {row.loading ? <ActivityIndicator size="small" color={colors.subtle} /> : null}
        <View style={styles.meta}>
          {/* A conflict is the one status that asks for the reader's attention. */}
          <Text
            variant="caption"
            color={row.file.status === 'conflicted' ? colors.status.running : colors.subtle}>
            {word}
          </Text>
          {row.file.binary || row.note === 'binary' ? (
            <Text variant="caption" color={colors.subtle}>
              <Trans>Binary file</Trans>
            </Text>
          ) : row.file.added === null && row.file.removed === null ? (
            // Too large for the gateway to count: a dash, never a made-up zero.
            <Text variant="caption" color={colors.subtle}>
              —
            </Text>
          ) : (
            <>
              {row.file.added ? (
                <Text variant="caption" color={colors.added}>
                  +{row.file.added}
                </Text>
              ) : null}
              {row.file.removed ? (
                <Text variant="caption" color={colors.removed}>
                  −{row.file.removed}
                </Text>
              ) : null}
            </>
          )}
        </View>
        {onActions ? (
          <PressableScale
            testID={`agent-changes-file-menu-${row.path}`}
            accessibilityRole="button"
            accessibilityLabel={t`Actions for ${row.name}`}
            hitSlop={8}
            onPress={() => onActions(row.path)}
            style={styles.overflow}>
            <MoreHorizontal size={16} color={colors.subtle} />
          </PressableScale>
        ) : null}
      </Animated.View>
    </PressableScale>
  );
});

export const ChangeTreeContextRowView = memo(function ChangeTreeContextRowView({
  row,
  width,
  pinnedWidth,
  colors,
  pinned,
  onPress,
}: {
  row: ChangeTreeContextRow;
  width: number;
  pinnedWidth: number;
  colors: PaneChatColors;
  pinned: Pinned;
  onPress: (path: string) => void;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  return (
    <PressableScale
      testID={`agent-changes-context-${row.path}`}
      accessibilityRole="button"
      accessibilityLabel={t`Show more context`}
      accessibilityState={{ busy: row.loading }}
      disabled={row.loading}
      onPress={() => onPress(row.path)}
      style={{ width }}>
      <Animated.View style={[styles.row, styles.contextRow, pinned, { width: pinnedWidth }]}>
        <View
          style={[
            styles.chip,
            { borderRadius: profile.chrome.control, borderColor: colors.border },
          ]}>
          {row.loading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text variant="caption" color={colors.accent}>
              <Trans>Show more context</Trans>
            </Text>
          )}
        </View>
      </Animated.View>
    </PressableScale>
  );
});

export const ChangeTreeActionsRowView = memo(function ChangeTreeActionsRowView({
  row,
  width,
  pinnedWidth,
  pinned,
  onDiscard,
}: {
  row: ChangeTreeActionsRow;
  width: number;
  pinnedWidth: number;
  pinned: Pinned;
  onDiscard: (path: string) => void;
}) {
  const { t } = useLingui();
  return (
    <View style={{ width }}>
      <Animated.View style={[pinned, { width: pinnedWidth }]}>
        <AgentActionMenu
          testID={`agent-changes-actions-${row.path}`}
          surface="ground"
          items={[
            {
              id: 'discard',
              label: t`Discard changes`,
              Icon: Trash2,
              tone: 'danger',
              onPress: () => onDiscard(row.path),
              testID: 'agent-changes-discard',
            },
          ]}
        />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  flexOne: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: CHANGE_TREE_ROW_INSET,
  },
  // Exactly the heights the list is told (`fixedBodySizeOfDiffRow`), so a
  // row is never measured and never grows.
  dirRow: {
    height: CHANGE_TREE_DIR_ROW_HEIGHT,
    gap: 8,
    overflow: 'hidden',
  },
  fileRow: {
    height: CHANGE_TREE_FILE_ROW_HEIGHT,
    gap: 10,
    overflow: 'hidden',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  overflow: {
    paddingLeft: 4,
  },
  contextRow: {
    minHeight: 44,
    paddingLeft: CHANGE_TREE_ROW_INSET,
  },
  chip: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
