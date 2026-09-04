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
 * The nine colours simfarm's client will adopt, in its own vocabulary.
 *
 * Its `?theme=` is base64url JSON, read before the first paint precisely so the
 * panel does not flash the wrong colour -- which is the same problem this app
 * solves with its splash overlay. The keys are simfarm's; the values are this
 * app's semantic tokens, and the mapping is one-to-one because both palettes are
 * built on the same idea of what a colour is *for* rather than what it is.
 *
 * `accent` is deliberately the app's primary. simfarm reserves it for the status
 * dot and says so: it is the one saturated colour with no semantic meaning
 * there, and letting it onto borders is how an instrument stops being neutral.
 * That is the same rule this app applies to its own accent, so handing it over
 * is safe.
 */
export interface SimfarmThemeColors {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
}

/** base64url: standard base64 with `-_` for `+/`, and no padding. */
function base64Url(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  // The JSON is hex colours and ASCII keys, so UTF-8 is one byte per character
  // and a full encoder would be weight with nothing to carry. Anything outside
  // ASCII would be a bug in the caller, not a colour.
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) bytes.push(value.charCodeAt(i) & 0x7f);

  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    out += alphabet[(chunk >> 18) & 63] + alphabet[(chunk >> 12) & 63];
    if (left > 1) out += alphabet[(chunk >> 6) & 63];
    if (left > 2) out += alphabet[chunk & 63];
  }
  return out;
}

/**
 * The client URL with this app's palette on it.
 *
 * Falls back to the bare URL when there is no gateway or no port, so a caller
 * never has to guard two things. A malformed parameter is simfarm's problem to
 * ignore -- its own comment says a bad `?theme=` keeps the defaults rather than
 * taking the page down -- but there is no reason to hand it one.
 */
export function simfarmThemedClientUrl(
  gatewayUrl: string | undefined,
  port: number,
  colors: SimfarmThemeColors
): string | null {
  const base = simfarmClientUrl(gatewayUrl, port);
  if (base === null) return null;
  const theme = {
    bg: colors.background,
    bgAlt: colors.surface,
    fg: colors.text,
    fgDim: colors.textMuted,
    line: colors.border,
    accent: colors.primary,
    ok: colors.success,
    warn: colors.warning,
    bad: colors.danger,
  };
  return `${base}?theme=${base64Url(JSON.stringify(theme))}`;
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
