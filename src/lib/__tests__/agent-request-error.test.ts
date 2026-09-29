import { describe, expect, test } from 'bun:test';

import {
  AGENT_ERROR_MESSAGE_LIMIT,
  classifyAgentRequestError,
  isAgentOfflineError,
} from '../agent-request-error';

const refusal = (status: number, code: string, message: string) =>
  new Error(
    `Failed to create agent session: ${status} ${JSON.stringify({ error: { code, message } })}`
  );

describe('classifyAgentRequestError', () => {
  test("a 502 agent_error is the agent refusing, in the gateway's own words", () => {
    expect(
      classifyAgentRequestError(refusal(502, 'agent_error', 'Agent session not found: session-1'))
    ).toEqual({ kind: 'refused', message: 'Agent session not found: session-1' });
  });

  test('a 503 agent_unavailable is offline', () => {
    expect(classifyAgentRequestError(refusal(503, 'agent_unavailable', 'not attached'))).toEqual({
      kind: 'offline',
    });
  });

  test('a bare 503 is offline', () => {
    expect(classifyAgentRequestError(new Error('Failed to get agent session: 503 '))).toEqual({
      kind: 'offline',
    });
    expect(classifyAgentRequestError(new Error('Catalog request failed (503)'))).toEqual({
      kind: 'offline',
    });
  });

  test('a 502 relaying that the agent could not be reached is offline', () => {
    expect(
      classifyAgentRequestError(
        refusal(502, 'agent_error', 'Network error communicating with agent: error sending request')
      )
    ).toEqual({ kind: 'offline' });
  });

  test('a request that got no answer is offline', () => {
    expect(isAgentOfflineError(new TypeError('Network request failed'))).toBe(true);
    expect(isAgentOfflineError(new Error('Timed out waiting for the server.'))).toBe(true);
  });

  test('the refusal is bounded and flattened', () => {
    const long = `line one\n${'x'.repeat(400)}`;
    const reading = classifyAgentRequestError(refusal(502, 'agent_error', long));
    expect(reading.kind).toBe('refused');
    if (reading.kind !== 'refused') return;
    expect(reading.message.length).toBe(AGENT_ERROR_MESSAGE_LIMIT);
    expect(reading.message.startsWith('line one x')).toBe(true);
    expect(reading.message.endsWith('…')).toBe(true);
  });

  test('a 502 without a JSON body keeps its text', () => {
    expect(classifyAgentRequestError(new Error('HTTP 502: Bad Gateway'))).toEqual({
      kind: 'refused',
      message: 'Bad Gateway',
    });
  });

  test('other failures are shown as thrown', () => {
    const err = new Error(`Failed to rename: 400 ${JSON.stringify({ error: { code: 'bad' } })}`);
    expect(classifyAgentRequestError(err)).toEqual({ kind: 'other', message: err.message });
    expect(isAgentOfflineError(err)).toBe(false);
  });
});
