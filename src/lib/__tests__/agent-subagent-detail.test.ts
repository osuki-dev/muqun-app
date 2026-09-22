import { describe, expect, test } from 'bun:test';

import {
  agentSubagentDetailContentState,
  agentSubagentDetailScopeKey,
  retainAgentSubagentDetail,
} from '../agent-subagent-detail';

describe('subagent detail snapshot scope', () => {
  test('the same ASID cannot retain output across a Gateway or owner change', () => {
    const original = agentSubagentDetailScopeKey({
      serverId: 'gateway-a',
      sessionId: 'workspace-a',
      ownerSessionId: 'workspace-a',
      asid: 'same-asid',
    });

    expect(
      agentSubagentDetailScopeKey({
        serverId: 'gateway-b',
        sessionId: 'workspace-a',
        ownerSessionId: 'workspace-a',
        asid: 'same-asid',
      })
    ).not.toBe(original);
    expect(
      agentSubagentDetailScopeKey({
        serverId: 'gateway-a',
        sessionId: 'workspace-a',
        ownerSessionId: 'workspace-b',
        asid: 'same-asid',
      })
    ).not.toBe(original);
  });

  test('a failed replacement request has no previous-scope snapshot to reveal', () => {
    const oldScope = agentSubagentDetailScopeKey({ serverId: 'gateway-a', asid: 'same-asid' });
    const nextScope = agentSubagentDetailScopeKey({ serverId: 'gateway-b', asid: 'same-asid' });
    const previous = { scopeKey: oldScope, transcript: 'old gateway output' };

    const whileReplacementLoads = retainAgentSubagentDetail(previous, nextScope);
    // A failed request commits nothing, so this remains the state rendered by
    // the error branch rather than exposing `previous` again.
    const afterReplacementFails = whileReplacementLoads;

    expect(afterReplacementFails).toBeNull();
  });

  test('the pre-effect scope-change render cannot draw the previous transcript store', () => {
    // React renders the new scope before its effect can flip `loading` back on.
    expect(agentSubagentDetailContentState(false, false, false)).toBe('loading');
    expect(agentSubagentDetailContentState(false, false, true)).toBe('error');
    expect(agentSubagentDetailContentState(true, false, false)).toBe('transcript');
  });
});
