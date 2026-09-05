/**
 * The last few frames, kept alive behind the one on screen.
 *
 * Skia images are native memory with a JS handle. Dropping one without
 * disposing it leaks a whole frame, and at eight frames a second that is
 * visible in minutes -- so they are disposed by hand. But not the moment the
 * next one arrives: the picture is recorded on the UI runtime a little after
 * the frame is handed over, and disposing the previous frame before that
 * recording has happened empties the very image about to be drawn. The
 * picture then goes blank while the state says `live`, which the emulator is
 * slow enough to show every time.
 *
 * So a frame is released only once `depth` newer frames have been handed over
 * after it. The ring is the arithmetic of that and nothing else: it does not
 * know what a frame is, and it never calls `dispose` -- the caller is told what
 * fell off the far end and frees it where it is safe to, which is on the
 * runtime that draws.
 */
export class SimfarmFrameRing<T> {
  private held: T[] = [];

  constructor(private readonly depth: number) {
    if (!(depth >= 1)) throw new RangeError('a frame ring keeps at least one frame');
  }

  /** How many frames are held right now. */
  get size(): number {
    return this.held.length;
  }

  /**
   * Keep `next` as the newest frame. Returns the frame that fell off the far
   * end -- the one that is now `depth` frames behind -- or `null` while the
   * ring is still filling.
   */
  push(next: T): T | null {
    this.held.push(next);
    if (this.held.length <= this.depth) return null;
    return this.held.shift() ?? null;
  }

  /** Everything held, oldest first; nothing is held afterwards. */
  drain(): T[] {
    const all = this.held;
    this.held = [];
    return all;
  }
}
