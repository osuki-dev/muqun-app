/**
 * Whether Pad Home gets the cover spread (full-height cover, work column).
 * Narrower content or large type falls back to the vertical editorial page.
 */
export function padLaunchLayoutEnabled(
  contentWidth: number,
  fontScale: number,
  viewportHeight: number | undefined
): boolean {
  return contentWidth >= 752 && fontScale < 1.35 && Boolean(viewportHeight);
}

/** Width of the Pad work column beside the cover; the cover takes the rest. */
export function padWorkColumnWidth(innerWidth: number): number {
  return Math.min(400, innerWidth * 0.36);
}
