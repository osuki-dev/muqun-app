/** A synchronous send lease, independent of React's deferred loading render.
 * Reset invalidates old completions; it never retries or cancels delivery. */
export class ComposerSendGuard {
  private pending: symbol | null = null;

  acquire(): symbol | null {
    if (this.pending !== null) return null;
    this.pending = Symbol('composer-send');
    return this.pending;
  }

  owns(token: symbol): boolean {
    return this.pending === token;
  }

  release(token: symbol): boolean {
    if (!this.owns(token)) return false;
    this.pending = null;
    return true;
  }

  reset(): void {
    this.pending = null;
  }
}
