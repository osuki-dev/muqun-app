/** A disappearing/empty notification must never leave a blank front page. */
export function noticeDeckPage(
  keys: string[],
  heights: Record<string, number>,
  selected: string | null
) {
  const visible = keys.filter((key) => (heights[key] ?? 0) > 0);
  const front = selected && visible.includes(selected) ? selected : visible[0];
  const position = front ? visible.indexOf(front) : 0;
  return { visible, front, position, next: visible[(position + 1) % visible.length] ?? null };
}
