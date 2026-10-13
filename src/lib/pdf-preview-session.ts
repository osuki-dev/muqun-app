import { FILE_CONTENT_LIMIT } from './media-limits';

/** Owns one bounded download and its private local file until the viewer closes. */
export interface PdfPreviewRuntime {
  uri: string;
  read: (signal: AbortSignal, maxBytes: number) => Promise<Uint8Array>;
  write: (bytes: Uint8Array) => void;
  remove: () => void;
}

export class PdfPreviewTooLargeError extends Error {
  constructor() {
    super('PDF exceeds the preview limit');
  }
}

export class PdfPreviewSession {
  private readonly controller = new AbortController();

  constructor(
    private readonly runtime: PdfPreviewRuntime,
    private readonly declaredSize: number
  ) {}

  async prepare(): Promise<string> {
    try {
      if (this.declaredSize > FILE_CONTENT_LIMIT) throw new PdfPreviewTooLargeError();
      if (this.controller.signal.aborted) throw new Error('Operation cancelled');
      const bytes = await this.runtime.read(this.controller.signal, FILE_CONTENT_LIMIT);
      // A transport can finish after close even when it does not honour abort.
      if (this.controller.signal.aborted) throw new Error('Operation cancelled');
      if (bytes.length > FILE_CONTENT_LIMIT) throw new PdfPreviewTooLargeError();
      this.runtime.write(bytes);
      return this.runtime.uri;
    } catch (error) {
      this.runtime.remove();
      throw error;
    }
  }

  close() {
    this.controller.abort();
    this.runtime.remove();
  }
}
