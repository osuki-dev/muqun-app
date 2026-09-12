import { throwIfThemeAborted, themeAbortReason, abortThemeOperation } from '@/theme/abort';
import { parseGitThemeRequest, type GitThemeRevisionResolver } from './git-source';
import type { PublicThemeTransport } from './remote-import';

const metadataBytes = 1024 * 1024;

/** Public GitHub metadata only. No auth, redirects, URL supplied by a response,
 * shell commands or automatic retries. Objects still need independent validation
 * after this branch/default-branch lookup has pinned the reviewed revision. */
export function githubThemeRevisionResolver(
  transport: PublicThemeTransport
): GitThemeRevisionResolver {
  return {
    async resolve(input, { signal }) {
      throwIfThemeAborted(signal);
      const request = parseGitThemeRequest(input.repository, input);
      const path = new URL(request.repository).pathname;
      const endpoint = new URL(`https://api.github.com/repos${path}/commits`);
      endpoint.searchParams.set('per_page', '1');
      if (request.revision) endpoint.searchParams.set('sha', request.revision);
      const controller = new AbortController();
      const cancel = () => abortThemeOperation(controller, themeAbortReason(signal));
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(
        () => abortThemeOperation(controller, new Error('GitHub theme lookup timed out')),
        30_000
      );
      let rejectAbort: (() => void) | undefined;
      try {
        if (signal?.aborted) cancel();
        throwIfThemeAborted(controller.signal);
        const response = await Promise.race([
          transport.get(endpoint.href, { signal: controller.signal, maxBytes: metadataBytes }),
          new Promise<never>((_, reject) => {
            rejectAbort = () => reject(themeAbortReason(controller.signal));
            controller.signal.addEventListener('abort', rejectAbort, { once: true });
            if (controller.signal.aborted) rejectAbort();
          }),
        ]);
        throwIfThemeAborted(controller.signal);
        if (response.status >= 300 && response.status < 400)
          throw new Error('The repository moved. Review its current GitHub URL before importing');
        if (response.status === 403 || response.status === 429)
          throw new Error('GitHub refused this request or its rate limit was reached. Try later');
        if (response.status === 404) throw new Error('Public repository or revision not found');
        if (response.status !== 200)
          throw new Error(`GitHub theme lookup failed (HTTP ${response.status})`);
        if (
          !(response.bytes instanceof Uint8Array) ||
          response.bytes.byteLength > metadataBytes ||
          response.contentType?.split(';')[0].trim().toLowerCase() === 'text/html'
        )
          throw new Error('Invalid GitHub theme metadata');
        const payload: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)
        );
        if (!Array.isArray(payload) || payload.length !== 1)
          throw new Error('GitHub did not return one theme revision');
        const item: unknown = payload[0];
        if (
          !item ||
          typeof item !== 'object' ||
          !('sha' in item) ||
          typeof item.sha !== 'string' ||
          !/^[a-f0-9]{40}$/.test(item.sha) ||
          !('url' in item) ||
          typeof item.url !== 'string' ||
          item.url.toLowerCase() !== `https://api.github.com/repos${path}/commits/${item.sha}`
        )
          throw new Error('GitHub revision does not match the reviewed repository');
        return { repository: request.repository, commit: item.sha };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
        if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
      }
    },
  };
}
