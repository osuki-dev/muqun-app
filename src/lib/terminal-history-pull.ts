import { t } from '@lingui/core/macro';

import { describeGatewayFailure, type GatewayFailure } from './network-error';

/** What a pane-output read hands back (`PaneOutputRead` in `gateway-client`). */
export interface EarlierPullRead {
  output: string;
  read: unknown;
}

/**
 * Whether to ask a pane's captured history whether it has rows: once per ask,
 * and never once a pull knows more -- a cursor in hand, or the last page
 * given -- or the pane turned out not to be captured.
 */
export function capturedProbeDue(pane: {
  off: boolean;
  exhausted: boolean;
  cursor: CapturedCursor | null;
  askedAlready: boolean;
}): boolean {
  return !pane.off && !pane.exhausted && pane.cursor === null && !pane.askedAlready;
}

/** The capability a gateway advertises when it serves captured pane history. */
export const PANE_CAPTURED_HISTORY_CAPABILITY = 'pane_captured_history';

/** One page of `GET /api/sessions/{s}/panes/{p}/history`, as the pull needs it. */
export interface CapturedHistoryPage {
  /** ANSI rows, oldest to newest; never the live screen. */
  rows: string[];
  hasMore: boolean;
  nextBefore: string | null;
  captureEpoch: unknown;
  availability: 'captured' | 'not_captured';
}

/** A captured-history read: the page, or the status the gateway answered with (`null`: no answer). */
export type CapturedHistoryRead =
  | { ok: true; page: CapturedHistoryPage }
  | { ok: false; status: number | null; error: unknown };

/**
 * Where the next captured page starts: the cursor the last page handed over,
 * and the capture it came from. Per pane, in memory only.
 */
export type CapturedCursor = { before: string; epoch: unknown };

/** What a pull learned about the pane's captured history, for the caller to keep. */
export type CapturedOutcome =
  /** A page landed; `cursor` is where the next one starts (null: from the top again). */
  | { kind: 'page'; cursor: CapturedCursor | null; hasMore: boolean }
  /** This pane is not captured (a shell with native scrollback): not asked again. */
  | { kind: 'notCaptured' };

export type EarlierPullOutcome =
  /** A page landed. `origin` says which read it came from. */
  | {
      kind: 'page';
      fetched: EarlierPullRead;
      origin: 'rangePage' | 'page' | 'capturedPage';
      rangeUnsupported: boolean;
      captured?: CapturedOutcome;
    }
  /** It failed after its one retry. Worth a notice with Retry: the next pull may work. */
  | {
      kind: 'failed';
      failure: GatewayFailure;
      rangeUnsupported: boolean;
      captured?: CapturedOutcome;
    }
  /**
   * The gateway answered, and the answer is no: this pane will not page for
   * this backend, or it has given all it has. The pull is withdrawn rather
   * than offered again to fail the same way.
   */
  | {
      kind: 'refused';
      failure: GatewayFailure;
      rangeUnsupported: boolean;
      captured?: CapturedOutcome;
    };

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
 * Captured history goes first where the gateway serves it (see
 * `pullCapturedPage`); what follows is the range/tail path every other pane
 * takes, unchanged.
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
  captured,
}: {
  page: { start: number; end: number } | null;
  readRange: (start: number, end: number) => Promise<EarlierPullRead>;
  readTail: () => Promise<EarlierPullRead>;
  /** Where the served read starts (`paneReadRange(read)?.start`), or null when it says nothing. */
  servedStart: (read: unknown) => number | null;
  /**
   * The gateway's captured history, asked first when the gateway serves it and
   * this pane has not been found uncaptured ({@link pullCapturedPage}).
   */
  captured?: {
    read: (before: string | null) => Promise<CapturedHistoryRead>;
    cursor: CapturedCursor | null;
  };
}): Promise<EarlierPullOutcome> {
  let notCaptured: CapturedOutcome | undefined;
  if (captured) {
    const outcome = await pullCapturedPage(captured.read, captured.cursor);
    if (outcome.kind !== 'notCaptured') return outcome;
    notCaptured = { kind: 'notCaptured' };
  }
  const outcome = await pullServedPage({ page, readRange, readTail, servedStart });
  return notCaptured ? { ...outcome, captured: notCaptured } : outcome;
}

/** A failure for a status the gateway answered with, worded as the app words them. */
function capturedFailure(read: Extract<CapturedHistoryRead, { ok: false }>): GatewayFailure {
  return describeGatewayFailure(read.error);
}

