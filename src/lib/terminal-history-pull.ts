import { t } from '@lingui/core/macro';

import { describeGatewayFailure, type GatewayFailure } from './network-error';

/** What a pane-output read hands back (`PaneOutputRead` in `gateway-client`). */
export interface EarlierPullRead {
  output: string;
  read: unknown;
}

export type EarlierPullOutcome =
  /** A page landed. `origin` says whether it is the range page asked for or a widening tail. */
  | {
      kind: 'page';
      fetched: EarlierPullRead;
      origin: 'rangePage' | 'page';
      rangeUnsupported: boolean;
    }
  /** It failed after its one retry. Worth a notice with Retry: the next pull may work. */
  | { kind: 'failed'; failure: GatewayFailure; rangeUnsupported: boolean }
  /**
   * The gateway answered, and the answer is no: this pane will not page for
   * this backend. The pull is withdrawn rather than offered again to fail the
   * same way.
   */
  | { kind: 'refused'; failure: GatewayFailure; rangeUnsupported: boolean };

/** No answer reached the app -- the one kind of failure the same request can cure by being sent again. */
function noAnswer(failure: GatewayFailure): boolean {
  return failure.kind === 'timeout' || failure.kind === 'network';
}

async function attempt(
  read: () => Promise<EarlierPullRead>
): Promise<{ ok: true; value: EarlierPullRead } | { ok: false; failure: GatewayFailure }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, failure: describeGatewayFailure(error) };
  }
}

/**
 * One pull for earlier terminal output, from request to verdict.
 *
 * The range read goes first when there is a page to ask for. A gateway that
 * *answers* it with an error has refused range addressing for this backend --
 * the Mac's tmux has no `capture-pane -F`, which the gateway's range path
 * needs, and every range read there came back `502 backend_error` -- so that
 * answer is remembered (`rangeUnsupported`) and the same pull falls through
 * to the widening tail, which the same backend serves without complaint. Only
 * a failure with no answer at all (timeout, network) is the same question
 * worth asking again, and it is asked again exactly once.
 *
 * The tail read is the last resort: a transient failure gets its one retry,
 * a server fault ends as `failed` (a notice with Retry), and a request the
 * gateway rejects outright (`4xx`) ends as `refused` -- there is no other
 * question left to ask this pane for its history.
 */
export async function pullEarlierPage({
  page,
  readRange,
  readTail,
  servedStart,
}: {
  page: { start: number; end: number } | null;
  readRange: (start: number, end: number) => Promise<EarlierPullRead>;
  readTail: () => Promise<EarlierPullRead>;
  /** Where the served read starts (`paneReadRange(read)?.start`), or null when it says nothing. */
  servedStart: (read: unknown) => number | null;
}): Promise<EarlierPullOutcome> {
  let rangeUnsupported = false;
  if (page) {
    let ranged = await attempt(() => readRange(page.start, page.end));
    if (!ranged.ok && noAnswer(ranged.failure)) {
      ranged = await attempt(() => readRange(page.start, page.end));
    }
    if (ranged.ok) {
      // A backend can accept `start`/`end` and still answer with its own tail
      // (herdr's does): only a read that starts where the page does is one.
      if (servedStart(ranged.value.read) === page.start) {
        return { kind: 'page', fetched: ranged.value, origin: 'rangePage', rangeUnsupported };
      }
      rangeUnsupported = true;
    } else if (ranged.failure.needsPairing || noAnswer(ranged.failure)) {
      // Pairing again is the remedy, or the gateway was not reached twice
      // running: a tail read now would only fail the same way.
      return { kind: 'failed', failure: ranged.failure, rangeUnsupported };
    } else {
      rangeUnsupported = true;
    }
  }

  let tail = await attempt(readTail);
  if (!tail.ok && tail.failure.retryable) tail = await attempt(readTail);
  if (tail.ok) return { kind: 'page', fetched: tail.value, origin: 'page', rangeUnsupported };
  if (tail.failure.retryable || tail.failure.needsPairing) {
    return { kind: 'failed', failure: tail.failure, rangeUnsupported };
  }
  return { kind: 'refused', failure: tail.failure, rangeUnsupported };
}

/**
 * What moves the pull's gate. A pull that ended without a page closes it, so
 * the gesture is neither offered nor fired again into the same failure; a
 * page, a reconnect or another pane opens it. The notice's own Retry is the
 * one explicit way through a closed gate.
 */
export type HistoryPullEvent = 'page' | 'failed' | 'refused' | 'reconnected' | 'paneChanged';

/** Whether the pull is blocked after `event`. */
export function historyPullBlockedAfter(event: HistoryPullEvent): boolean {
  return event === 'failed' || event === 'refused';
}

/** The pane's backend, as discovery states it: `false` only when the gateway said no. */
export function backendPagesHistory(
  plane: { backends: readonly { sessionId: string; pagedHistory?: boolean }[] } | null | undefined,
  sessionId: string
): boolean | undefined {
  return plane?.backends.find((backend) => backend.sessionId === sessionId)?.pagedHistory;
}

/** Whether the pull for earlier output is on offer at all. */
export function canOfferHistoryPull({
  canLoadEarlier,
  blocked,
  pagedHistory,
}: {
  /** What the window's own metrics say: there is earlier output to reach. */
  canLoadEarlier: boolean;
  blocked: boolean;
  /** Discovery's word for this backend; `undefined` is unknown and does not withdraw it. */
  pagedHistory: boolean | undefined;
}): boolean {
  return canLoadEarlier && !blocked && pagedHistory !== false;
}

/** What the terminal's notice slot says about a pull that did not land a page. */
export interface HistoryPullNotice {
  kind: 'failed' | 'exhausted';
  title: string;
  /** The gateway's own reason, under the title. Never the title: it is not the app's sentence. */
  caption: string | null;
  /** A Retry that can work: never offered when pairing again is the remedy. */
  retry: boolean;
  /** How long it stays before it leaves on its own. */
  dismissMs: number;
}

export const HISTORY_FAILED_NOTICE_MS = 6000;
export const HISTORY_EXHAUSTED_NOTICE_MS = 3000;

export function historyPullNotice(outcome: EarlierPullOutcome): HistoryPullNotice | null {
  switch (outcome.kind) {
    case 'page':
      return null;
    case 'failed':
      return {
        kind: 'failed',
        title: t`Could not load older history from this terminal`,
        caption: outcome.failure.message || null,
        retry: !outcome.failure.needsPairing,
        dismissMs: HISTORY_FAILED_NOTICE_MS,
      };
    case 'refused':
      return {
        kind: 'exhausted',
        title: t`This terminal has no more history`,
        caption: null,
        retry: false,
        dismissMs: HISTORY_EXHAUSTED_NOTICE_MS,
      };
  }
}
