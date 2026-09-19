import { createContext, memo, useContext, useMemo, type ComponentProps } from 'react';
import { useStore } from 'zustand';
import { KeyboardAwareLegendList } from '@legendapp/list/keyboard';
import type { LegendListRenderItemProps } from '@legendapp/list/react-native';
import type { AgentTranscriptStore } from '@/stores/agent-transcript';
import { AgentAssistantMessage, AgentUserMessage } from './agent-message-block';

type UserProps = ComponentProps<typeof AgentUserMessage>;
interface RowContextValue extends Omit<UserProps, 'group'> {
  store: AgentTranscriptStore;
}
const RowContext = createContext<RowContextValue | null>(null);

const TranscriptRow = memo(function TranscriptRow({ id }: { id: string }) {
  const context = useContext(RowContext)!;
  const { store, ...props } = context;
  const group = useStore(store, (state) => state.rows[id]);
  const reasoningLive = useStore(store, (state) => state.reasoningKey === id);
  if (!group) return null;
  // Recycle the list container, but give each stateful/native part its own
  // lifetime. Expansion, input drafts, timers and native markdown must never
  // carry over when a container is assigned to another part.
  return group.role === 'user' ? (
    <AgentUserMessage key={id} group={group} {...props} />
  ) : (
    <AgentAssistantMessage
      key={id}
      group={group}
      reasoningLive={reasoningLive}
      showReasoning={props.showReasoning}
      markdownStyle={props.markdownStyle}
      actions={props.actions}
    />
  );
});

const keyOfRow = (id: string) => id;
const renderRow = ({ item }: LegendListRenderItemProps<string>) => <TranscriptRow id={item} />;

type ListProps = Omit<
  ComponentProps<typeof KeyboardAwareLegendList<string>>,
  'data' | 'renderItem' | 'keyExtractor' | 'getItemType' | 'itemsAreEqual' | 'recycleItems'
>;
export const AgentTranscriptList = memo(function AgentTranscriptList({
  store,
  rowProps,
  ...props
}: ListProps & { store: AgentTranscriptStore; rowProps: Omit<UserProps, 'group'> }) {
  const keys = useStore(store, (state) => state.keys);
  const context = useMemo(() => ({ store, ...rowProps }), [store, rowProps]);
  return (
    <RowContext.Provider value={context}>
      <KeyboardAwareLegendList<string>
        {...props}
        data={keys}
        keyExtractor={keyOfRow}
        renderItem={renderRow}
        recycleItems
      />
    </RowContext.Provider>
  );
});
