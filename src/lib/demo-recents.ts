import { DEMO_PAIRING_SERVER_ID } from '@/lib/pairing';
import { useHomeRecentsStore } from '@/stores/home-recents';
import type { HomeContinueEntry } from '@/lib/home-continue';

/** Opt-in native QA inventory. Never persisted, merged into live rows, or given status/progress. */
export function demoContinueSearchEntries(
  fixture: string | undefined,
  demoAvailable: boolean
): readonly HomeContinueEntry[] | undefined {
  if (!demoAvailable || (fixture !== '15' && fixture !== '16')) return undefined;
  return Array.from({ length: Number(fixture) }, (_, index) => ({
    key: `demo-continue-search-${index + 1}`,
    title: index === 15 ? 'Demo search hidden leaf' : `Demo search leaf ${index + 1}`,
    atMs: 16 - index,
    destination: {
      type: 'agent-session',
      target: {
        kind: 'agent-session',
        serverId: DEMO_PAIRING_SERVER_ID,
        sessionId: 'demo',
        directory: '/demo/muqun',
        asid: `demo-tree-leaf-${index + 1}`,
        agentId: 'opencode',
      },
    },
  }));
}

/**
 * Demo only: remember the fixture's root agent session (`demoAgentSessionTree`
 * in `demo-gateway.ts`) so Home's Continue has an agent row to open; the native
 * E2E flows tap it. Values mirror that fixture and the demo's `SESSION_ID`;
 * this file deliberately imports nothing from `demo-gateway`, which several
 * store tests mock module-wide. Idempotent; never runs for a live gateway.
 */
export function seedDemoAgentRecent(): void {
  const store = useHomeRecentsStore.getState();
  // Once: a later visit (or a re-select) must not reorder a row the user moved.
  if (
    store.entries.some(
      (entry) => entry.target.kind === 'agent-session' && entry.target.asid === 'demo-tree-root'
    )
  )
    return;
  void store.visit(
    {
      kind: 'agent-session',
      serverId: DEMO_PAIRING_SERVER_ID,
      sessionId: 'demo',
      directory: '/demo/muqun',
      asid: 'demo-tree-root',
      agentId: 'opencode',
    },
    'Root session'
  );
}
