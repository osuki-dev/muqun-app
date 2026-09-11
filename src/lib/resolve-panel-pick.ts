/** Retry reads, never creation. A slow request must finish before another starts. */
export async function resolvePanelPick<T>(
  read: () => Promise<T | null>,
  cancelled: () => boolean,
  pause = () => new Promise<void>((resolve) => setTimeout(resolve, 200))
): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (cancelled()) return null;
    const result = await read();
    if (cancelled()) return null;
    if (result !== null) return result;
    if (attempt < 2) await pause();
  }
  return null;
}
