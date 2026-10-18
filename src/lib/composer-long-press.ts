/** Keep a native long-press handler present for the button's whole lifetime.
 * Pressability checks its current config on release, not the config that began
 * the gesture. Removing this handler after voice claims the microphone would
 * turn the same gesture's release into an ordinary Send press.
 * Long holds never send, including when voice becomes unavailable mid-gesture. */
export function composerLongPress(readAction: () => (() => void) | undefined) {
  return () => readAction()?.();
}
