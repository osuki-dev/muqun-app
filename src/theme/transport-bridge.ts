import { throwIfThemeAborted, themeAbortReason } from '@/theme/abort';
import type { ThemeTransportModule } from '../../modules/theme-transport/src/MuqunThemeTransport.types';
import { publicThemeUrl, type PublicThemeTransport } from './remote-import';
import { THEME_LIMITS } from './schema';

/** The bridge adds lifecycle and output checks, not DNS protection. Only the
 * versioned native implementation may advertise this connection contract. */
export function createPublicThemeTransport(
  native: ThemeTransportModule | null,
  requestId: () => string
): PublicThemeTransport | null {
  if (!native || native.contractVersion !== 1) return null;
  return {
    async get(input, { signal, maxBytes }) {
      throwIfThemeAborted(signal);
      const url = publicThemeUrl(input);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > THEME_LIMITS.packageBytes)
        throw new Error('Invalid theme response budget');
      const id = requestId();
      let abort: (() => void) | undefined;
      try {
        const pending = native.get(id, url, maxBytes);
        const response = await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            abort = () => {
              // A cancellation failure must not leave the UI waiting. Native
              // request timeouts remain a separate bound on resource ownership.
              try {
                native.cancel(id);
              } catch {
                // Cancellation is best-effort if the native runtime is gone.
              }
              reject(themeAbortReason(signal));
            };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          }),
        ]);
        throwIfThemeAborted(signal);
        if (
          !Number.isInteger(response.status) ||
          response.status < 100 ||
          response.status > 599 ||
          !(response.bytes instanceof Uint8Array) ||
          response.bytes.byteLength > maxBytes ||
          (response.location !== undefined &&
            (typeof response.location !== 'string' || response.location.length > 2048)) ||
          (response.contentType !== undefined &&
            (typeof response.contentType !== 'string' || response.contentType.length > 1024))
        )
          throw new Error('Invalid native theme response');
        return response;
      } finally {
        if (abort) signal.removeEventListener('abort', abort);
      }
    },
  };
}
