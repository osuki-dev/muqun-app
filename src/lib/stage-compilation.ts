/** Serializes scene preparation; only a completed current generation may draw. */
export function createStageCompilation() {
  let revision = 0;
  let compiled = -1;
  let pending: Promise<void> | null = null;
  let closed = false;
  let failed = false;
  return {
    changed() {
      revision += 1;
    },
    ready(compile: () => Promise<void>, wake: () => void, fail: (error: unknown) => void) {
      if (closed || failed) return false;
      if (compiled === revision) return true;
      if (pending) return false;
      const preparing = revision;
      pending = Promise.resolve()
        .then(compile)
        .then(
          () => {
            compiled = preparing;
          },
          (error: unknown) => {
            failed = true;
            if (!closed) fail(error);
          }
        )
        .finally(() => {
          pending = null;
          if (!closed && !failed) wake();
        });
      return false;
    },
    /** Keep the scene's resources alive until the compiler releases them. */
    async close() {
      closed = true;
      await pending;
    },
  };
}
