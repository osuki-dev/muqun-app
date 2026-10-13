/**
 * Whether a Home mounting now is the launch's first Home (design §9: the
 * sections rise in on first mount, never on a return).
 *
 * Process-wide, because Home is not one component instance for the whole
 * launch: on a Pad the first frame is the plain list, which the workspace
 * shell replaces with its own Home a frame or two later, and a font change
 * re-keys it. A mount inside the window after the first one is still the
 * first entry; any later mount is a return.
 */
const FIRST_ENTRY_WINDOW_MS = 1000;

let firstMountMs: number | null = null;

export function claimHomeFirstEntry(nowMs: number = Date.now()): boolean {
  if (firstMountMs === null) firstMountMs = nowMs;
  return nowMs - firstMountMs < FIRST_ENTRY_WINDOW_MS;
}

// Unlike the section entry window, the dock waits for computer readiness.
// Remember its reveal across the Pad owner handoff and subsequent Home mounts.
let composerRevealed = false;

export function hasHomeComposerRevealed(): boolean {
  return composerRevealed;
}

export function markHomeComposerRevealed(): void {
  composerRevealed = true;
}
