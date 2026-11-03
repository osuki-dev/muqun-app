import type { ReactNode } from 'react';

/**
 * The web build has no native launch screen to hand over from, and its first
 * paint is the app; an overlay here would only delay it.
 */
export function LaunchOverlay() {
  return null;
}

/** Nothing covers the web app at launch, so nothing is held back. */
export function LaunchCoveredContent({ children }: { children: ReactNode }) {
  return children;
}
