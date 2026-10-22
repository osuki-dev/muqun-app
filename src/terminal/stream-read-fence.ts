/**
 * Orders a pane read against the frames the event stream paints.
 *
 * A read is answered with the pane as it was when the gateway took it, and the
 * answer then spends half a round trip on the way back. A frame the stream
 * inlined meanwhile was taken later, so it is newer than the read, and a read
 * folded in after it (`refresh` is authoritative) puts the window back in time:
 * the newest lines vanish and come back on the next frame. On a phone that is
 * one flash of the terminal every time the safety-net read lands in the middle
 * of a stream. On the emulator, where the gateway answers in a few
 * milliseconds, it almost never shows.
 *
 * So a read is applied only if no frame was painted while it was in flight. A
 * stream that painted one is alive and carries the whole window in every
 * frame, which is all the read was there to make sure of.
 */
export interface StreamReadFence {
  /** A frame from the stream was applied. */
  noteFrame(): void;
  /** Starts a read; the returned check says whether its answer may still be applied. */
  begin(): () => boolean;
}

export function createStreamReadFence(): StreamReadFence {
  let frames = 0;
  return {
    noteFrame() {
      frames += 1;
    },
    begin() {
      const issuedAt = frames;
      return () => frames === issuedAt;
    },
  };
}
