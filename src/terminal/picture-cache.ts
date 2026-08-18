/**
 * Who owns the terminal's recorded blocks, and when one is allowed to be freed.
 *
 * A recorded block is an `SkPicture`: a native display list holding real memory
 * the JS heap cannot see. Two things want opposite guarantees from it.
 *
 * - Memory wants it freed the instant it is superseded. A streaming pane retires
 *   a block per frame, and letting those pile up is what OOM-killed the app in
 *   card #557.
 * - Correctness wants it never freed while any scene can still draw it. The
 *   canvas replays its command list on the UI thread (this canvas has an
 *   animated transform, so react-native-skia's `ReanimatedRecorder` drives it
 *   from Reanimated), and `JsiSkCanvas::drawPicture` resolves the picture through
 *   `getObject()`, which for a disposed object throws
 *   `std::runtime_error("Attempted to access a disposed object.")`
 *   (react-native-skia 2.10.0, `cpp/api/JsiSkNativeObjects.h:393`). That throw
 *   happens on the UI thread, inside no JS call stack -- outside every React
 *   error boundary, outside the RN exception handler. It is a native abort.
 *
 * The rule that satisfies both, and the only one this module implements:
 *
 *   **A display list is freed only after a committed frame has stopped drawing
 *   it -- never merely because a render, an unmount or a teardown said so.**
 *
 * Which means, concretely:
 *
 * 1. The render phase is additive. `get`/`has`/`add` never remove, replace or
 *    free anything, so a render React discards (concurrent rendering does this
 *    routinely, and React Compiler is on) can at worst leave behind a recording
 *    nothing asked for. It cannot retire a block the committed frame is drawing.
 * 2. `retain` is the only thing that retires, and it takes the keys of the frame
 *    that was *committed*. Everything else is queued.
 * 3. `sweep` frees from that queue, and the caller defers it by a frame so the
 *    scene the retirement replaced has finished drawing.
 * 4. Teardown frees nothing. A pane leaving the screen -- which, since the chat
 *    view became the default for agent panes, happens about a second after every
 *    entry into the service screen -- drops its references and lets the GC do
 *    it. react-native-skia 2.10 reports each picture's `approximateBytesUsed()`
 *    to Hermes as external memory pressure (`cpp/jsi/NativeObject.h:337`), so
 *    the collector sees exactly the bytes that used to be invisible to it, and
 *    `~JsiSkPicture` dispatches the free back to the thread that made it.
 *    Freeing them eagerly instead means racing the canvas's own teardown across
 *    two threads for a bounded, one-off set of blocks, and losing that race is
 *    the abort above.
 *
 * Kept out of the component and Skia-free (the picture is a type parameter with
 * one optional method) for the same reason `chunk-plan.ts` is: the part with the
 * invariant in it should be the part that has tests.
 */

/**
 * All this needs of a display list.
 *
 * `dispose` is optional on purpose. react-native-skia declares it on every
 * object's TypeScript type from a shared base, but the native host objects
 * install it one class at a time via `installCommon` in `definePrototype` --
 * `JsiSkParagraphBuilder` famously does not, and calling it there is a runtime
 * `TypeError`. `SkPicture` does install it (`cpp/api/JsiSkPicture.h:105`), which
 * was checked rather than assumed, and the optional call is what keeps the next
 * type that does not from taking the terminal down with it.
 */
export type DisposableRecording = {
  dispose?: () => void;
};

/**
 * Frees one recording, if there is one.
 *
 * Null-checked and optional-called: the caller is expected to drop its reference
 * as well, so a freed recording cannot be reached a second time. Double disposal
 * is in fact harmless natively (`safeDispose` is a compare-exchange), but the
 * reference that outlives the free is how a freed picture reaches a canvas, and
 * that is not harmless at all.
 */
export function freeRecording(recording: DisposableRecording | null | undefined): void {
  if (!recording) return;
  recording.dispose?.();
}

/**
 * Recorded blocks by content key, plus the queue of ones a commit replaced.
 *
 * The key is the block's rows and the layout they were recorded under, never
 * their position (see `chunk-plan.ts`), so a block the stream has pushed a row
 * up the pane is found here and re-drawn at its new offset rather than
 * re-recorded. That is the whole point of the cache and nothing below changes
 * it: `retain` leaves exactly the blocks the committed frame drew, which is what
 * the render phase used to leave behind directly.
 */
export class TerminalPictureCache<P extends DisposableRecording> {
  private readonly live = new Map<string, P>();
  private readonly retired: P[] = [];

  /** Render-safe: is there a recording for this block? */
  has(key: string): boolean {
    return this.live.has(key);
  }

  /** Render-safe: the recording for this block, if one was made. */
  get(key: string): P | undefined {
    return this.live.get(key);
  }

  /**
   * Render-safe: takes ownership of a freshly recorded block and hands it back.
   *
   * Additive. An existing entry under the same key wins and the newcomer is
   * queued for the sweep rather than freed here -- keys are content-derived, so
   * the two recordings are the same pixels and the older one may already be on
   * screen.
   */
  add(key: string, recording: P): P {
    const existing = this.live.get(key);
    if (existing) {
      if (existing !== recording) this.retired.push(recording);
      return existing;
    }
    this.live.set(key, recording);
    return recording;
  }

  /**
   * Commit-only: keeps exactly the blocks the committed frame draws.
   *
   * Everything else -- rows that changed, blocks a shrinking pane left with
   * nothing to cover, and anything a discarded render recorded on spec -- goes
   * to the retirement queue. Nothing is freed here: `sweep` is, and the caller
   * defers it.
   */
  retain(keys: readonly string[]): void {
    if (this.live.size === 0) return;
    const kept = new Set(keys);
    for (const [key, recording] of this.live) {
      if (kept.has(key)) continue;
      this.live.delete(key);
      this.retired.push(recording);
    }
  }

  /** How many recordings are waiting to be freed. */
  get retiredCount(): number {
    return this.retired.length;
  }

  /** How many recordings are live. */
  get size(): number {
    return this.live.size;
  }

  /**
   * Frees up to `limit` retired recordings.
   *
   * Amortised on purpose: prepended history retires every block at once, and
   * freeing ~32 display lists inside a single frame callback is a native-side
   * spike exactly when the recorder is busiest. A small batch per frame drains
   * the same queue over a few frames instead.
   */
  sweep(limit: number): number {
    const freed = this.retired.splice(0, Math.max(0, limit));
    for (const recording of freed) freeRecording(recording);
    return freed.length;
  }
}

/** Retired recordings freed per frame. See `sweep`. */
export const TERMINAL_SWEEP_BATCH = 8;
