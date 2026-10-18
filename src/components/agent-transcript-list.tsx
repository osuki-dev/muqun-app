import {
  createContext,
  memo,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useImperativeHandle,
  useState,
  useCallback,
  type ComponentProps,
} from 'react';
import { UIManager, type ViewInstance } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { KeyboardAwareLegendList } from '@legendapp/list/keyboard';
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import type { AgentTranscriptStore } from '@/stores/agent-transcript';
import { AgentAssistantMessage, AgentUserMessage } from './agent-message-block';
import { DiagramVisibility } from './diagram-visibility';
import { useIsFocused } from 'expo-router';
import { useAppActive } from '@/hooks/use-app-active';
import { AudioPlaybackContext } from '@/components/audio-playback-context';
import { AudioPlaybackPool } from '@/lib/audio-playback-pool';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useLatestReader, useStableHandler } from '@/hooks/use-render-refs';
import type { ToolExpansionIntent } from './embedded-terminal-tool-block';

type BeginToolExpansion = (
  rowKey: string,
  toolId: string,
  header: ViewInstance
) => ToolExpansionIntent | undefined;

interface PendingToolExpansion {
  owner: string;
  rowKey: string;
  toolId: string;
  header: ViewInstance;
  bodyReady: boolean;
  rowReady: boolean;
  measuring: boolean;
  started: boolean;
}

// LegendList can queue these options until reconciliation settles. Read at
// dispatch so a cancelled request cannot replay a captured offset. Keep the
// accessors outside the component: React Compiler cannot lower object getters.
function deferredToolScroll(
  read: () => { offset: number; animated: boolean }
): Parameters<LegendListRef['scrollToOffset']>[0] {
  return {
    get offset() {
      return read().offset;
    },
    get animated() {
      return read().animated;
    },
  };
}

type UserProps = ComponentProps<typeof AgentUserMessage>;
interface RowContextValue extends Omit<UserProps, 'group'> {
  store: AgentTranscriptStore;
  diagramsActive: boolean;
  visibility: StoreApi<ReadonlySet<string>>;
  playback: { pool: AudioPlaybackPool; namespace: string };
  beginToolExpansion: BeginToolExpansion;
  rowScope: string;
}
const RowContext = createContext<RowContextValue | null>(null);

const TranscriptRow = memo(function TranscriptRow({ id }: { id: string }) {
  const context = useContext(RowContext)!;
  const { store, diagramsActive, visibility, playback, beginToolExpansion, rowScope, ...props } =
    context;
  const actions = useMemo(
    () => ({
      ...props.actions,
      onExpandTool: (toolId: string, header: ViewInstance) =>
        beginToolExpansion(id, toolId, header),
    }),
    [props.actions, beginToolExpansion, id]
  );
  const group = useStore(store, (state) => state.rows[id]);
  const reasoningLive = useStore(store, (state) => state.reasoningKey === id);
  const streamingItemId = useStore(store, (state) =>
    state.streamingKey === id ? state.rows[id]?.items.at(-1)?.id : undefined
  );
  const visible = useStore(visibility, (keys) => keys.has(id));
  if (!group) return null;
  // Recycle the list container, but give each stateful/native part its own
  // lifetime. Expansion, input drafts, timers and native markdown must never
  // carry over when a container is assigned to another part.
  return group.role === 'user' ? (
    <AgentUserMessage key={`${rowScope}:${id}`} group={group} {...props} />
  ) : (
    <AudioPlaybackContext.Provider value={{ ...playback, row: id }}>
      <DiagramVisibility.Provider value={visible && diagramsActive}>
        <AgentAssistantMessage
          key={`${rowScope}:${id}`}
          group={group}
          reasoningLive={reasoningLive}
          streamingItemId={props.readOnly ? undefined : streamingItemId}
          showReasoning={props.showReasoning}
          markdownStyle={props.markdownStyle}
          actions={actions}
          readOnly={props.readOnly}
        />
      </DiagramVisibility.Provider>
    </AudioPlaybackContext.Provider>
  );
});

