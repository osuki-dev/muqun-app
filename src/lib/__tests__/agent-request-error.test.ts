import { describe, expect, test } from 'bun:test';

import {
  AGENT_ERROR_MESSAGE_LIMIT,
  agentRequestErrorDetail,
  classifyAgentRequestError,
  classifyAgentSessionGone,
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

describe('codes with a sentence of their own', () => {
  test('feature_unsupported is the agent lacking the action, whatever the status', () => {
    expect(
      classifyAgentRequestError(
        refusal(501, 'feature_unsupported', 'This agent does not support: stage_revert')
      )
    ).toEqual({ kind: 'unsupported' });
    expect(classifyAgentRequestError(refusal(400, 'feature_unsupported', 'nope')).kind).toBe(
      'unsupported'
    );
  });

  test('a bare 501 is the same answer', () => {
    expect(classifyAgentRequestError(new Error('Failed to stage revert: 501 '))).toEqual({
      kind: 'unsupported',
    });
  });

  test('invalid_agent is a gateway that does not know the agent', () => {
    expect(classifyAgentRequestError(refusal(404, 'invalid_agent', 'Unknown agent: t3'))).toEqual({
      kind: 'unknown-agent',
    });
    expect(isAgentOfflineError(refusal(400, 'invalid_agent', 'Unknown agent: t3'))).toBe(false);
  });
});

describe('agentRequestErrorDetail', () => {
  test('reads a discard refusal', () => {
    const err = new Error(
      `Failed to discard changes: 409 ${JSON.stringify({
        error: { code: 'listing_truncated', message: 'The change listing is too large.' },
      })}`
    );
    expect(agentRequestErrorDetail(err)).toEqual({
      status: 409,
      code: 'listing_truncated',
      message: 'The change listing is too large.',
    });
  });

  test('a bare failure has only a status of zero', () => {
    expect(agentRequestErrorDetail(new Error('Network request failed'))).toEqual({ status: 0 });
  });
});

describe('classifyAgentSessionGone', () => {
  const body = (status: number, error: Record<string, unknown>) =>
    new Error(`Failed to get agent session: ${status} ${JSON.stringify({ error })}`);

  test('workspace_missing carries the directory the gateway named', () => {
    expect(
      classifyAgentSessionGone(
        body(404, { code: 'workspace_missing', message: 'gone', directory: '/tmp/x' })
      )
    ).toEqual({ kind: 'workspace-missing', directory: '/tmp/x' });
  });

  test('workspace_missing without a directory is still a gone workspace', () => {
    expect(classifyAgentSessionGone(body(404, { code: 'workspace_missing' }))).toEqual({
      kind: 'workspace-missing',
    });
  });

  test('session_not_found, a bare 404 and the agent refusing are a gone session', () => {
    const gone = { kind: 'session-not-found' } as const;
    expect(classifyAgentSessionGone(body(404, { code: 'session_not_found' }))).toEqual(gone);
    expect(classifyAgentSessionGone(new Error('Failed to get agent session: 404 '))).toEqual(gone);
    expect(
      classifyAgentSessionGone(
        body(502, { code: 'agent_error', message: 'Agent session not found: ses_1' })
      )
    ).toEqual(gone);
  });

  test('offline, other refusals and other 404 codes are not a gone session', () => {
    expect(classifyAgentSessionGone(body(503, { code: 'agent_unavailable' }))).toBeNull();
    expect(
      classifyAgentSessionGone(body(502, { code: 'agent_error', message: 'boom' }))
    ).toBeNull();
    expect(classifyAgentSessionGone(body(404, { code: 'unknown_path' }))).toBeNull();
    expect(classifyAgentSessionGone(new Error('Network request failed'))).toBeNull();
  });
});
