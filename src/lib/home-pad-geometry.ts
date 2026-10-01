/** The band under the Pad cover: Continue on the left, Connections on the right. */
export function padLowerBandLayout(innerWidth: number) {
  const gap = 24;
  if (innerWidth < 1000) {
    return { continueWidth: innerWidth, connectionsWidth: innerWidth, gap, columns: 1 as const };
  }
  const connectionsWidth = 320;
  return {
    continueWidth: innerWidth - gap - connectionsWidth,
    connectionsWidth,
    gap,
    columns: 2 as const,
  };
}

/**
 * Whether Pad Home gets the cover + launch pane + lower band composition.
 * Narrower content or large type falls back to the vertical editorial page.
 */
export function padLaunchLayoutEnabled(
  contentWidth: number,
  fontScale: number,
  viewportHeight: number | undefined
): boolean {
  return contentWidth >= 752 && fontScale < 1.35 && Boolean(viewportHeight);
}
