import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The home list went from probing one server to probing up to four, which put
// two things at risk that were previously true by construction. Both are
// checked at source level: the store reaches `gateway-client` directly, and
// faking that module is process-wide in bun -- it collided with
// `gateway-unpair.test.ts` the last time this suite tried it. The ordering rule
// itself is a pure function and is tested properly in
// `lib/__tests__/server-reachability.test.ts`.
const source = readFileSync('src/stores/server-reachability.ts', 'utf8');
/** Comments explain the rule; only the code is allowed to satisfy it. */
const code = (block: string) =>
  block
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const refresh = code(
  source.match(/async refresh\(endpoint, options\) \{[\s\S]*?\n {2}\},/)?.[0] ?? ''
);
const refreshMany = code(source.match(/async refreshMany\([\s\S]*?\n {2}\},/)?.[0] ?? '');

test('a tunnelled record is still refused before anything is sent', () => {
  // The guard that matters most now that more than one server is asked. A
  // tunnelled record's stored `url` is the SSH host's, so probing it would put
  // the gateway bearer token on this phone's loopback -- which the threat model
  // treats as hostile (`docs/ssh-gateway-tunnel.md`, T1). It has to be the
  // first thing the function does, before the rate limit or the flight set.
  expect(refresh).toContain('if (!directGatewayBaseUrl(endpoint)) return;');
  const guard = refresh.indexOf('directGatewayBaseUrl');
  const send = refresh.indexOf('probeGatewayReachable');
  expect(guard).toBeGreaterThan(-1);
  expect(send).toBeGreaterThan(guard);
});

test('the per-server rate limit survived the fan-out', () => {
  // Four servers asked on every focus, unlimited, is four tokens on the wire
  // every time the reader returns to the screen.
  expect(refresh).toContain('needsReachabilityProbe');
  expect(refresh).toContain('inFlight.has(serverId)');
});

test('several servers are asked one at a time, not all at once', () => {
  // Sequential is what keeps the fan-out cheap: four simultaneous TLS
  // handshakes on a cold radio is a launch cost that shows up as heat.
  expect(refreshMany).toContain('for (const endpoint of endpoints)');
  expect(refreshMany).toContain('await get().refresh(endpoint, options)');
  expect(refreshMany).not.toContain('Promise.all');
});

test('one unreachable server does not strand the rest', () => {
  expect(refreshMany).toContain('catch');
});

test('the home screen asks through the bounded list, never the raw records', () => {
  // `refreshMany` has no ceiling of its own by design -- the caller picks the
  // set. So the ceiling only exists if the caller actually applies it.
  const home = readFileSync('src/app/(drawer)/index.tsx', 'utf8');
  expect(home).toContain('serversToProbe(');
  const targets = home.match(/const probeTargets = useMemo\([\s\S]*?\n {2}\);/)?.[0] ?? '';
  expect(targets).toContain('DEMO_SERVER_ID');
  expect(targets).toContain('sshTunnel');
  for (const call of home.match(/refreshReachabilityMany\([^)]*\)/g) ?? [])
    expect(call).toContain('probeTargets');
});
