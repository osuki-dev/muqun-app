import {
  simfarmContainsPoint,
  type SimfarmPlacement,
  type SimfarmPoint,
} from '@/lib/simfarm-frame';
import { SIMFARM_TOUCH_PHASE, type SimfarmTouchPhase } from '@/lib/simfarm-protocol';

type ForwardTouch = (phase: SimfarmTouchPhase, x: number, y: number) => void;
type ScheduleTouch = (run: () => void, delayMs: number) => () => void;

const scheduleTouch: ScheduleTouch = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

/** JS-side ownership is synchronous: a fast tap must finish before the next UI-runtime tick. */
export class SimfarmTouchTracker {
  private held: SimfarmPoint | null = null;
  private pending: SimfarmPoint | null = null;
  private cancelBegin: (() => void) | null = null;
  private beganAt = 0;
  private ending: { point: SimfarmPoint; forward: ForwardTouch; cancel: () => void } | null = null;
  private viewer = false;

  constructor(
    private readonly schedule: ScheduleTouch = scheduleTouch,
    private readonly now: () => number = Date.now
  ) {}

  down(
    point: SimfarmPoint,
    count: number,
    placed: SimfarmPlacement | null,
    forward: ForwardTouch
  ): boolean {
    if (count > 1) {
      this.viewer = true;
      this.cancelPending();
      this.finish(forward, true);
      return false;
    }
    if (this.viewer || placed === null || !simfarmContainsPoint(point, placed)) return false;
    this.flushEnd();
    // Let a second finger claim a pinch before its first finger becomes a remote tap.
    // A quick one-finger tap is still sent immediately on release; a drag starts on movement.
    this.pending = point;
    this.cancelBegin = this.schedule(() => this.begin(forward), 75);
    return true;
  }

  move(point: SimfarmPoint, count: number, forward: ForwardTouch): void {
    if (this.viewer || count !== 1) return;
    this.begin(forward);
    if (this.held === null) return;
    this.held = point;
    forward(SIMFARM_TOUCH_PHASE.MOVE, point.x, point.y);
  }

  up(point: SimfarmPoint | undefined, count: number, forward: ForwardTouch): void {
    this.begin(forward);
    if (this.held !== null && point !== undefined) this.held = point;
    this.finish(forward);
    if (count === 0) this.viewer = false;
  }

  cancel(forward: ForwardTouch): void {
    this.cancelPending();
    this.finish(forward, true);
    this.flushEnd();
    this.viewer = false;
  }

  private begin(forward: ForwardTouch): void {
    const point = this.pending;
    this.cancelPending();
    if (point === null) return;
    this.held = point;
    this.beganAt = this.now();
    forward(SIMFARM_TOUCH_PHASE.BEGIN, point.x, point.y);
  }

  private cancelPending(): void {
    this.cancelBegin?.();
    this.cancelBegin = null;
    this.pending = null;
  }

  private finish(forward: ForwardTouch, immediate = false): void {
    const point = this.held;
    this.held = null;
    if (point === null) return;
    const remaining = immediate ? 0 : Math.max(0, 32 - (this.now() - this.beganAt));
    if (remaining === 0) {
      forward(SIMFARM_TOUCH_PHASE.END, point.x, point.y);
      return;
    }
    // HID can coalesce a down/up pair emitted in the same tick. Keep a short
    // complete pulse for quick taps while real drags retain their own timing.
    this.ending = {
      point,
      forward,
      cancel: this.schedule(() => {
        this.ending = null;
        forward(SIMFARM_TOUCH_PHASE.END, point.x, point.y);
      }, remaining),
    };
  }

  private flushEnd(): void {
    const ending = this.ending;
    if (ending === null) return;
    this.ending = null;
    ending.cancel();
    ending.forward(SIMFARM_TOUCH_PHASE.END, ending.point.x, ending.point.y);
  }
}
