/** Coordinate installed metadata, open previews and asynchronous file operations. */
export class ThemeAssetLifecycle {
  private references: Set<string> | null = null;
  private reservations = new Map<string, number>();
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();

  replaceReferences(uris: Iterable<string> | null): boolean {
    if (uris === null) {
      this.references = null;
      return false;
    }
    const next = new Set(uris);
    const changed =
      !this.references ||
      next.size !== this.references.size ||
      [...next].some((uri) => !this.references!.has(uri));
    this.references = next;
    return changed;
  }

  reserve(uris: Iterable<string>): () => void {
    const unique = new Set(uris);
    for (const uri of unique) this.reservations.set(uri, (this.reservations.get(uri) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const uri of unique) {
        const remaining = (this.reservations.get(uri) ?? 1) - 1;
        if (remaining === 0) this.reservations.delete(uri);
        else this.reservations.set(uri, remaining);
      }
    };
  }

  canCollect(uri: string): boolean {
    return (
      this.references !== null &&
      this.pending === 0 &&
      !this.references.has(uri) &&
      !this.reservations.has(uri)
    );
  }

  async install<T>(action: () => Promise<T>): Promise<T> {
    this.pending++;
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      this.pending--;
      unlock();
    }
  }
}
