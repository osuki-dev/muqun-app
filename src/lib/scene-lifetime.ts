/** Serialize native resources for one canvas, including StrictMode/resize while init is pending. */
export function createSceneLifetimes() {
  const tails = new Map<number, Promise<void>>();
  return function startScene(
    canvasId: number,
    start: (isLive: () => boolean) => Promise<() => Promise<void>>,
    onError: () => void
  ): () => void {
    let live = true;
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = tails.get(canvasId) ?? Promise.resolve();
    const task = previous.then(async () => {
      if (!live) return;
      try {
        const dispose = await start(() => live);
        await released;
        await dispose();
      } catch {
        if (live) onError();
      }
    });
    tails.set(canvasId, task);
    void task.then(() => {
      if (tails.get(canvasId) === task) tails.delete(canvasId);
    });
    return () => {
      live = false;
      release();
    };
  };
}