/**
 * The captured-history half of a pull.
 *
 * - The first pull asks with no cursor, later ones with the cursor the last
 *   page handed over; a page from another capture (`capture_epoch` moved, the
 *   gateway restarted) starts over without one.
 * - A page with rows is the page (`'capturedPage'`). A pane the gateway does
 *   not capture (`not_captured`), or a first page that is empty and has no
 *   more, is `notCaptured`: the caller remembers it and the pull goes on to the
 *   range/tail reads, which serve that pane already.
 * - An empty page after pages, or `has_more: false` with nothing: the history
 *   is exhausted (`refused`, the existing notice).
 * - `410` (the cursor is gone) starts over once without the cursor -- rows
 *   already held are dropped by the fold; a second `410` running is `failed`.
 * - `400`/`409`/`413`/`404`: `refused`. `503` and no answer: `failed`.
 */
async function pullCapturedPage(
  read: (before: string | null) => Promise<CapturedHistoryRead>,
  cursor: CapturedCursor | null
): Promise<EarlierPullOutcome | { kind: 'notCaptured' }> {
  let answer = await read(cursor?.before ?? null);
  let first = cursor === null;
  if (!answer.ok && answer.status === 410) {
    first = true;
    answer = await read(null);
    if (!answer.ok && answer.status === 410) {
      return { kind: 'failed', failure: capturedFailure(answer), rangeUnsupported: false };
    }
  }
  if (answer.ok && !first && cursor && answer.page.captureEpoch !== cursor.epoch) {
    // Another capture: the cursor means nothing in it. Start over.
    first = true;
    answer = await read(null);
  }
  if (!answer.ok) {
    const status = answer.status;
    // A 410 here came from a read that started over already: failed, as on the cursor path.
    const refused = status === 400 || status === 404 || status === 409 || status === 413;
    return {
      kind: refused ? 'refused' : 'failed',
      failure: capturedFailure(answer),
      rangeUnsupported: false,
    };
  }
  const { page } = answer;
  if (page.availability === 'not_captured' || (first && page.rows.length === 0 && !page.hasMore)) {
    return { kind: 'notCaptured' };
  }
  if (page.rows.length === 0) {
    return {
      kind: 'refused',
      failure: describeGatewayFailure(new Error('HTTP 404: no more captured history')),
      rangeUnsupported: false,
    };
  }
  return {
    kind: 'page',
    fetched: { output: page.rows.join('\n'), read: null },
    origin: 'capturedPage',
    rangeUnsupported: false,
    captured: {
      kind: 'page',
      cursor: page.nextBefore ? { before: page.nextBefore, epoch: page.captureEpoch } : null,
      hasMore: page.hasMore && page.nextBefore !== null,
    },
  };
}

/** The range and widening-tail reads: what every pane did before captured history. */
async function pullServedPage({
  page,
  readRange,
  readTail,
  servedStart,
}: {
  page: { start: number; end: number } | null;
  readRange: (start: number, end: number) => Promise<EarlierPullRead>;
  readTail: () => Promise<EarlierPullRead>;
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

/**
 * Whether the pull for earlier output is on offer at all.
 *
 * Discovery's `pagedHistory` is deliberately not an input. It says whether the
 * backend serves *range* reads, and a backend that does not -- herdr, whose
 * `pane.read` takes no range -- still pages by the widening tail: asked for
 * more `lines`, it answers with more. Withdrawing the pull on `false` hid
 * history that one more read would have shown (herdr panes holding 459 lines
 * stopped at the first 240). The pull goes when the window's own metrics say
 * there is nothing above it, or when a tail read comes back with nothing new
 * ({@link tailPageFoundNothing}).
 */
export function canOfferHistoryPull({
  canLoadEarlier,
  blocked,
}: {
  /** What the window's own metrics say: there is earlier output to reach. */
  canLoadEarlier: boolean;
  blocked: boolean;
}): boolean {
  return canLoadEarlier && !blocked;
}

/**
 * Whether a pull may ask for a range page: only where discovery has not said
 * the backend cannot serve one. `undefined` -- an older gateway -- still tries,
 * and `pullEarlierPage` falls back to the tail if the range is refused.
 */
export function historyPullUsesRange(pagedHistory: boolean | undefined): boolean {
  return pagedHistory !== false;
}

/**
 * A widening-tail page that came back no longer than the window it was meant
 * to deepen: the backend has no more history to give, whatever its metrics
 * claimed (card #646: herdr plateauing below its own row count). The pull is
 * withdrawn and the reader told so, once.
 */
export function tailPageFoundNothing(
  outcome: EarlierPullOutcome,
  rows: number,
  previousRows: number
): boolean {
  return outcome.kind === 'page' && outcome.origin === 'page' && rows <= previousRows;
}

/** The notice for a pane that has given all the history it has. */
export function historyExhaustedNotice(): HistoryPullNotice {
  return {
    kind: 'exhausted',
    title: t`This terminal has no more history`,
    caption: null,
    retry: false,
    dismissMs: HISTORY_EXHAUSTED_NOTICE_MS,
  };
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
      return historyExhaustedNotice();
  }
}
