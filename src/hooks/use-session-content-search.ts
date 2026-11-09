import { useEffect, useState } from 'react';

import { useLatestReader } from '@/hooks/use-render-refs';
import { readGatewayRecordJson } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  mergeSessionSearchPages,
  parseSessionSearchPage,
  sessionSearchIndexing,
  sessionSearchPath,
  sessionSearchQuery,
  type SessionSearchGroup,
  type SessionSearchIndexing,
} from '@/lib/session-search';

/** Typing pauses this long before a computer is asked. */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 20;

export interface SessionContentSearchResult {
  /** Nothing asked: an empty query, or no computer that can answer. */
  idle: boolean;
  loading: boolean;
  groups: readonly SessionSearchGroup[];
  indexing: SessionSearchIndexing | null;
  /** Computers that did not answer, while others may have. */
  failed: readonly string[];
}

const IDLE: SessionContentSearchResult = {
  idle: true,
  loading: false,
  groups: [],
  indexing: null,
  failed: [],
};

/**
 * Searches what was said in the sessions of each computer given, as the query
 * settles. Every new query or scope aborts the requests of the one before, so
 * a slow computer's stale answer never lands over a newer one.
 */
export function useSessionContentSearch({
  records,
  query: rawQuery,
  agentId,
  directory,
}: {
  /** Computers known to have `session_search_v1`. */
  records: readonly GatewayRecord[];
  query: string;
  agentId?: string;
  directory?: string;
}): SessionContentSearchResult {
  const query = sessionSearchQuery(rawQuery);
  const serverIds = records.map((record) => record.serverId);
  const key = query ? JSON.stringify([query, agentId ?? '', directory ?? '', serverIds]) : '';
  const [result, setResult] = useState<{ key: string; value: SessionContentSearchResult }>({
    key: '',
    value: IDLE,
  });
  // Read when the key changes, not reacted to: the record objects can be
  // rebuilt while naming the same computers, which the key already covers.
  const readRecords = useLatestReader(records);

  useEffect(() => {
    const targets = readRecords();
    if (!key || !query || targets.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const path = sessionSearchPath({ query, limit: SEARCH_LIMIT, agentId, directory });
      void Promise.allSettled(
        targets.map(async (record) => ({
          serverId: record.serverId,
          page: parseSessionSearchPage(
            await readGatewayRecordJson(record, path, controller.signal)
          ),
        }))
      ).then((settled) => {
        if (controller.signal.aborted) return;
        const pages = settled.flatMap((entry) =>
          entry.status === 'fulfilled' ? [entry.value] : []
        );
        setResult({
          key,
          value: {
            idle: false,
            loading: false,
            groups: mergeSessionSearchPages(
              pages.map(({ serverId, page }) => ({ serverId, hits: page.hits }))
            ),
            indexing: sessionSearchIndexing(pages.map(({ page }) => page.indexing)),
            failed: targets
              .filter((_, index) => settled[index].status === 'rejected')
              .map((record) => record.serverId),
          },
        });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, query, agentId, directory, readRecords]);

  if (!key || records.length === 0) return IDLE;
  // Between a keystroke and the debounce the previous answer stays, marked as
  // being replaced, so the section does not blink empty on every letter.
  if (result.key !== key)
    return result.value.idle
      ? { ...IDLE, idle: false, loading: true }
      : { ...result.value, loading: true };
  return result.value;
}
