/**
 * Asking, from the phone, whether anything is actually listening on a port.
 *
 * The "from the phone" is the entire point and the reason this is not a gateway
 * request. A gateway-side check would connect to the port over loopback and
 * succeed for a dev server bound to `127.0.0.1` -- the one case a developer most
 * needs to be warned about, reported as fine. The phone is what will open the
 * URL, so the phone is what has to ask, over the same tailnet path the browser
 * will take.
 *
 * This lives apart from `web-service.ts` because it is the impure half: it
 * imports the native fetch, so a `bun test` importing it would not resolve.
 */
import { fetch as nitroFetch } from 'react-native-nitro-fetch';

/**
 * What the phone found, which is deliberately not a pass/fail.
 *
 * `answered` means something spoke HTTP -- any status at all, including 404 and
 * 500. A dev server that has no route at `/` still proves it is there and
 * reachable, and that is the only question being asked.
 *
 * `silent` means the connection failed or ran out of time. It is named for what
 * was observed rather than concluded, because from here a refused connection, a
 * server bound to loopback, a firewall and nothing running at all are the same
 * event. Anything that claimed to tell them apart would be guessing.
 */
export type WebServiceProbe = 'answered' | 'silent';

/**
 * How long the phone waits before calling it silent.
 *
 * Short, because this sits between a tap and a browser opening, and because the
 * honest answer to a slow one is still to offer the open. A service on the same
 * tailnet either answers in well under this or is not going to.
 */
export const WEB_SERVICE_PROBE_TIMEOUT_MS = 3000;

/**
 * Whether anything answers HTTP at `url` from this device.
 *
 * Never throws and never rejects. A probe exists to inform the copy above the
 * button, not to gate it: the caller is required to keep offering the open
 * either way, so a failure here has to be a value rather than an exception that
 * a caller could forget to catch.
 *
 * The body is not read. Headers are enough to prove something is there, and a
 * dev server's index page can be megabytes that would be downloaded on someone's
 * connection for no reason.
 */
export async function probeWebService(
  url: string,
  timeoutMs: number = WEB_SERVICE_PROBE_TIMEOUT_MS
): Promise<WebServiceProbe> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await nitroFetch(url, { method: 'GET', signal: controller.signal });
    return 'answered';
  } catch {
    return 'silent';
  } finally {
    // Cleared on every path, including the answered one: a timer left armed
    // would abort a request that has already finished and, on a sheet the
    // reader has since closed, keep the JS context awake for nothing.
    clearTimeout(deadline);
  }
}
