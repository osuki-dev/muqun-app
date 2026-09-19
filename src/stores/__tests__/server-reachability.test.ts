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
  // One flight per server, and the second caller *joins* it rather than
  // returning to a store that has not been written yet. The home screen's warm
  // now waits on this probe for its `/health`, so a guard that returned early
  // would hand the warm an empty answer and buy back the second round trip
  // this whole path exists to remove.
  expect(refresh).toContain('const pending = inFlight.get(serverId);');
  expect(refresh).toContain('if (pending) return pending;');
  expect(refresh).toContain('inFlight.delete(serverId);');
});

test('the health the dot already paid for is kept for the warm, once vetted', () => {
  // The body is only recorded after `assertSupportedHerdr`, because handing it
  // to the warm is what lets the warm skip `loadHealth` -- and `loadHealth` is
  // where that check used to happen. A gateway whose terminal backend is down
  // is reachable and must still light its dot, but must not seed a prewarm.
  expect(refresh).toContain('assertSupportedHerdr(answer);');
  const vetted = refresh.indexOf('assertSupportedHerdr(answer);');
  const kept = refresh.indexOf('health = answer;');
  expect(vetted).toBeGreaterThan(-1);
  expect(kept).toBeGreaterThan(vetted);
  // A server that did not answer contributes no health at all.
  expect(refresh).toContain('health: ok ? health : null');
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
  const home = readFileSync('src/app/index.tsx', 'utf8');
  expect(home).toContain('serversToProbe(');
  const targets = home.match(/const probeTargets = useMemo\([\s\S]*?\n {2}\);/)?.[0] ?? '';
  expect(targets).toContain('DEMO_SERVER_ID');
  expect(targets).toContain('sshTunnel');
  for (const call of home.match(/refreshReachabilityMany\([^)]*\)/g) ?? [])
    expect(call).toContain('probeTargets');
});

test('the home screen warms behind the probe, and not at all when it says offline', () => {
  // The expensive path is gated on the cheap one, in both directions: it waits
  // for the probe so the two share one `/health`, and it does not run at all
  // against a server that has just failed to answer -- six requests, each
  // sitting out the full timeout, for a card the list has already drawn as
  // down. The rule itself is pure and tested in
  // `lib/__tests__/server-reachability.test.ts`; this is the wiring.
  const home = readFileSync('src/app/index.tsx', 'utf8');
  const warm =
    home.match(/await useServerSession\.getState\(\)\.hydrate\(\);[\s\S]*?\n {6}\}\)\(\);/)?.[0] ??
    '';
  expect(warm).toContain('await refreshReachability(record,');
  expect(warm).toContain('serverPrewarmGate(record.serverId)');
  expect(warm).toContain('if (!gate.warm) return;');
  // And the health it carries is the probe's, not a second round trip.
  expect(warm).toContain('gate.health');
  const probeAt = warm.indexOf('refreshReachability(');
  const warmAt = warm.indexOf('warmConfiguredWorkspace(');
  expect(probeAt).toBeGreaterThan(-1);
  expect(warmAt).toBeGreaterThan(probeAt);
});
