import { AGENT_SPAWN_CAPABILITY } from '@/lib/agent-spawn';
import { GIT_DIFF_CAPABILITY, PANE_CONTEXT_CAPABILITY } from '@/lib/git-diff';

/**
 * Exactly what the demo can actually do offline, and nothing else: a capability
 * here is a promise the bundled fixtures have to keep. Kept apart from
 * `demo-gateway` so a unit test can read it without that module's assets.
 */
export const DEMO_CAPABILITIES: readonly string[] = [
  'agent_events',
  AGENT_SPAWN_CAPABILITY,
  'agent_collaboration',
  PANE_CONTEXT_CAPABILITY,
  GIT_DIFF_CAPABILITY,
  'pane_lazygit',
  'agent_audio_assets',
  // The P1 companion surfaces: `demo-gateway.ts` answers them (`demoTasks`, `demoFleetSelf`, `demoMcpTokens`).
  'task_ledger',
  'fleet',
  'mcp_server',
];
