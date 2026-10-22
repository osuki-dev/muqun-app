import { PressableScale as KitPressableScale, type PressableScaleProps } from '@osuki-dev/ui';

import { useSheetDragStore, useSheetMoving } from '@/components/sheet-drag-guard';

/**
 * The kit's `PressableScale`, cancelled while the form sheet under it moves.
 *
 * Use this one for anything that can render inside a sheet route. Outside a
 * sheet it is the kit's control unchanged. See `sheet-drag-guard.tsx` for why
 * a drag of the sheet would otherwise press the row it started on.
 */
export function PressableScale({ disabled, onPress, ...props }: PressableScaleProps) {
  const store = useSheetDragStore();
  const moving = useSheetMoving(store);
  return (
    <KitPressableScale
      {...props}
      disabled={disabled || moving}
      onPress={
        onPress &&
        ((event) => {
          // A quick flick can lift the finger before the re-render that
          // disables the press lands; the store already knows.
          if (store?.moving()) return;
          onPress(event);
        })
      }
    />
  );
}
