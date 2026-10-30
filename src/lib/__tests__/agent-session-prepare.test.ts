import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { SessionPreparationFlights } from '../foreground-session-activation';

function harness(data: unknown = { data: { prepared: true } }, status = 200) {
  const calls: { endpoint: unknown; url: string; init: RequestInit }[] = [];
  const prepare = runInNewContext(
    transpile(
      [
        declaration('src/lib/agent-session-prepare.ts', 'sessionPreparationSource'),
        declaration('src/lib/agent-session-prepare.ts', 'prepareAgentSessionAt'),
      ].join('\n') + '\nprepareAgentSessionAt'
    ),
    {
      flights: new SessionPreparationFlights(),
      gatewayEndpointFetch: async (endpoint: unknown, url: string, init: RequestInit) => {
        calls.push({ endpoint, url, init });
        return { ok: status === 200, status, json: async () => data, text: async () => 'refused' };
      },
    }
  ) as (options: {
    serverId: string;
    agentId: string;
    asid: string;
    endpoint: { url: string; token: string; deviceId: string };
    capabilities?: string[];
  }) => Promise<void>;
  return { calls, prepare };
}
const options = {
  serverId: 'server',
  agentId: 'opaque/agent',
  asid: 'opaque/session',
  endpoint: { url: 'https://captured.invalid/', token: 'fixture', deviceId: 'device' },
};

test('activation posts to the provider-scoped route with captured credentials and no prompt', async () => {
  const run = harness();
  await run.prepare({ ...options, capabilities: ['agent_session_resume_v1'] });
  expect(run.calls).toHaveLength(1);
  expect(run.calls[0].url).toBe(
    'https://captured.invalid/api/agents/opaque%2Fagent/sessions/opaque%2Fsession/prepare'
  );
  expect(run.calls[0].init.method).toBe('POST');
  expect(run.calls[0].init.body).toBeUndefined();
  expect(run.calls[0].endpoint).toEqual(options.endpoint);
  expect(run.calls[0].init.headers).toEqual({ Authorization: 'Bearer fixture' });
});

test('legacy capability absence sends nothing; refusal and malformed acknowledgments remain errors', async () => {
  const old = harness();
  await old.prepare(options);
  expect(old.calls).toHaveLength(0);
  const refused = harness({}, 503);
  await expect(
    refused.prepare({ ...options, capabilities: ['agent_session_resume_v1'] })
  ).rejects.toThrow('503');
  expect(refused.calls).toHaveLength(1);
  const malformed = harness({ data: { prepared: false } });
  await expect(
    malformed.prepare({ ...options, capabilities: ['agent_session_resume_v1'] })
  ).rejects.toThrow('unreadable response');
});
