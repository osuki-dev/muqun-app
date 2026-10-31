import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { PermissionReplyFlights } from '../agent-permission-replies';

test('permission API shares identical replies across surfaces but refuses conflicting decisions', async () => {
  const calls: { source: string; body: string }[] = [];
  const releases: (() => void)[] = [];
  const scope = {
    currentRecord: {
      serverId: 'server',
      url: 'https://gateway.invalid',
      deviceId: 'device',
      token: 'token',
      transportKey: 'key',
    },
    currentBaseUrl: 'https://gateway.invalid',
    currentToken: 'token',
    currentDeviceId: 'device',
    currentTransportKey: 'key',
    permissionReplyFlights: new PermissionReplyFlights(),
    writeJson: (_path: string, _label: string, body: unknown) => {
      calls.push({ source: scope.currentRecord.token, body: JSON.stringify(body) });
      return new Promise<void>((resolve) => releases.push(resolve));
    },
  };
  const reply = runInNewContext(
    transpile(
      [
        declaration('src/lib/gateway-client.ts', 'withGatewayPermissionReply'),
        declaration('src/lib/agent-session.ts', 'sessionRoute'),
        declaration('src/lib/agent-session.ts', 'replyAgentPermission'),
      ].join('\n') + '\nreplyAgentPermission'
    ),
    scope
  ) as (
    session: string | undefined,
    asid: string,
    request: string,
    decision: string
  ) => Promise<void>;
  const first = reply('legacy', 'asid', 'request', 'allow');
  const second = reply(undefined, 'asid', 'request', 'allow');
  expect(calls).toHaveLength(1);
  await expect(reply('legacy', 'asid', 'request', 'deny')).rejects.toThrow('in progress');
  expect(calls).toHaveLength(1);
  // A different pairing starts its own delivery, even with identical opaque ids.
  const original = scope.currentRecord;
  scope.currentRecord = { ...original, token: 'replacement' };
  const replacement = reply('legacy', 'asid', 'request', 'allow');
  expect(calls.map((call) => call.source)).toEqual(['token', 'replacement']);
  // Returning to the captured pairing joins its original flight, not the newest global one.
  scope.currentRecord = { ...original };
  const originalAgain = reply('legacy', 'asid', 'request', 'allow');
  expect(calls).toHaveLength(2);
  releases.forEach((release) => release());
  await Promise.all([first, second, replacement, originalAgain]);
});

test('settled failures never retry themselves or retain a persistent response cache', async () => {
  const flights = new PermissionReplyFlights();
  let attempts = 0;
  const fail = () => {
    attempts++;
    return Promise.reject(new Error('response lost'));
  };
  const first = flights.run('captured-pairing', 'session', 'request', 'allow', fail);
  const joined = flights.run('captured-pairing', 'session', 'request', 'allow', fail);
  await expect(first).rejects.toThrow('response lost');
  await expect(joined).rejects.toThrow('response lost');
  expect(attempts).toBe(1);
  // Only another explicit call makes another attempt after settlement.
  await expect(
    flights.run('captured-pairing', 'session', 'request', 'allow', fail)
  ).rejects.toThrow('response lost');
  expect(attempts).toBe(2);
});
