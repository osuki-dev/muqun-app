import type { NativeStackNavigationEventMap } from 'expo-router';
import {
  createContext,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * Whether the native form sheet a control sits on is being dragged.
 *
 * A press that starts on a row and turns into a drag of the sheet is not a
 * press. React Native Gesture Handler disagrees: it decides whether the finger
 * is still on the button in the button's own coordinates, and the button rides
 * down the screen with the sheet, so the finger never leaves it. The row shows
 * its pressed state for the whole drag and fires `onPress` on release. The
 * owner dragged Appearance away from its Home layout row, and the release
 * pushed the Home layout sheet over Settings as Appearance left.
 *
 * Android tells the route when the sheet starts moving: `sheetDetentChange`
 * with `stable: false` for dragging and settling, `stable: true` once it rests
 * (iOS only ever sends `true`, and UIKit cancels the touches itself). While it
 * moves, `PressableScale` disables its press, which Gesture Handler turns into
 * a native cancel: the pressed look lifts and the release does nothing.
 *
 * Cancelling with a wrapping gesture instead does not work here: activating
 * any Gesture Handler gesture makes its root view intercept the touch stream,
 * and the native sheet below it would stop receiving the drag.
 */
type SheetDragStore = {
  moving: () => boolean;
  set: (moving: boolean) => void;
  subscribe: (listener: () => void) => () => void;
};

function createSheetDragStore(): SheetDragStore {
  let moving = false;
  const listeners = new Set<() => void>();
  return {
    moving: () => moving,
    set: (next) => {
      if (next === moving) return;
      moving = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const SheetDragContext = createContext<SheetDragStore | null>(null);

type SheetDetentEvents = {
  addListener: (
    type: 'sheetDetentChange',
    callback: (event: { data: NativeStackNavigationEventMap['sheetDetentChange']['data'] }) => void
  ) => () => void;
};

/** Wraps a form-sheet route; renders no view, so the sheet's layout is untouched. */
export function SheetDragGuard({
  navigation,
  children,
}: {
  navigation: SheetDetentEvents;
  children: ReactNode;
}) {
  const [store] = useState(createSheetDragStore);
  useEffect(
    () => navigation.addListener('sheetDetentChange', (event) => store.set(!event.data.stable)),
    [navigation, store]
  );
  return <SheetDragContext value={store}>{children}</SheetDragContext>;
}

const resting = () => false;
const noSubscription = () => () => {};

/** The enclosing sheet's drag store, or null outside a form-sheet route. */
export function useSheetDragStore(): SheetDragStore | null {
  return use(SheetDragContext);
}

/** True while the enclosing form sheet is dragged or settling; false elsewhere. */
export function useSheetMoving(store: SheetDragStore | null): boolean {
  return useSyncExternalStore(store?.subscribe ?? noSubscription, store?.moving ?? resting);
}
