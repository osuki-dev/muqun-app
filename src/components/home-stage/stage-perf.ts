/**
 * The Stage's frame log, for measuring it on a device: once a second while
 * the scene draws, one line of frames drawn (by why: touch, glide, idle or
 * content; a line after a pause spans the pause), the CPU time of a frame (mean
 * and 90th percentile, from the scene's update to the frame's submission),
 * the gap between frames, draw calls, the quality rung and the pixel ratio.
 *
 * Never in a store bundle. `stage-runtime.tsx` requires this module behind
 * `EXPO_PUBLIC_STAGE_PERF=1` in a Debug bundle or a Release profiling bundle
 * (`EXPO_PUBLIC_RELEASE_PROFILER=1`); both are inlined when a bundle is
 * built, so anywhere else the condition folds to `false` and Metro drops the
 * `require` before it collects dependencies.
 *
 *     EXPO_PUBLIC_STAGE_PERF=1 bun run start
 *     adb logcat -s ReactNativeJS | grep '\[stage-perf\]'
 */
import { stageP90 } from '@/lib/home-stage-motion';

const CAPACITY = 256;

export type StagePerfFrame = {
  nowMs: number;
  /** CPU time of the frame: the scene's update, encoding and submission. */
  workMs: number;
  /** Time since the previous frame drawn. */
  gapMs: number;
  drawCalls: number;
  triangles: number;
  quality: string;
  dpr: number;
  /** Why this frame was drawn: 'touch', 'glide', 'idle' or 'content'. */
  pace: string;
};

export type StagePerfLog = { record: (frame: StagePerfFrame) => void };

export function createStagePerfLog(): StagePerfLog {
  const work = new Float32Array(CAPACITY);
  const gaps = new Float32Array(CAPACITY);
  let count = 0;
  let workSum = 0;
  let draws = 0;
  let triangles = 0;
  let startMs = 0;
  const paces: Record<string, number> = {};
  const flush = (frame: StagePerfFrame) => {
    const seconds = (frame.nowMs - startMs) / 1000;
    const pace = Object.entries(paces)
      .map(([name, frames]) => `${name}:${frames}`)
      .join(' ');
    console.log(
      `[stage-perf] ${count} frames in ${seconds.toFixed(1)} s (${pace}) ` +
        `cpu avg ${(workSum / count).toFixed(2)} ms p90 ${stageP90(work, count).toFixed(2)} ms ` +
        `gap p90 ${stageP90(gaps, count).toFixed(1)} ms ` +
        `draws/frame ${(draws / count).toFixed(1)} tris/frame ${Math.round(triangles / count)} ` +
        `quality ${frame.quality} dpr ${frame.dpr}`
    );
  };
  return {
    record(frame) {
      // A second (or a pause) since the window opened: report it, start another.
      if (count > 0 && frame.nowMs - startMs >= 1000) {
        flush(frame);
        count = 0;
      }
      if (count === 0) {
        startMs = frame.nowMs;
        workSum = 0;
        draws = 0;
        triangles = 0;
        for (const key of Object.keys(paces)) delete paces[key];
      }
      if (count < CAPACITY) {
        work[count] = frame.workMs;
        gaps[count] = frame.gapMs;
        count += 1;
      }
      workSum += frame.workMs;
      draws += frame.drawCalls;
      triangles += frame.triangles;
      paces[frame.pace] = (paces[frame.pace] ?? 0) + 1;
    },
  };
}
