import { describe, expect, test } from 'bun:test';

import {
  DEMO_AGENT_CHANGES_ASID,
  DEMO_AGENT_CHANGES_SESSION_ID,
  demoAgentChangesFixture,
} from '../demo-agent-changes';

describe('isolated offline agent Changes fixture', () => {
  test('requires both reserved identities and never stands in for another session', () => {
    expect(demoAgentChangesFixture('real-gateway', DEMO_AGENT_CHANGES_ASID)).toBeUndefined();
    expect(demoAgentChangesFixture(DEMO_AGENT_CHANGES_SESSION_ID, 'real-agent')).toBeUndefined();
  });
});
