import { allowsWebServiceOpen, webServiceUrl } from '@/lib/web-service';

/**
 * Watching a simulator on the paired machine while an agent works on it.
 *
 * simfarm streams the Mac's iOS, Android and WeChat simulators over one
 * WebSocket and draws each device at 1:1 in a browser. The agent edits the code
 * on that machine; the simulator on that machine redraws; and this is the seam
 * that puts the result in front of someone holding a phone. Without it the loop
 * ends at "the agent says it is done" and the only way to see whether it looks
 * right is to walk back to the desk.
 *
 * ## It is the web-service feature with a number filled in
 *
 * There is no tunnel, no proxy and no gateway involvement, for the reason
 * `web-service.ts` states: a tailnet is a flat layer-3 network, so a phone that
 * can reach the gateway can already reach every other port on that host. All
 * this module does is the same arithmetic with a default port and a couple of
 * paths, which is why it imports rather than reimplements it -- a second copy of
 * the IPv6-literal handling would be a second copy that can be wrong.
 *
 * ## The gate is not optional here, and it is a harder gate than it looks
 *
 * `allowsSimfarmPreview` is deliberately the same predicate as the web-service
 * one, but the consequence of getting it wrong is worse. simfarm's protocol says
 * it plainly: **v1 has no authentication**, it accepts the WebSocket upgrade
 * with no `Origin` check, and it defends itself entirely by listening only on
 * Tailscale and loopback. So anywhere the port is reachable, it can be driven --
 * taps, text, whatever the device accepts.
 *
 * Offering to open that across a network nobody has vouched for would not be
 * offering to *view* a simulator. It would be the app suggesting that the
 * reader expose a remote-control surface for the machine they work on. The gate
 * fails closed for the same reason it does there, and the entry stays hidden
 * rather than appearing disabled: a control that cannot ever work on this
 * connection is furniture.
 */

/**
 * The port simfarm listens on when nobody said otherwise.
 *
 * simfarm's own default, so the common case is that a reader who has one
 * running never types a number at all. It is offered rather than assumed --
 * see `server-simfarm.ts` for why the answer is remembered per server.
 */
export const SIMFARM_DEFAULT_PORT = 8801;

/**
 * Whether this connection is one where offering the preview is honest.
 *
 * See the note above: the same two yeses as the web-service entry, and the
 * unauthenticated surface behind them is why there are only two.
 */
export function allowsSimfarmPreview(protection: string | undefined): boolean {
  return allowsWebServiceOpen(protection);
}

/** The client simfarm serves, which is the thing a preview shows. */
export function simfarmClientUrl(gatewayUrl: string | undefined, port: number): string | null {
  return webServiceUrl(gatewayUrl, port);
}

/**
 * `/devices?booted=1` -- the running devices, without opening a WebSocket.
 *
 * The protocol offers this endpoint precisely so a caller that only wants the
 * list does not have to speak the streaming protocol to get it. That is exactly
 * this app's position: it shows a list so the reader can pick, and hands the
 * streaming to the client in the web view.
 *
 * `booted=1` and not the full registry: the machine has twenty-nine simulators
 * ever created and five actually running, and a picker that offers the other
 * twenty-four is a picker that mostly offers things that will not appear.
 */
export function simfarmDevicesUrl(gatewayUrl: string | undefined, port: number): string | null {
  const base = simfarmClientUrl(gatewayUrl, port);
  return base === null ? null : `${base}devices?booted=1`;
}

/** `/healthz`, used only to tell "nothing is listening" from "it is there". */
export function simfarmHealthUrl(gatewayUrl: string | undefined, port: number): string | null {
  const base = simfarmClientUrl(gatewayUrl, port);
  return base === null ? null : `${base}healthz`;
}

/**
 * Which simulator a device id belongs to.
 *
 * simfarm namespaces ids by provider (`ios:UUID`, `wechat:appid`), so the kind
 * is readable off the id and the app never has to ask a second endpoint for it.
 * Anything unrecognised is `other` rather than an error -- a provider added to
 * simfarm after this build should show up in the list as a device we cannot
 * label, not vanish from it.
 */
export type SimfarmDeviceKind = 'ios' | 'android' | 'wechat' | 'mock' | 'other';

export function simfarmDeviceKind(id: string): SimfarmDeviceKind {
  const provider = id.split(':', 1)[0];
  if (provider === 'ios' || provider === 'android' || provider === 'wechat' || provider === 'mock') {
    return provider;
  }
  return 'other';
}

export interface SimfarmDevice {
  id: string;
  name: string;
  kind: SimfarmDeviceKind;
}

/**
 * The device list out of a `/devices` body.
 *
 * Tolerant on purpose. This is the one place the app reads a shape owned by a
 * different project on a different release cadence, and the useful failure is a
 * shorter list rather than an empty screen: an entry missing an `id` is dropped,
 * an entry missing a `name` falls back to its id, and anything that is not the
 * expected envelope yields `[]`. A malformed answer must never throw into a
 * render.
 */
export function parseSimfarmDevices(body: unknown): SimfarmDevice[] {
  if (typeof body !== 'object' || body === null) return [];
  const devices = (body as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) return [];

  const parsed: SimfarmDevice[] = [];
  for (const entry of devices) {
    if (typeof entry !== 'object' || entry === null) continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') continue;
    const name = (entry as { name?: unknown }).name;
    parsed.push({
      id,
      name: typeof name === 'string' && name !== '' ? name : id,
      kind: simfarmDeviceKind(id),
    });
  }
  return parsed;
}
