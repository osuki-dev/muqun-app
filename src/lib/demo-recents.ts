import { DEMO_PAIRING_SERVER_ID } from '@/lib/pairing';
import { useHomeRecentsStore } from '@/stores/home-recents';

/**
 * Demo only: remember the fixture's root agent session (`demoAgentSessionTree`
 * in `demo-gateway.ts`) so Home's Continue has an agent row to open; the native
 * E2E flows tap it. Values mirror that fixture and the demo's `SESSION_ID`;
 * this file deliberately imports nothing from `demo-gateway`, which several
 * store tests mock module-wide. Never runs for a live gateway.
 */
export function seedDemoAgentRecent(): void {
  void useHomeRecentsStore.getState().visit(
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
