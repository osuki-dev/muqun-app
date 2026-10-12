/** The scroll offset needed to reveal an active pane title, or null if it is already visible. */
export function paneChipRevealOffset(
  layout: { x: number; width: number } | undefined,
  viewport: number,
  offset: number,
  margin: number
): number | null {
  if (!layout || viewport <= 0) return null;
  const left = layout.x - margin;
  const right = layout.x + layout.width + margin;
  if (left >= offset && right <= offset + viewport) return null;

  // A title wider than the strip cannot fit: show its beginning rather than
  // centring its middle. Short titles retain their neighbouring pane context.
  const target = Math.max(
    0,
    layout.width > viewport ? left : layout.x + layout.width / 2 - viewport / 2
  );
  return target === offset ? null : target;
}
