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

type UserProps = ComponentProps<typeof AgentUserMessage>;
interface RowContextValue extends Omit<UserProps, 'group'> {
  store: AgentTranscriptStore;
  diagramsActive: boolean;
  visibility: StoreApi<ReadonlySet<string>>;
}
const RowContext = createContext<RowContextValue | null>(null);

const TranscriptRow = memo(function TranscriptRow({ id }: { id: string }) {
  const context = useContext(RowContext)!;
  const { store, diagramsActive, visibility, ...props } = context;
  const group = useStore(store, (state) => state.rows[id]);
  const reasoningLive = useStore(store, (state) => state.reasoningKey === id);
  const visible = useStore(visibility, (keys) => keys.has(id));
  if (!group) return null;
  // Recycle the list container, but give each stateful/native part its own
  // lifetime. Expansion, input drafts, timers and native markdown must never
  // carry over when a container is assigned to another part.
  return group.role === 'user' ? (
    <AgentUserMessage key={id} group={group} {...props} />
  ) : (
    <DiagramVisibility.Provider value={visible && diagramsActive}>
      <AgentAssistantMessage
        key={id}
        group={group}
        reasoningLive={reasoningLive}
        showReasoning={props.showReasoning}
        markdownStyle={props.markdownStyle}
        actions={props.actions}
        readOnly={props.readOnly}
      />
    </DiagramVisibility.Provider>
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
  ref: forwardedRef,
  ...props
}: ListProps & {
  store: AgentTranscriptStore;
  rowProps: Omit<UserProps, 'group'>;
  /** Read-only sheets use the native list's scrolling range for sheet hand-off. */
  keyboardAware?: boolean;
  /** Explicit sends only; streaming updates must never create this request. */
  scrollToSentRow?: string;
}) {
  const keys = useStore(store, (state) => state.keys);
  const focused = useIsFocused();
  const appActive = useAppActive();
  const diagramsActive = focused && appActive;
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
  const handledSend = useRef<string | undefined>(undefined);
  useImperativeHandle(forwardedRef, () => listRef.current!, []);
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
    void listRef.current?.scrollToEnd({ animated: true });
  }, [scrollToSentRow, keys]);
  const context = useMemo(
    () => ({ store, diagramsActive, visibility, ...rowProps }),
    [store, diagramsActive, visibility, rowProps]
  );
  const List = keyboardAware ? KeyboardAwareLegendList<string> : LegendList<string>;
  return (
    <RowContext.Provider value={context}>
      <List
        {...props}
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
