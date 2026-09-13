import { throwIfThemeAborted } from '@/theme/abort';
/** The picker owns cancellation until a prepared preview is handed off. After
 * that boundary the editor owns disposal; picker unmount must not invalidate
 * the signal retained by the prepared install operation. */
export class ThemeImportRequest {
  private readonly controller = new AbortController();
  private transferred = false;
  private canceled = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isCanceled(): boolean {
    return this.canceled;
  }

  cancel(): void {
    if (!this.transferred) {
      this.canceled = true;
      this.controller.abort();
    }
  }

  handoff(accept: () => void): void {
    throwIfThemeAborted(this.signal);
    if (this.transferred) throw new Error('Theme preview was already transferred');
    this.transferred = true;
    try {
      accept();
    } catch (error) {
      this.transferred = false;
      // Rollback invalidates resources, but is not a silent user cancellation.
      this.controller.abort();
      throw error;
    }
  }
}
