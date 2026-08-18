/**
 * Opening a web service that is running on the machine this phone is paired to.
 *
 * The whole feature is one observation: a tailnet is a flat layer-3 network. If
 * the phone can reach the gateway over Tailscale it can already reach every
 * other port on that host, directly, with no forwarding and no help from the
 * gateway. So there is nothing to tunnel and nothing to expose -- the app builds
 * a URL and hands it to the browser. The gateway never learns this happened.
 *
 * That is also why this file is arithmetic rather than networking. The only
 * decisions worth testing are which connections may be offered the entry at all,
 * and what URL a port number turns into; both are pure, and both have edges
 * (an IPv6 literal, a gateway URL carrying no port, a port typed as `70000`)
 * that are far cheaper to pin here than to discover on a device.
 *
 * Deliberately no port enumeration. Listing what the host happens to be
 * listening on was considered and rejected: it is a privacy leak the owner
 * never asked for, and it would need an endpoint the gateway does not have.
 * The person types the port they already know they started.
 */

/**
 * How the gateway describes the protection on the connection the app is using.
 *
 * Mirrors `transport_protection` in the gateway (`src/main.rs`). Modelled as the
 * closed set the gateway can actually send, plus the `unknown` it sends when it
 * cannot tell -- a gateway too old to report at all is handled by the callers,
 * which see `undefined` and are required to treat it as not offering.
 */
export type TransportProtection =
  | 'https'
  | 'local-only'
  | 'tailscale-wireguard'
  | 'unencrypted-http'
  | 'unknown';

/**
 * Whether this connection is one where offering to open a URL is honest.
 *
 * Two yeses. `tailscale-wireguard` is the case the feature was built for: the
 * host is on the tailnet, so every port on it is already reachable from here and
 * the traffic is inside WireGuard. `https` is the case where the operator has
 * put real transport security in front of this host, so the same invitation is
 * defensible.
 *
 * The noes matter more. `unencrypted-http` means the app is talking to this
 * machine in clear over a network nobody has vouched for, and inviting someone
 * to open their dev server across it -- session cookies, a debugger, whatever
 * the server is -- would be the app suggesting the unsafe thing. `local-only`
 * means the gateway is bound to loopback and is reachable solely because of an
 * adb reverse or a tunnel that says nothing about any other port. `unknown` is
 * the gateway admitting it cannot tell, which is not a yes.
 *
 * Anything unrecognised, including a value from a future gateway, is a no: this
 * gate has to fail closed or it is not a gate.
 */
export function allowsWebServiceOpen(protection: string | undefined): boolean {
  return protection === 'tailscale-wireguard' || protection === 'https';
}

/** The lowest and highest port a URL may name. */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/**
 * A typed port, or null when it is not one.
 *
 * Strict on purpose -- only digits. `parseInt` would read `3000x` as 3000 and
 * `3.5` as 3, and a field that quietly opens a different port than the one on
 * screen is worse than a field that refuses. Leading zeros are accepted because
 * `03000` is a typo with an unambiguous meaning, not a different port.
 */
export function parsePort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return null;
  return port;
}

/**
 * The URL to open for `port` on the machine `gatewayUrl` points at.
 *
 * One rule: keep the scheme and host, replace the port, drop everything else.
 *
 * Keeping the scheme rather than assuming `http` is the deliberate half. A dev
 * server on an arbitrary port usually is plain HTTP, so assuming it would be
 * right more often -- but when the gateway is reached over `https` the app would
 * then be silently downgrading a connection the operator chose to protect, on a
 * host it knows nothing else about. Guessing wrong costs a failed page load the
 * probe will have already warned about. Guessing wrong the other way costs
 * confidentiality, quietly. So the app never invents a downgrade.
 *
 * Dropping everything else is the other half. `validateGatewayUrl` already
 * refuses credentials, queries and fragments on a stored record, so this is
 * belt and braces -- but this function's output goes to `Linking.openURL`, and
 * a builder that carried a path or userinfo across would be one stored-record
 * change away from aiming the browser somewhere nobody typed.
 *
 * The gateway's own port is not special. Someone who types it gets the gateway,
 * which answers, which is a true answer to what they asked -- and a builder that
 * second-guessed the number on screen would be the same defect as `parseInt`.
 *
 * Null when the port is out of range or the URL is missing, unparseable, or not
 * http(s): every one of those means there is nothing honest to open.
 */
export function webServiceUrl(gatewayUrl: string | undefined, port: number): string | null {
  if (!gatewayUrl) return null;
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return null;

  let parsed: URL;
  try {
    parsed = new URL(gatewayUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // `hostname` keeps the brackets on an IPv6 literal and drops any port, which
  // is exactly the piece being reused; `host` would carry the gateway's port
  // back in and produce `[::1]:23847:3000`.
  if (!parsed.hostname) return null;

  return `${parsed.protocol}//${parsed.hostname}:${port}/`;
}

/**
 * What to show for a URL: the host and port, without the scheme.
 *
 * The scheme is the least interesting part to someone checking the app is about
 * to open the right thing -- they are looking for their machine's name and the
 * number they typed. Returns the input unchanged when it cannot be parsed, so a
 * caller never has to guard a label.
 */
export function describeWebServiceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url;
  }
}
