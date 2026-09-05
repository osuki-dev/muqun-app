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
 * The one command that starts a simfarm the phone can actually reach.
 *
 * Printed in the preview's empty state, for the same reason the pairing screen
 * prints the Gateway's install line: the reader is holding a phone in front of
 * the machine that is missing the thing, and sending them to a web page on the
 * phone to be told what to type on the laptop is the detour that makes a screen
 * read as a dead end.
 *
 * ── WHY IT IS A COMMAND AND NOT A LINK ──────────────────────────────────────
 * There is no simfarm install URL to print. It is a separate project published
 * to npm, `muqun.dev` says nothing about it, and `muqun.dev/simfarm.sh` is a
 * 404 -- checked on 2026-09-05, unauthenticated, along with the site root,
 * which contains the word nowhere. `links.ts` explains at length what a URL
 * that does not answer costs this app in review, so this file prints the
 * command npm already resolves and invents no address at all.
 *
 * ── WHY THESE FLAGS AND NOT `simfarm` ON ITS OWN ────────────────────────────
 * Both defaults are wrong for a reader who is looking at this string. simfarm
 * binds `127.0.0.1` and enables only its mock device, so the bare command
 * starts a server this phone cannot reach, holding nothing worth reaching --
 * and the reader would be back on this screen with the number they already
 * typed. `--host 0.0.0.0` and a real provider list are simfarm's own documented
 * shape for reaching it from another machine.
 *
 * WeChat is left off deliberately. It is the one backend that needs launch
 * flags on another application before it can be probed at all, so putting it in
 * the line everybody copies would hand most readers a start-up error for a
 * device that was never going to appear. It is `--providers ios,android,wechat`
 * for anyone who has done that setup.
 *
 * The port is not in it. 8801 is simfarm's default and this app's, so a command
 * carrying it would be a flag that changes nothing in the case it is printed
 * for -- and the port field below the command is where a different number goes.
 */
export const SIMFARM_RUN_COMMAND = 'npx simfarm --host 0.0.0.0 --providers ios,android';

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

/**
 * `ws://host:port/v1` -- the one data channel, and the only thing the preview
 * opens now that it draws the picture itself.
 *
 * Built from the same base as every other URL here rather than assembled from
 * parts, so an IPv6 literal keeps its brackets in the one place it is easiest
 * to get wrong. `https` becomes `wss` for the same reason `webServiceUrl` keeps
 * the scheme: a gateway the operator put behind TLS must not have its simulator
 * stream quietly dropped onto a plain socket beside it.
 */
export function simfarmSocketUrl(gatewayUrl: string | undefined, port: number): string | null {
  const base = simfarmClientUrl(gatewayUrl, port);
  if (base === null) return null;
  return `${base.replace(/^http/, 'ws')}v1`;
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
  if (
    provider === 'ios' ||
    provider === 'android' ||
    provider === 'wechat' ||
    provider === 'mock'
  ) {
    return provider;
  }
  return 'other';
}

/**
 * What a device can be asked to do, in the subset the preview acts on.
 *
 * Declarative on simfarm's side and treated that way here: the three backends
 * differ a great deal, so the preview offers a control only when the device it
 * is attached to says the control exists. `video` is the one that decides
 * whether there is a picture at all -- see `SIMFARM_CODEC`.
 */
export interface SimfarmCapabilities {
  video: string[];
  text: boolean;
  buttons: string[];
}

/** The size of the picture, already rotated upright. Pixels, not points. */
export interface SimfarmScreen {
  width: number;
  height: number;
  scale: number;
}

export interface SimfarmDevice {
  id: string;
  name: string;
  kind: SimfarmDeviceKind;
  /** `booted` is the only state that can be attached to without booting first. */
  booted: boolean;
  screen?: SimfarmScreen;
  capabilities: SimfarmCapabilities;
}

/**
 * The codec the preview asks for, and the only one it can draw.
 *
 * Not a preference. simfarm's own client reaches for h264 and falls back to
 * jpeg when `VideoDecoder` is missing, which over a plain-http tailnet is
 * always -- so the fallback was the real path even before this app drew
 * anything itself. Hermes has no video decoder at all, so jpeg is not a
 * fallback here, it is the requirement, and a device that cannot offer it says
 * so in `capabilities.video` and gets a sentence instead of a black rectangle.
 */
export const SIMFARM_CODEC = 'jpeg';

/** Whether this device can be drawn at all; see `SIMFARM_CODEC`. */
export function simfarmCanStream(device: SimfarmDevice): boolean {
  return device.capabilities.video.includes(SIMFARM_CODEC);
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
      booted: (entry as { state?: unknown }).state === 'booted',
      screen: parseScreen((entry as { screen?: unknown }).screen),
      capabilities: parseCapabilities((entry as { capabilities?: unknown }).capabilities),
    });
  }
  return parsed;
}

/**
 * The screen block, or nothing.
 *
 * A device that is shut down has no screen and says so by omitting it, so the
 * absence is ordinary rather than a defect -- and a partial one is treated as
 * absent, because half a size is not a size the picture can be laid out with.
 * The `screen` event that arrives after attach is authoritative anyway; this is
 * only what the picker has to go on beforehand.
 */
function parseScreen(value: unknown): SimfarmScreen | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { width, height, scale } = value as Record<string, unknown>;
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!(width > 0) || !(height > 0)) return undefined;
  return {
    width,
    height,
    scale: typeof scale === 'number' && scale > 0 ? scale : 1,
  };
}

/**
 * Capabilities, defaulting to "cannot".
 *
 * The direction matters. A capability this app failed to read is one it must
 * not offer a control for: the wrong way round, an older or newer simfarm gets
 * a text field that silently does nothing, and the reader is back to pressing
 * things that have no effect.
 */
function parseCapabilities(value: unknown): SimfarmCapabilities {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    video: stringList(record.video),
    text: record.text === true,
    buttons: stringList(record.buttons),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
