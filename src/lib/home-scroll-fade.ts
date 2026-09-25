/** A reversible scroll timeline: preserve the section until its last strip nears the top. */
export function homeScrollFadeOpacity(scrollY: number, bottom: number, distance: number): number {
  'worklet';
  if (bottom <= 0 || distance <= 0) return 1;
  const start = Math.max(0, bottom - distance);
  const progress = Math.max(0, Math.min(1, (scrollY - start) / (bottom - start)));
  return 1 - progress * progress * (3 - 2 * progress);
}
