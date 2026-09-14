import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import {
  captureWorkLayoutAnchor,
  restoreWorkLayoutAnchor,
  type WorkLayoutAnchor,
} from '@/lib/work-task-layout';

export interface WorkScrollBinding {
  read: () => WorkLayoutAnchor | null;
  save: (anchor: WorkLayoutAnchor) => void;
}
const Sections = createContext<{
  content: React.RefObject<View | null>;
  positions: Map<string, number>;
  nodes: Map<string, React.RefObject<View | null>>;
} | null>(null);
/** Immutable record IDs give reflow a surviving point rather than a stale pixel. */
export function WorkTaskSection({ id, children }: { id: string; children: ReactNode }) {
  const registry = useContext(Sections);
  const ref = useRef<View>(null);
  useEffect(() => {
    registry?.nodes.set(id, ref);
    return () => {
      registry?.positions.delete(id);
      registry?.nodes.delete(id);
    };
  }, [registry, id]);
  return (
    <View
      ref={ref}
      collapsable={false}
      onLayout={() => {
        if (registry?.content.current)
          ref.current?.measureLayout(
            registry.content.current,
            (_x, y) => {
              if (ref.current) registry.positions.set(id, y);
            },
            () => {}
          );
      }}>
      {children}
    </View>
  );
}
export function WorkTaskScroll({
  children,
  testID,
  style,
  binding,
  geometry,
  visible,
}: {
  children: ReactNode;
  testID: string;
  style?: ViewStyle;
  binding?: WorkScrollBinding;
  geometry: string;
  visible: boolean;
}) {
  const bindingRef = useRef(binding);
  useEffect(() => {
    bindingRef.current = binding;
  }, [binding]);
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const registry = useMemo(
    () => ({
      content,
      positions: new Map<string, number>(),
      nodes: new Map<string, React.RefObject<View | null>>(),
    }),
    []
  );
  const dimensions = useRef({ content: 0, viewport: 0 });
  const pending = useRef(true);
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);
  const generation = useRef(0);
  const restore = useCallback(() => {
    if (
      !visible ||
      !pending.current ||
      dragging.current ||
      !dimensions.current.viewport ||
      !dimensions.current.content
    )
      return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const capturedGeneration = generation.current;
      const anchor = bindingRef.current?.read();
      if (dragging.current) return;
      if (!anchor) {
        pending.current = false;
        return;
      }
      const finish = () => {
        if (capturedGeneration !== generation.current || dragging.current || !pending.current)
          return;
        const y = restoreWorkLayoutAnchor(
          anchor,
          registry.positions,
          dimensions.current.content,
          dimensions.current.viewport,
          dragging.current
        );
        if (y !== null) scroll.current?.scrollTo({ y, animated: false });
        pending.current = false;
      };
      const section = registry.nodes.get(anchor.id)?.current;
      if (section && content.current) {
        section.measureLayout(
          content.current,
          (_x, y) => {
            if (capturedGeneration !== generation.current) return;
            registry.positions.set(anchor.id, y);
            finish();
          },
          finish
        );
      } else finish();
    });
  }, [registry, visible]);
  useEffect(() => {
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    pending.current = true;
    restore();
    return () => {
      generation.current = nextGeneration + 1;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [geometry, visible, restore]);
  return (
    <ScrollView
      ref={scroll}
      testID={testID}
      style={style}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={80}
      onLayout={(event) => {
        dimensions.current.viewport = event.nativeEvent.layout.height;
        restore();
      }}
      onContentSizeChange={(_width, height) => {
        dimensions.current.content = height;
        restore();
      }}
      onScrollBeginDrag={() => {
        dragging.current = true;
        pending.current = false;
      }}
      onScrollEndDrag={() => {
        dragging.current = false;
      }}
      onScroll={(event) => {
        if (!pending.current || dragging.current)
          binding?.save(
            captureWorkLayoutAnchor(event.nativeEvent.contentOffset.y, registry.positions)
          );
      }}>
      <Sections.Provider value={registry}>
        <View
          ref={content}
          collapsable={false}
          style={{ paddingVertical: 8, paddingBottom: 24, gap: 24 }}>
          {children}
        </View>
      </Sections.Provider>
    </ScrollView>
  );
}
