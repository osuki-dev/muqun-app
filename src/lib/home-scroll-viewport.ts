/** The foreground stops above Home's dock; its wallpaper remains full-screen. */
export function homeScrollViewportBottom(
  dockHeight: number,
  dockOffset: number,
  keyboardOffset: number,
  viewportHeight: number
): number {
  'worklet';
  if (dockHeight <= 0) return 0;
  return Math.min(viewportHeight, Math.max(0, dockHeight - dockOffset - keyboardOffset));
}
