import type { ThemeFilePreview } from '@/theme/local-files';

export type ThemeEditorCandidate = ThemeFilePreview & {
  id?: string;
  assets?: Record<string, string>;
};

/** In-memory handoff only: route URLs never contain a manifest or local paths. */
export function createThemeDraftSessions() {
  const drafts = new Map<string, { draft: ThemeEditorCandidate; holders: number }>();
  function release(token: string) {
    const entry = drafts.get(token);
    drafts.delete(token);
    entry?.draft.prepared?.dispose();
  }
  return {
    put(token: string, draft: ThemeEditorCandidate) {
      if (drafts.has(token) || drafts.size >= 4) throw new Error('Too many open theme previews');
      drafts.set(token, { draft, holders: 0 });
    },
    get(token: string) {
      return drafts.get(token)?.draft;
    },
    hold(token: string) {
      const entry = drafts.get(token);
      if (!entry) return () => {};
      entry.holders++;
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        entry.holders--;
        // React's development effect replay can immediately reacquire the
        // same route. Dispose only after the last real owner has gone.
        queueMicrotask(() => {
          if (entry.holders === 0 && drafts.get(token) === entry) release(token);
        });
      };
    },
    release,
  };
}

export const themeDraftSessions = createThemeDraftSessions();
