/** Sample only the perimeter: foreground cutouts already supply their own soft edges. */
export function hasTransparentArtworkEdges(
  width: number,
  height: number,
  readAlpha: (x: number, y: number) => number | undefined
): boolean {
  if (width < 1 || height < 1) return false;
  const right = Math.floor(width) - 1;
  const bottom = Math.floor(height) - 1;
  const middleX = Math.floor(right / 2);
  const middleY = Math.floor(bottom / 2);
  const points = [
    [0, 0],
    [middleX, 0],
    [right, 0],
    [0, middleY],
    [right, middleY],
    [0, bottom],
    [middleX, bottom],
    [right, bottom],
  ];
  let clear = 0;
  for (const [x, y] of points) {
    const alpha = readAlpha(x, y);
    if (alpha !== undefined && alpha < 32 && ++clear >= 2) return true;
  }
  return false;
}
