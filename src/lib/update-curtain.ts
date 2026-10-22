/**
 * The moment between a staged update and the restart that applies it.
 *
 * The update dialog registers a curtain -- the check mark finishing and the
 * screen breaking into ash -- and the reload waits for it, but never for long:
 * a curtain that hangs, throws or was never drawn must not keep a verified
 * update from applying. The wait is bounded by `maxMs` whatever happens.
 */
export type UpdateCurtain = () => Promise<void>;

/** Long enough for the check and the dissolve; short enough to never feel stuck. */
export const UPDATE_CURTAIN_MAX_MS = 2600;

let current: UpdateCurtain | null = null;

/** Register the curtain; returns its removal, which leaves a newer one alone. */
export function setUpdateCurtain(curtain: UpdateCurtain): () => void {
  current = curtain;
  return () => {
    if (current === curtain) current = null;
  };
}

/** Resolve once the registered curtain is drawn, it fails, or `maxMs` passes. */
export function drawUpdateCurtain(
  maxMs: number = UPDATE_CURTAIN_MAX_MS,
  curtain: UpdateCurtain | null = current
): Promise<void> {
  if (!curtain) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, maxMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      curtain().then(done, done);
    } catch {
      done();
    }
  });
}
