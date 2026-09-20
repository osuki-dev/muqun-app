import { LegendList } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentUnreadDot } from '@/components/agent-unread-dot';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { isSessionUnread, sessionTitleOr } from '@/lib/agent-session';
import {
  flattenSessionTree,
  type ChildrenByParent,
  type SessionNode,
} from '@/lib/agent-session-tree';
import type { AgentSessionInfo } from '@/lib/agent-protocol';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/** Stateless item-owned rendering remains correct when LegendList recycles a cell. */
function SessionTreeRow({
  node,
  parentTitle,
  onPress,
}: {
  node: SessionNode;
  parentTitle?: string;
  onPress: (node: SessionNode) => void;
}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const { session, depth } = node;
  const selected = useAgentSheetBridge((state) => state.activeAsid === session.asid);
  const title = sessionTitleOr(session, t`Untitled session`);
  const unread = isSessionUnread(session);
  const status = {
    busy: t`Running`,
    idle: t`Idle`,
    failed: t`The turn failed`,
    interrupted: t`Stopped`,
    retry: t`Retrying…`,
    unknown: t`Status unknown`,
  }[session.status];
  const level = t`Level ${depth}`;
  const parent = parentTitle ? t`Parent: ${parentTitle}` : '';
  const caption = [session.agent, status, depth > 0 ? level : '', parent]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.branch, { marginLeft: Math.min(depth, 4) * 16 }]}>
      {depth > 0 ? (
        <View pointerEvents="none" style={[styles.connector, { borderColor: colors.border }]} />
      ) : null}
      <SheetSceneRow
        testID={`agent-session-tree-row-${session.asid}`}
        title={title}
        caption={caption}
        selected={selected}
        busy={session.status === 'busy' || session.status === 'retry'}
        accessibilityLabel={unread ? t`${title} — finished while you were away` : title}
        accessibilityValue={{ text: caption }}
        onPress={() => onPress(node)}
        meta={
          unread ? (
            <AgentUnreadDot testID={`agent-session-tree-unread-${session.asid}`} />
          ) : undefined
        }
      />
    </View>
  );
}

const sessionTreeKey = (node: SessionNode) => node.session.asid;

export function AgentSessionTreeSheet({
  root,
  childrenByParent,
  onPressNode,
}: {
  root?: AgentSessionInfo;
  childrenByParent: ChildrenByParent;
  onPressNode: (node: SessionNode) => void;
}) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const nodes = flattenSessionTree(root, childrenByParent);
  const titles = new Map(
    nodes.map(({ session }) => [session.asid, sessionTitleOr(session, t`Untitled session`)])
  );

  return (
    <SheetScene
      testID="agent-session-tree-sheet"
      title={t`Session tree`}
      caption={root ? sessionTitleOr(root, t`Untitled session`) : t`Session unavailable`}>
      <LegendList
        testID="agent-session-tree-list"
        data={nodes}
        dataKey={root?.asid}
        keyExtractor={sessionTreeKey}
        recycleItems
        estimatedItemSize={80}
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        renderItem={({ item }) => (
          <SessionTreeRow
            node={item}
            parentTitle={item.session.parent_id ? titles.get(item.session.parent_id) : undefined}
            onPress={onPressNode}
          />
        )}
        ListFooterComponent={<SheetSceneFooter bottomInset={insets.bottom} />}
      />
    </SheetScene>
  );
}

const styles = StyleSheet.create({
  branch: { position: 'relative' },
  connector: {
    position: 'absolute',
    left: -12,
    top: 0,
    height: 32,
    width: 10,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
