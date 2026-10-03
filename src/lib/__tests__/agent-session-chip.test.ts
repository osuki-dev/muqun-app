import { describe, expect, test } from 'bun:test';

import { sessionChipLead } from '../agent-session-chip';

describe('sessionChipLead', () => {
  test('a session on another agent leads with that agent', () => {
    expect(
      sessionChipLead({
        sessionAgentId: 't3',
        currentAgentId: 'opencode',
        sessionMode: 'build',
        agentHasModes: true,
      })
    ).toEqual({ kind: 'agent', agentId: 't3' });
  });

  test('a session on this agent leads with its own mode, then the selected one', () => {
    expect(
      sessionChipLead({
        sessionAgentId: 'deepseek',
        currentAgentId: 'deepseek',
        sessionMode: 'ptc',
        fallbackMode: 'standard',
        agentHasModes: true,
      })
    ).toEqual({ kind: 'mode', modeId: 'ptc' });
    expect(
      sessionChipLead({
        sessionAgentId: 'deepseek',
        currentAgentId: 'deepseek',
        fallbackMode: 'standard',
        agentHasModes: true,
      })
    ).toEqual({ kind: 'mode', modeId: 'standard' });
  });

  test('an agent without modes never shows a mode, not even the selected one', () => {
    expect(
      sessionChipLead({
        sessionAgentId: 't3',
        currentAgentId: 't3',
        sessionMode: 'osuki',
        fallbackMode: 'osuki',
        agentHasModes: false,
      })
    ).toBeNull();
  });

  test('a session without an agent id is on the screen agent', () => {
    expect(
      sessionChipLead({ currentAgentId: 'opencode', sessionMode: 'plan', agentHasModes: true })
    ).toEqual({ kind: 'mode', modeId: 'plan' });
    expect(sessionChipLead({ currentAgentId: 'opencode', agentHasModes: true })).toBeNull();
  });
});
