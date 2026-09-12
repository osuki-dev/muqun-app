type ShareRequest = { name: string; data: string | Uint8Array; packaged: boolean };
type SharePorts = {
  available: () => Promise<boolean>;
  create: (name: string, data: string | Uint8Array) => { uri: string; dispose: () => void };
  share: (uri: string, packaged: boolean) => Promise<void>;
};

/** Serialize native sheets and retain immutable per-request bytes until dismissal. */
export function createThemeFileSharer(ports: SharePorts) {
  let tail: Promise<void> = Promise.resolve();
  return (request: ShareRequest): Promise<void> => {
    // Callers may reuse a byte buffer while their request waits in the queue.
    const data = typeof request.data === 'string' ? request.data : request.data.slice();
    const { name, packaged } = request;
    const job = tail.then(async () => {
      if (!(await ports.available())) throw new Error('File sharing is unavailable');
      const file = ports.create(name, data);
      try {
        await ports.share(file.uri, packaged);
      } finally {
        try {
          file.dispose();
        } catch {
          // Cache eviction can reclaim this request's abandoned export.
        }
      }
    });
    tail = job.catch(() => undefined);
    return job;
  };
}
