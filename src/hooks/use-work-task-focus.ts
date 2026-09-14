import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, type View } from 'react-native';

/** Explicit navigation changes focus; width and incoming output are not inputs. */
export function useWorkTaskFocus(active: boolean, identity: string) {
  const target = useRef<View>(null);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      target.current?.focus();
      const tag = target.current ? findNodeHandle(target.current) : null;
      if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, identity]);
  return target;
}
