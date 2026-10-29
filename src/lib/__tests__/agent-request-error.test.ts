import { describe, expect, test } from 'bun:test';

import {
  AGENT_ERROR_MESSAGE_LIMIT,
  agentRequestErrorDetail,
  classifyAgentRequestError,
  classifyAgentSessionGone,
  isAgentOfflineError,
  paneGoneError,
  isAgentDeliveryUnconfirmed,
} from '../agent-request-error';

const refusal = (status: number, code: string, message: string) =>
  new Error(
    `Failed to create agent session: ${status} ${JSON.stringify({ error: { code, message } })}`
  );

test('lost transport receipts and explicit unknown acceptance never establish prompt refusal', () => {
  const cases: [unknown, boolean][] = [
    [new TypeError('Network request failed'), true],
    [new Error('Timed out waiting for the server.'), true],
    [Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }), true],
    [new Error('java.lang.RuntimeException: Cronet failed: net::ERR_CONNECTION_CLOSED'), true],
    [new Error('HTTP 504: upstream timeout'), true],
    [refusal(502, 'agent_error', 'queue acceptance is unknown'), true],
    [refusal(502, 'agent_error', 'Agent session not found: session-1'), false],
    [refusal(400, 'invalid_request', 'too many attachments'), false],
    [refusal(503, 'busy', 'upload slot busy'), false],
    [refusal(403, 'invalid_token', 'pairing revoked'), false],
    [Object.assign(new Error('file missing'), { code: 'ENOENT' }), false],
  ];
  expect(cases.map(([error]) => isAgentDeliveryUnconfirmed(error))).toEqual(
    cases.map(([, unknown]) => unknown)
  );
});

test('a pane read the gateway answers "no such pane" is gone; nothing else is', () => {
  const answered = (status: number, code: string) =>
    new Error(`HTTP ${status}: ${JSON.stringify({ error: { code, message: 'x' } })}`);
  const cases: [Error, boolean][] = [
    [answered(404, 'backend_target_not_found'), true],
    [answered(404, 'unknown_pane'), true],
    [answered(404, 'workspace_missing'), false],
    [answered(500, 'backend_target_not_found'), false],
    [new Error('Network request failed'), false],
  ];
  expect(cases.map(([err]) => paneGoneError(err))).toEqual(cases.map(([, gone]) => gone));
});

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

  test('an unreachable transport is offline but a deadline is not readiness evidence', () => {
    expect(isAgentOfflineError(new TypeError('Network request failed'))).toBe(true);
    expect(isAgentOfflineError(new Error('Timed out waiting for the server.'))).toBe(false);
    expect(classifyAgentRequestError(new Error('Timed out waiting for the server.'))).toEqual({
      kind: 'other',
      message: 'Timed out waiting for the server.',
    });
    expect(
      isAgentOfflineError(Object.assign(new Error('connect failed'), { code: 'ETIMEDOUT' }))
    ).toBe(false);
    // Android: a native exception relayed as text, or a transport code on the error.
    expect(
      isAgentOfflineError(
        new Error('java.lang.RuntimeException: Cronet failed: net::ERR_ADDRESS_UNREACHABLE')
      )
    ).toBe(true);
    expect(
      isAgentOfflineError(new Error('javax.net.ssl.SSLHandshakeException: Chain validation failed'))
    ).toBe(true);
    expect(
      isAgentOfflineError(Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }))
    ).toBe(true);
    // A file or a permission is not the network: it says its own thing.
    expect(isAgentOfflineError(Object.assign(new Error('open failed'), { code: 'ENOENT' }))).toBe(
      false
    );
    expect(
      isAgentOfflineError(new Error('java.io.FileNotFoundException: /data/x (No such file)'))
    ).toBe(false);
  });

  test('a message it cannot read is one short line, never a stack trace', () => {
    const reading = classifyAgentRequestError(
      new Error('Something odd happened\n  at com.example.Thing.run(Thing.java:12)\n  at x.y(z)')
    );
    expect(reading).toEqual({ kind: 'other', message: 'Something odd happened' });
    // A sentence that says "at foo(" itself is not a stack frame.
    expect(classifyAgentRequestError(new Error('Stopped at parse(line 3) in config'))).toEqual({
      kind: 'other',
      message: 'Stopped at parse(line 3) in config',
    });
    expect(
      classifyAgentRequestError(
        refusal(400, 'invalid_request', 'attachment is not a file uploaded to this gateway')
      )
    ).toEqual({ kind: 'other', message: 'attachment is not a file uploaded to this gateway' });
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