const keyOfRow = (id: string) => id;
const DIAGRAM_VIEWABILITY = { id: 'diagrams', itemVisiblePercentThreshold: 0, minimumViewTime: 0 };
const renderRow = ({ item }: LegendListRenderItemProps<string>) => <TranscriptRow id={item} />;

type ListProps = Omit<
  ComponentProps<typeof KeyboardAwareLegendList<string>>,
  'data' | 'renderItem' | 'keyExtractor' | 'getItemType' | 'itemsAreEqual' | 'recycleItems'
>;
export const AgentTranscriptList = memo(function AgentTranscriptList({
  store,
  rowProps,
  keyboardAware = true,
  scrollToSentRow,
  toolScrollTopInset = 0,
  ref: forwardedRef,
  ...props
}: ListProps & {
  store: AgentTranscriptStore;
  rowProps: Omit<UserProps, 'group'>;
  /** Read-only sheets use the native list's scrolling range for sheet hand-off. */
  keyboardAware?: boolean;
  /** Explicit sends only; streaming updates must never create this request. */
  scrollToSentRow?: string;
  /** Overlay navigation in the main workbench; sheets already lay out below their header. */
  toolScrollTopInset?: number;
}) {
  const keys = useStore(store, (state) => state.keys);
  const focused = useIsFocused();
  const appActive = useAppActive();
  const diagramsActive = focused && appActive;
  const serverId = useGatewayConnectionStore((state) => state.record?.serverId ?? '');
  const namespace = `${serverId}:${rowProps.actions?.audioSessionId ?? ''}`;
  const reducedMotion = useReducedMotion();
  const owner = JSON.stringify([namespace, props.dataKey == null ? null : String(props.dataKey)]);
  const readExpansionEnvironment = useLatestReader({
    owner,
    active: diagramsActive,
    toolScrollTopInset,
    reducedMotion,
    store,
  });
  const [pool] = useState(() => new AudioPlaybackPool());
  useEffect(
    () => () => {
      void pool.clear(namespace);
    },
    [pool, namespace]
  );
  const [visibility] = useState(() => createStore<ReadonlySet<string>>(() => new Set()));
  const onViewableItemsChanged = useCallback<NonNullable<ListProps['onViewableItemsChanged']>>(
    ({ viewableItems }) => {
      const next = new Set(viewableItems.map((item) => item.key));
      visibility.setState(
        (current) =>
          current.size === next.size && [...next].every((key) => current.has(key)) ? current : next,
        true
      );
    },
    [visibility]
  );
  const listRef = useRef<LegendListRef>(null);
  const pendingExpansion = useRef<PendingToolExpansion | null>(null);
  const nativeScroll = useRef({ offset: 0 });
  const manuallyScrolling = useRef(false);
  const [toolBrowsing, setToolBrowsing] = useState(false);
  const ownsExpansion = useCallback(
    (intent: PendingToolExpansion) => {
      const environment = readExpansionEnvironment();
      const row = environment.store.getState().rows[intent.rowKey];
      return (
        pendingExpansion.current === intent &&
        environment.active &&
        environment.owner === intent.owner &&
        listRef.current?.getState().indexByKey(intent.rowKey) !== undefined &&
        row?.items.some(({ part }) =>
          part.type === 'tool'
            ? part.id === intent.toolId
            : part.type === 'shell' && part.shell_id === intent.toolId
        )
      );
    },
    [readExpansionEnvironment]
  );
  const cancelExpansion = useCallback(() => {
    const intent = pendingExpansion.current;
    pendingExpansion.current = null;
    if (intent?.started && intent.owner === readExpansionEnvironment().owner) {
      // LegendList 3.6 queues imperative commands during data reconciliation.
      // Supersede the old command with the offset at DISPATCH, not at cancel:
      // a drag or session switch must not replay an obsolete captured offset.
      void listRef.current?.scrollToOffset(
        deferredToolScroll(() => ({
          offset: nativeScroll.current.offset,
          animated: false,
        }))
      );
    }
  }, [readExpansionEnvironment]);
  const positionExpandedTool = useCallback(() => {
    const intent = pendingExpansion.current;
    if (
      !intent ||
      !ownsExpansion(intent) ||
      !intent.bodyReady ||
      !intent.rowReady ||
      intent.measuring
    )
      return;
    const list = listRef.current;
    if (!list) return;
    const state = list.getState();
    const index = state.indexByKey(intent.rowKey);
    if (index === undefined) return;
    const row = state.elementAtIndex(index);
    const viewportNode = list.getScrollableNode();
    if (!row?.measureInWindow || viewportNode == null) {
      cancelExpansion();
      return;
    }
    intent.measuring = true;
    const offset = nativeScroll.current.offset;
    // Measure the header inside its actual keyed container, not the message top.
    // Window coordinates supply only a viewport DELTA, never a content offset.
    intent.header.measureLayout(
      row,
      (_x, headerY) => {
        if (!ownsExpansion(intent)) return;
        row.measureInWindow((_rowX: number, rowY: number) => {
          UIManager.measureInWindow(viewportNode, (_viewportX: number, viewportY: number) => {
            if (!ownsExpansion(intent)) return;
            if (nativeScroll.current.offset !== offset) {
              // Keyboard/MVCP movement invalidates this measurement. End this
              // unstarted intent now; unrelated stream/layout events must not
              // revive it later, even if no momentum-end event ever arrives.
              cancelExpansion();
              return;
            }
            const latest = list.getState();
            const currentIndex = latest.indexByKey(intent.rowKey);
            if (currentIndex === undefined || latest.elementAtIndex(currentIndex) !== row) return;
            const measuredPosition = latest.positionByKey(intent.rowKey);
            const headerContentY = offset + rowY + headerY - viewportY;
            if (measuredPosition === undefined || !Number.isFinite(headerContentY)) return;
            intent.started = true;
            void list
              .scrollToOffset(
                deferredToolScroll(() => {
                  if (!ownsExpansion(intent))
                    return { offset: nativeScroll.current.offset, animated: false };
                  const current = list.getState();
                  const environment = readExpansionEnvironment();
                  // contentLength already includes insets; match LegendList's
                  // real scroll range instead of manufacturing trailing space.
                  const maximum = Math.max(0, current.contentLength - current.scrollLength);
                  const position = current.positionByKey(intent.rowKey) ?? measuredPosition;
                  return {
                    offset: Math.max(
                      0,
                      Math.min(
                        maximum,
                        headerContentY +
                          position -
                          measuredPosition -
                          environment.toolScrollTopInset
                      )
                    ),
                    animated: !environment.reducedMotion,
                  };
                })
              )
              .then(() => {
                if (pendingExpansion.current === intent) pendingExpansion.current = null;
              });
          });
        });
      },
      () => {
        if (pendingExpansion.current === intent) cancelExpansion();
      }
    );
  }, [cancelExpansion, ownsExpansion, readExpansionEnvironment]);
  const beginToolExpansion = useCallback<BeginToolExpansion>(
    (rowKey, toolId, header) => {
      cancelExpansion();
      const environment = readExpansionEnvironment();
      const intent: PendingToolExpansion = {
        owner: environment.owner,
        rowKey,
        toolId,
        header,
        bodyReady: false,
        rowReady: false,
        measuring: false,
        started: false,
      };
      pendingExpansion.current = intent;
      if (!ownsExpansion(intent)) {
        pendingExpansion.current = null;
        return undefined;
      }
      manuallyScrolling.current = false;
      setToolBrowsing(true);
      return {
        layout: () => {
          if (!ownsExpansion(intent)) return;
          intent.bodyReady = true;
          positionExpandedTool();
        },
        cancel: () => {
          if (pendingExpansion.current === intent) cancelExpansion();
        },
      };
    },
    [cancelExpansion, ownsExpansion, positionExpandedTool, readExpansionEnvironment]
  );
  const handleItemSizeChanged = useStableHandler<
    Parameters<NonNullable<ListProps['onItemSizeChanged']>>
  >((info) => {
    const intent = pendingExpansion.current;
    if (intent?.rowKey === info.itemKey && info.size !== info.previous) {
      intent.rowReady = true;
      positionExpandedTool();
    }
    props.onItemSizeChanged?.(info);
  });
  const handleScroll = useStableHandler<Parameters<NonNullable<ListProps['onScroll']>>>((event) => {
    nativeScroll.current = {
      offset: event.nativeEvent.contentOffset.y,
    };
    props.onScroll?.(event);
  });
  const handleScrollBeginDrag = useStableHandler<
    Parameters<NonNullable<ListProps['onScrollBeginDrag']>>
  >((event) => {
    cancelExpansion();
    manuallyScrolling.current = true;
    props.onScrollBeginDrag?.(event);
  });
  const resumeAtEnd = useCallback(() => {
    if (manuallyScrolling.current && listRef.current?.getState().isAtEnd) {
      manuallyScrolling.current = false;
      setToolBrowsing(false);
    }
  }, []);
  const handleScrollEndDrag = useStableHandler<
    Parameters<NonNullable<ListProps['onScrollEndDrag']>>
  >((event) => {
    resumeAtEnd();
    props.onScrollEndDrag?.(event);
  });
  const handleMomentumScrollEnd = useStableHandler<
    Parameters<NonNullable<ListProps['onMomentumScrollEnd']>>
  >((event) => {
    resumeAtEnd();
    manuallyScrolling.current = false;
    props.onMomentumScrollEnd?.(event);
  });
  useEffect(() => {
    cancelExpansion();
    setToolBrowsing(false);
  }, [owner, cancelExpansion]);
  useEffect(() => {
    if (!diagramsActive) cancelExpansion();
    return cancelExpansion;
  }, [diagramsActive, cancelExpansion]);
  useEffect(() => {
    const intent = pendingExpansion.current;
    if (intent && !keys.includes(intent.rowKey)) cancelExpansion();
  }, [keys, cancelExpansion]);
  const handledSend = useRef<string | undefined>(undefined);
  useImperativeHandle(
    forwardedRef,
    () => ({
      ...listRef.current!,
      scrollToEnd: (options) => {
        cancelExpansion();
        setToolBrowsing(false);
        return listRef.current!.scrollToEnd(options);
      },
    }),
    [cancelExpansion]
  );
  useEffect(() => {
    if (
      !scrollToSentRow ||
      handledSend.current === scrollToSentRow ||
      !keys.includes(scrollToSentRow)
    )
      return;
    // The child list has committed its new data before this effect runs.
    // A rAF in the send handler could still target the old last row.
    handledSend.current = scrollToSentRow;
    cancelExpansion();
    setToolBrowsing(false);
    void listRef.current?.scrollToEnd({ animated: true });
  }, [scrollToSentRow, keys, cancelExpansion]);
  const context = useMemo(
    () => ({
      store,
      diagramsActive,
      visibility,
      playback: { pool, namespace },
      beginToolExpansion,
      rowScope: owner,
      ...rowProps,
    }),
    [store, diagramsActive, visibility, pool, namespace, beginToolExpansion, owner, rowProps]
  );
  // @legendapp/list 3.6 types the plain list's `refScrollView` as
  // `Ref<ScrollView>`, which under React Native 0.88's Strict TypeScript API
  // is the component function rather than the instance; the keyboard-aware
  // list already takes the instance. Both receive the same props here, so the
  // plain one is read through the keyboard-aware type.
  const List = keyboardAware
    ? KeyboardAwareLegendList<string>
    : (LegendList<string> as unknown as typeof KeyboardAwareLegendList<string>);
  return (
    <RowContext.Provider value={context}>
      <List
        {...props}
        maintainScrollAtEnd={toolBrowsing ? false : props.maintainScrollAtEnd}
        onScroll={handleScroll}
        onItemSizeChanged={handleItemSizeChanged}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        ref={listRef}
        viewabilityConfig={DIAGRAM_VIEWABILITY}
        onViewableItemsChanged={onViewableItemsChanged}
        data={keys}
        keyExtractor={keyOfRow}
        renderItem={renderRow}
        recycleItems
      />
    </RowContext.Provider>
  );
});
