/**
 * The sockets behind the preview, kept for a while after the preview closes.
 *
 * ## Why the socket outlives the screen
 *
 * Opening the preview was measured at 770-1640 ms from the tap to a picture,
 * and almost all of it is a chain of round trips that has to be walked in
 * order: open the socket, wait for the device list, send the attach, wait for
 * the server to start its encoder, wait for the first frame. Closing the
 * preview threw the whole chain away, so glancing at the simulator, going
 * back to the terminal and glancing again paid it twice.
 *
 * So a session is not closed when its screen goes. It is *released*: the
 * socket stays open and attached, the last frame it delivered is kept, and
 * only after `graceMs` with nobody holding it is it let go. A screen that
 * comes back inside that window is handed the same session, already live,
 * and the frame it kept -- so the picture is on screen at the first layout
 * and the stream takes over from there. The tile that opens the preview
 * calls `warm` before the route even mounts, for the same reason from the
 * other end: the socket's round trips run under the navigation instead of
 * after it.
 *
 * ## What it costs, and the two things that stop it
 *
 * A held socket is a server still encoding a picture nobody is looking at,
 * for a minute at most, and a JS thread still receiving it. That is the trade,
 * and it is bounded twice over: one idle session at a time (a new one closes
 * the others), and the caller closes every idle session on the two events
 * after which "reopening soon" is no longer likely -- the app going to the
 * background, and the gateway changing. A session whose transport dropped is
 * never kept; there is nothing in it worth keeping.
 *
 * ## Why it is pure
 *
 * Keyed by the socket URL, which is the gateway's host and simfarm's port and
 * nothing else, and driven through an `open` callback that makes the socket,
 * so the whole of the timing -- grace, reuse, release on the two events --
 * can be pinned with a fake socket and a fake clock, like the session it
 * holds.
 */
import { type SimfarmDevice } from '@/lib/simfarm';
import { SimfarmSession, type SimfarmSchedule } from '@/lib/simfarm-session';

/**
 * How long a released session is kept.
 *
 * Long enough for "close, read the terminal, look again"; short enough that a
 * simulator left encoding for nobody stops within the minute.
 */
export const SIMFARM_SESSION_GRACE_MS = 60_000;

/**
 * One socket and the session driving it.
 *
 * `lastFrame` is the newest jpeg the session delivered for the device it is
 * attached to, `null` when there is none -- the session clears it when it
 * lets go of a stream, so a reopened preview never shows a frame of the
 * device before the one it is about to attach to.
 */
export interface SimfarmSessionEntry {
  readonly url: string;
  readonly session: SimfarmSession;
  readonly lastFrame: Uint8Array | null;
  /** Every frame from now on, and `null` when the picture no longer applies. */
  onFrame(listener: (payload: Uint8Array | null) => void): () => void;
}

/** A screen's claim on an entry; `release` starts the grace period. */
export interface SimfarmSessionHold {
  readonly entry: SimfarmSessionEntry;
  release(): void;
}

class Entry implements SimfarmSessionEntry {
  lastFrame: Uint8Array | null = null;
  holders = 0;
  /** The cancel for the grace timer, while one is running. */
  grace: (() => void) | null = null;
  lost = false;
  dead = false;
  readonly session: SimfarmSession;
  private readonly listeners = new Set<(payload: Uint8Array | null) => void>();

  constructor(
    readonly url: string,
    seed: SimfarmDevice[],
    schedule: SimfarmSchedule | undefined
  ) {
    this.session = new SimfarmSession({
      seed,
      schedule,
      onFrame: (payload) => this.frame(payload),
    });
  }

  onFrame(listener: (payload: Uint8Array | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private frame(payload: Uint8Array | null): void {
    // A copy, because the payload is a view on the socket message's buffer
    // and this one is kept past the message.
    const kept = payload === null ? null : payload.slice();
    this.lastFrame = kept;
    for (const listener of this.listeners) listener(kept);
  }
}

const scheduleWithTimers: SimfarmSchedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export class SimfarmSessionCache {
  private readonly entries = new Map<string, Entry>();
  private readonly open: (url: string, session: SimfarmSession) => void;
  private readonly schedule: SimfarmSchedule;
  private readonly graceMs: number;

  constructor(options: {
    /** Make the socket for `url` and wire it to `session`; see `useSimfarmStream`. */
    open: (url: string, session: SimfarmSession) => void;
    schedule?: SimfarmSchedule;
    graceMs?: number;
  }) {
    this.open = options.open;
    this.schedule = options.schedule ?? scheduleWithTimers;
    this.graceMs = options.graceMs ?? SIMFARM_SESSION_GRACE_MS;
  }

  /**
   * Open the socket for `url` now, for a screen that is about to ask for it.
   *
   * Nothing holds it, so the grace period starts at once: a screen that never
   * arrives -- the probe said no, the route was left -- costs one socket for
   * one grace period, and one that does arrive finds it open.
   */
  warm(url: string, seed: SimfarmDevice[] = []): void {
    const existing = this.entries.get(url);
    if (existing !== undefined) {
      existing.session.seed(seed);
      return;
    }
    const entry = this.create(url, seed);
    this.startGrace(entry);
  }

  /** The session for `url`, opened now if there is none, held until `release`. */
  acquire(url: string, seed: SimfarmDevice[] = []): SimfarmSessionHold {
    let entry = this.entries.get(url);
    if (entry === undefined) entry = this.create(url, seed);
    else entry.session.seed(seed);
    entry.holders += 1;
    this.cancelGrace(entry);
    let released = false;
    return {
      entry,
      release: () => {
        if (released) return;
        released = true;
        entry.holders -= 1;
        if (entry.holders > 0) return;
        if (entry.lost) this.drop(entry);
        else this.startGrace(entry);
      },
    };
  }

  /** Let go of every session nobody is holding. */
  closeIdle(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.holders === 0) this.drop(entry);
    }
  }

  /** How many sessions are open, held or not. */
  get size(): number {
    return this.entries.size;
  }

  /** Whether `url` has a session open that nobody is holding. */
  isIdle(url: string): boolean {
    const entry = this.entries.get(url);
    return entry !== undefined && entry.holders === 0;
  }

  private create(url: string, seed: SimfarmDevice[]): Entry {
    // One idle socket at a time: a preview of another machine is the moment
    // the last one stopped being "about to be reopened".
    this.closeIdle();
    const entry = new Entry(url, seed, this.schedule);
    this.entries.set(url, entry);
    entry.session.subscribe((state) => {
      if (state.status !== 'lost' || entry.lost) return;
      entry.lost = true;
      // Nothing to keep: the screen holding it is told, and lets go in its
      // own time; an idle one is dropped now.
      if (entry.holders === 0) this.drop(entry);
    });
    this.open(url, entry.session);
    return entry;
  }

  private startGrace(entry: Entry): void {
    this.cancelGrace(entry);
    entry.grace = this.schedule(() => {
      entry.grace = null;
      this.drop(entry);
    }, this.graceMs);
  }

  private cancelGrace(entry: Entry): void {
    if (entry.grace === null) return;
    entry.grace();
    entry.grace = null;
  }

  private drop(entry: Entry): void {
    // Releasing the session closes its socket, and a closing socket reports
    // itself dropped -- which lands back here through the subscription above.
    if (entry.dead) return;
    entry.dead = true;
    this.cancelGrace(entry);
    if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
    entry.lastFrame = null;
    entry.session.release();
  }
}
