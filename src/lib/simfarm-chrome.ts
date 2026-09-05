/**
 * The chrome over the simulator's picture: whether it is out, and when it puts
 * itself away.
 *
 * "Chrome" is the two rows that are not the device -- the pill naming it at
 * the top with the picker and the close button, and the key row along the
 * bottom with home, back and the rest. Both float over the picture, and on a
 * full-screen preview that is the whole reason they have to be able to go:
 * the picture fills the phone, so anything left on top of it is standing on
 * the app under test.
 *
 * ## The rule for what toggles it
 *
 * **A touch on the picture is the device's. Only the two handles toggle the
 * chrome.**
 *
 * The obvious alternative -- tap the picture away from any control to toggle
 * -- was tried in thought and rejected, because there is no way to tell that
 * tap from a tap meant for the app under test. Every tap on the picture is
 * forwarded verbatim, and a tap that also toggled the chrome would be a tap
 * the device received *and* the chrome answered; a tap that toggled the
 * chrome *instead* would be one the device silently missed, which on a phone
 * is the worst thing this preview can do. So the picture never toggles
 * anything. Each edge keeps a slim handle -- the top one in the band the
 * camera cutout already takes, above the picture; the bottom one just above
 * the home indicator, over the last few points of it -- and a handle is the
 * one thing that is never a device tap: it is drawn over the picture and
 * takes the press, so nothing under it is asked. Both handles toggle both
 * rows -- the chrome is one thing that is out or away, not two things with
 * two states. Precisely: a touch anywhere on the stage is forwarded to the
 * device unless it lands on a handle (72x22pt, centred on the top or bottom
 * edge band) or, while the rows are out, on a control in them.
 *
 * ## When it goes away on its own
 *
 * The rows come out on every open, so the reader can see what is there, and
 * they put themselves away a few seconds after the chrome was last *used* --
 * not after the device was last touched. Driving the app under test is the
 * reader's business, and a control strip that reappeared every time they
 * stopped scrolling would be one that was never out of the way. Using a
 * control starts the countdown again; opening something inside the chrome
 * (the picker, the text composer) holds it out until that is closed, because
 * a list that slid off the screen while being read is a defect, not a
 * timeout.
 *
 * ## Why it is a class with a clock in it
 *
 * For the same reason `SimfarmSession` is: the interesting part is the
 * timing, and the timing is worth a test that says "the handle, then four
 * seconds, then nothing" without a component, a gesture or a real timer.
 */
import { type SimfarmSchedule } from '@/lib/simfarm-session';

/**
 * How long the chrome stays out after it was last used.
 *
 * Long enough to read the device's name and reach a key; short enough that a
 * reader who came to look at the app is looking at the app before their next
 * scroll. Video players settle around three; this is a little more because
 * the pill has words in it.
 */
export const SIMFARM_CHROME_TIMEOUT_MS = 4000;

/**
 * How the chrome moves between its two states.
 *
 * With motion reduced it does not slide at all: the rows fade where they are,
 * over the shortest token, which is the substitute the platform guidelines
 * ask for -- a crossfade is not a movement -- and is deliberately not the
 * instant jump `ReduceMotion.System` would otherwise make of the timing. A
 * control strip that blinked into existence with no transition reads as a
 * glitch on a screen that is a live picture.
 */
export function simfarmChromeTransition(reduceMotion: boolean): {
  duration: 'micro' | 'short';
  slide: boolean;
} {
  return reduceMotion ? { duration: 'micro', slide: false } : { duration: 'short', slide: true };
}

/** What the reader last left the chrome as, for the life of the app. */
let remembered = true;

/**
 * Whether the chrome should start out.
 *
 * Remembered for the process rather than persisted: a reader who put the
 * controls away and reopens the preview a minute later gets the picture, and
 * a reader who opens the app tomorrow gets the controls, because the handle
 * is the one thing on this screen that has to be found once.
 */
export function recallSimfarmChrome(): boolean {
  return remembered;
}

export function rememberSimfarmChrome(shown: boolean): void {
  remembered = shown;
}

export class SimfarmChrome {
  private shown: boolean;
  private held = false;
  private cancel: (() => void) | null = null;
  private readonly listeners = new Set<(shown: boolean) => void>();
  private readonly schedule: SimfarmSchedule;
  private readonly timeoutMs: number;

  constructor(options: { shown?: boolean; schedule?: SimfarmSchedule; timeoutMs?: number } = {}) {
    this.shown = options.shown ?? true;
    this.schedule = options.schedule ?? scheduleWithTimers;
    this.timeoutMs = options.timeoutMs ?? SIMFARM_CHROME_TIMEOUT_MS;
    this.arm();
  }

  get isShown(): boolean {
    return this.shown;
  }

  subscribe(listener: (shown: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A handle was pressed. */
  toggle(): void {
    this.set(!this.shown);
  }

  show(): void {
    this.set(true);
  }

  hide(): void {
    this.set(false);
  }

  /** A control in the chrome was used: the countdown starts over. */
  touched(): void {
    if (!this.shown) return;
    this.arm();
  }

  /**
   * Something inside the chrome is open -- the picker, the composer -- and
   * the chrome stays out for as long as it is. Closing it starts the
   * countdown from the top.
   */
  hold(open: boolean): void {
    if (this.held === open) return;
    this.held = open;
    if (open) this.disarm();
    else this.arm();
  }

  /** Let go of the timer; the owner is going away. */
  dispose(): void {
    this.disarm();
    this.listeners.clear();
  }

  private set(shown: boolean): void {
    if (this.shown === shown) {
      // Pressing the handle while the chrome is already out is still a use of
      // it, and a use of it earns the full countdown again.
      if (shown) this.arm();
      return;
    }
    this.shown = shown;
    if (shown) this.arm();
    else this.disarm();
    for (const listener of this.listeners) listener(shown);
  }

  private arm(): void {
    this.disarm();
    if (!this.shown || this.held) return;
    this.cancel = this.schedule(() => {
      this.cancel = null;
      this.set(false);
    }, this.timeoutMs);
  }

  private disarm(): void {
    this.cancel?.();
    this.cancel = null;
  }
}

const scheduleWithTimers: SimfarmSchedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};
