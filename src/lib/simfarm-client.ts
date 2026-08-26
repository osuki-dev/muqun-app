import {
  allowsSimfarmPreview,
  parseSimfarmDevices,
  simfarmDevicesUrl,
  simfarmHealthUrl,
  type SimfarmDevice,
} from '@/lib/simfarm';

/**
 * Asking a machine whether it has a simfarm on it, and what is running there.
 *
 * The I/O half of `simfarm.ts`, kept apart from it for the reason that file is
 * arithmetic: the URL rules are worth pinning exactly and a test of them should
 * not need a network. What is here is the two requests and, more importantly,
 * what the app is allowed to conclude from them.
 *
 * ## Why there is a probe at all
 *
 * Because most of the time there is nothing to configure. simfarm has a default
 * port and the machine is already on the tailnet, so the common case is that the
 * answer is simply yes -- and asking someone to type `8801` to be told what the
 * app could have found out for itself is a form the app did not need to show.
 *
 * The probe therefore decides between two behaviours, not between working and
 * broken: open it, or ask. A `no` is never an error to report; it is the reason
 * a port field appears.
 */

/**
 * How long the probe waits before deciding there is nothing there.
 *
 * A tailnet host answers `/healthz` in single-digit milliseconds when it is
 * listening, and when nothing is bound the connection is refused immediately --
 * so the only case this timeout actually covers is a host that is reachable but
 * wedged. Two seconds is long enough for a sleeping Mac's first packet and short
 * enough that the sheet does not feel like it hung before showing the field.
 */
export const SIMFARM_PROBE_TIMEOUT_MS = 2000;

export type SimfarmProbe =
  | { found: true; devices: SimfarmDevice[]; booted: number }
  /**
   * `blocked` is the connection failing the gate rather than the machine
   * failing to answer, and it is deliberately distinct: the app must not offer
   * the port field on such a connection either. Nothing about typing a number
   * makes an unauthenticated surface safe to open across a network nobody
   * vouched for.
   */
  | { found: false; reason: 'blocked' | 'unreachable' | 'not-simfarm' };

/**
 * Whether `port` on this gateway's host is a simfarm, and what it has booted.
 *
 * Both requests are made because they answer different questions and the second
 * is the one worth showing: `/healthz` says something is listening and speaks
 * this protocol, `/devices` says whether there is anything on it to look at. A
 * simfarm with nothing booted is still `found` -- the reader may be about to
 * boot a simulator, and hiding the preview because the list is momentarily
 * empty would be the app deciding that for them.
 */
export async function probeSimfarm(
  gatewayUrl: string | undefined,
  port: number,
  protection: string | undefined
): Promise<SimfarmProbe> {
  if (!allowsSimfarmPreview(protection)) return { found: false, reason: 'blocked' };

  const health = simfarmHealthUrl(gatewayUrl, port);
  const devices = simfarmDevicesUrl(gatewayUrl, port);
  if (health === null || devices === null) return { found: false, reason: 'unreachable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIMFARM_PROBE_TIMEOUT_MS);
  try {
    const healthResponse = await fetch(health, { signal: controller.signal });
    if (!healthResponse.ok) return { found: false, reason: 'not-simfarm' };
    const healthBody: unknown = await healthResponse.json();
    // `ok` is simfarm's own answer about itself. Something else listening on
    // this port will not have it, and a 200 from an unrelated server is exactly
    // the case that would otherwise put a broken web view on screen.
    if (typeof healthBody !== 'object' || healthBody === null) {
      return { found: false, reason: 'not-simfarm' };
    }
    if ((healthBody as { ok?: unknown }).ok !== true) {
      return { found: false, reason: 'not-simfarm' };
    }

    const devicesResponse = await fetch(devices, { signal: controller.signal });
    // The device list failing is not the preview failing: health already said
    // this is a simfarm, and the client in the web view fetches its own list
    // anyway. An empty list here only means the picker opens empty.
    const parsed = devicesResponse.ok
      ? parseSimfarmDevices((await devicesResponse.json()) as unknown)
      : [];
    return { found: true, devices: parsed, booted: parsed.length };
  } catch {
    // Refused, timed out, DNS, TLS, malformed JSON -- all the same decision from
    // here, which is to show the port field. Distinguishing them would give the
    // reader a diagnosis they cannot act on differently.
    return { found: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
