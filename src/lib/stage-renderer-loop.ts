/**
 * three's `WebGPURenderer` starts its own `requestAnimationFrame` loop in
 * `init()` and keeps it running whether or not an animation loop is set: with
 * Fiber in `frameloop: 'demand'` it still woke the JS thread sixty times a
 * second on an idle Home to advance a frame counter and call nothing
 * (measured: 301 timer fires per 5 s window, all from `three.webgpu.js`).
 * The Stage draws its frames itself (`stage-runtime.tsx`), so the loop is
 * stopped after `init()` and the frame counter it kept is advanced once per
 * frame the Stage draws, which is what the loop did for a drawn frame.
 *
 * Both touch fields three keeps private; a three that renames them leaves
 * the loop running (as before this shim) rather than breaking the Stage.
 */

type FrameClock = {
  _animation?: { stop: () => void };
  _nodes?: { nodeFrame?: { update: () => void; frameId: number } };
  info?: { frame: number };
};

/** Stop the renderer's own animation loop; the caller draws on demand. */
export function stopRendererLoop(renderer: object): void {
  (renderer as FrameClock)._animation?.stop();
}

/** Advance the renderer's frame counter for one frame about to be drawn. */
export function advanceRendererFrame(renderer: object): void {
  const clock = renderer as FrameClock;
  const frame = clock._nodes?.nodeFrame;
  if (!frame) return;
  frame.update();
  if (clock.info) clock.info.frame = frame.frameId;
}
