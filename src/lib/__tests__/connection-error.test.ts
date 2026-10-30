import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { classifyAgentRequestError } from '../agent-request-error';
import { classifyConnectionError, type ConnectionErrorKind } from '../connection-error';
import type { describeConnectionError } from '../network-error';

// Same native error shape as the screenshot, with synthetic stack frames only.
const cronet = new Error(
  'java.lang.RuntimeException: Cronet failed: Exception in CronetUrlRequest: ' +
    'net::ERR_NAME_NOT_RESOLVED, ErrorCode=1, InternalErrorCode=-105, Retryable=false\n' +
    ' at native.Request.run(Request.java:100)\n' +
    ' at java.lang.Thread.run(Thread.java:1572)\n' +
    'Caused by: Exception in CronetUrlRequest: net::ERR_NAME_NOT_RESOLVED\n' +
    ' at org.chromium.net.impl.CronetUrlRequest.onError(Request.java:74)'
);

function describe() {
  return runInNewContext(
    transpile(
      declaration('src/lib/network-error.ts', 'describeConnectionError') +
        '\ndescribeConnectionError'
    ),
    { classifyConnectionError, t: (strings: TemplateStringsArray) => strings.join('') }
  ) as typeof describeConnectionError;
}

test('native DNS failures are not evidence that the computer or the agent is offline', () => {
  const original = cronet.message;
  expect(classifyConnectionError(cronet)).toBe('dns');
  expect(classifyConnectionError(new Error('Request failed', { cause: cronet }))).toBe('dns');
  const message = describe()(cronet);
  expect(message).not.toBeNull();
  expect(message).not.toContain('java.');
  expect(message).not.toContain('Cronet');
  expect(message).not.toContain('InternalErrorCode');
  expect(message).not.toContain('offline');
  // Presentation must not destroy the diagnostic error retained by its owner.
  expect(cronet.message).toBe(original);
});

test('NSError and fetch transport causes retain their distinct recovery categories', () => {
  const cases: [unknown, ConnectionErrorKind][] = [
    [new Error('Error Domain=NSURLErrorDomain Code=-1003 "host not found"'), 'dns'],
    [{ domain: 'NSURLErrorDomain', code: -1006, message: 'DNS lookup failed' }, 'dns'],
    [{ domain: 'NSURLErrorDomain', code: -1009, message: 'No internet' }, 'offline'],
    [new Error('net::ERR_INTERNET_DISCONNECTED'), 'offline'],
    [new Error('Error Domain=NSURLErrorDomain Code=-1005 "connection lost"'), 'lost'],
    [new Error('net::ERR_CONNECTION_RESET'), 'lost'],
    [new Error('Error Domain=NSURLErrorDomain Code=-1001 "deadline"'), 'timeout'],
    [Object.assign(new Error('request failed'), { code: 'ETIMEDOUT' }), 'timeout'],
    [new Error('net::ERR_CONNECTION_TIMED_OUT'), 'timeout'],
    [new Error('Error Domain=NSURLErrorDomain Code=-1202 "untrusted certificate"'), 'certificate'],
    [new Error('javax.net.ssl.SSLHandshakeException: certificate rejected'), 'certificate'],
    [new Error('net::ERR_CERT_DATE_INVALID'), 'certificate'],
    [new Error('Error Domain=NSURLErrorDomain Code=-1004 "cannot connect"'), 'connection'],
    [new TypeError('Network request failed'), 'connection'],
    [new TypeError('Failed to fetch'), 'connection'],
    [
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      }),
      'connection',
    ],
  ];
  for (const [error, category] of cases) expect(classifyConnectionError(error)).toBe(category);
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  expect(classifyConnectionError(cycle)).toBeNull();
});

test('received agent refusals, trust failures and filesystem errors keep their original semantics', () => {
  for (const message of [
    'ACP session changed while loading; refresh again',
    'Network error communicating with agent: error sending request',
    'Agent session not found: existing-session',
    'SSLHandshakeException: the tool could not verify its upstream certificate',
  ]) {
    const error = new Error(
      `Failed to resume session: 502 ${JSON.stringify({ error: { code: 'agent_error', message } })}`
    );
    expect(classifyConnectionError(error)).toBeNull();
    expect(describe()(error)).toBeNull();
    expect(classifyAgentRequestError(error)).toEqual(
      message.startsWith('Network error') ? { kind: 'offline' } : { kind: 'refused', message }
    );
  }
  const trust = new Error('HTTP 403: {"error":{"code":"invalid_token","message":"Pair again"}}');
  expect(classifyConnectionError(trust)).toBeNull();
  const remote = Object.assign(new Error('ERR_NAME_NOT_RESOLVED from the agent tool'), {
    code: 'agent_error',
    cause: cronet,
  });
  expect(classifyConnectionError(remote)).toBeNull();
  expect(describe()(remote)).toBeNull();
  expect(classifyConnectionError(new Error('Agent refused', { cause: remote }))).toBeNull();
  expect(
    classifyConnectionError(Object.assign(new Error('File missing'), { code: 'ENOENT' }))
  ).toBeNull();
  expect(
    classifyConnectionError(new Error('java.io.FileNotFoundException: missing file'))
  ).toBeNull();
  expect(
    classifyConnectionError({ domain: 'NSURLErrorDomain', code: -1100, message: 'File missing' })
  ).toBeNull();
  expect(
    classifyConnectionError({ domain: 'NSURLErrorDomain', code: -999, message: 'Cancelled' })
  ).toBeNull();
  expect(
    classifyConnectionError(
      new Error('{"error":{"message":"ERR_NAME_NOT_RESOLVED","code":"agent_error"}}')
    )
  ).toBeNull();
});

test('the actual workbench formatter prefers transport explanations and preserves agent refusals', () => {
  const format = runInNewContext(
    transpile(
      declaration('src/components/agent-workbench.tsx', 'formatAgentErrorMessage') +
        '\nformatAgentErrorMessage'
    ),
    { classifyAgentRequestError, describeConnectionError: describe() }
  ) as (
    error: unknown,
    fallback: string,
    sentences: {
      offline: string;
      refused: (message: string) => string;
      unsupported: string;
      unknownAgent: string;
    }
  ) => string;
  const sentences = {
    offline: 'Start the agent',
    refused: (message: string) => `Agent refused: ${message}`,
    unsupported: 'Unsupported action',
    unknownAgent: 'Unknown agent',
  };
  const connection = describe()(cronet);
  if (connection === null) throw new Error('Expected the native DNS failure to be classified');
  expect(format(cronet, 'Fallback', sentences)).toBe(connection);
  const error = new Error(
    'HTTP 502: {"error":{"code":"agent_error","message":"ACP session changed while loading; refresh again"}}'
  );
  expect(format(error, 'Fallback', sentences)).toBe(
    'Agent refused: ACP session changed while loading; refresh again'
  );
});
