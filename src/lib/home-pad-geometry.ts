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

/**
 * Height of the Pad Home hero row (cover column + launch pane), so the lower
 * band's labels and first Continue row stay on the first screen.
 *
 * From a 740pt viewport up it is 58% of the viewport, at least 440 and always
 * leaving 300 for the band. Below 740 the 440 floor would eat the band, so it
 * becomes `viewportHeight - 300`, never under 320.
 */
export function padHeroHeight(viewportHeight: number): number {
  if (viewportHeight >= 740) {
    return Math.max(440, Math.min(viewportHeight * 0.58, viewportHeight - 300));
  }
  return Math.max(320, viewportHeight - 300);
}
