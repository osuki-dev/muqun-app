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

/**
 * Splits the Pad hero between the cover title and the drawing. The title keeps
 * its width-fitted height up to 30% of a hero under 520 (40% from 520), and the
 * drawing gets the rest: it starts 35% of the title's height up into it.
 */
export function padHeroSplit(
  heroHeight: number,
  fittedTitleHeight: number,
  hasTitle: boolean
): { titleHeight: number; artworkMaxHeight: number } {
  if (!hasTitle) return { titleHeight: 0, artworkMaxHeight: heroHeight };
  const titleHeight = Math.min(fittedTitleHeight, heroHeight * (heroHeight < 520 ? 0.3 : 0.4));
  return { titleHeight, artworkMaxHeight: Math.max(0, heroHeight - titleHeight * 0.65) };
}

/**
 * The artwork's drawing box. Over the cap the whole natural box scales down
 * (width with it), so the composition is shrunk rather than cropped.
 */
export function fitArtworkBox(
  width: number,
  naturalHeight: number,
  maxHeight: number | undefined
): { width: number; height: number } {
  if (maxHeight === undefined || naturalHeight <= maxHeight || naturalHeight <= 0) {
    return { width, height: naturalHeight };
  }
  return { width: (width * maxHeight) / naturalHeight, height: maxHeight };
}
