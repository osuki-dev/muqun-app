/**
 * The web build has no native launch screen to hand over from, and its first
 * paint is the app; an overlay here would only delay it.
 */
export function LaunchOverlay() {
  return null;
}
