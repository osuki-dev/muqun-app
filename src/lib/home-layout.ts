/** Home compositions currently available to the App. */
export type HomeLayout = 'classic' | 'editorial' | 'stage';

export const DEFAULT_HOME_LAYOUT: HomeLayout = 'editorial';

export function isHomeLayout(value: unknown): value is HomeLayout {
  return value === 'classic' || value === 'editorial' || value === 'stage';
}

/** Resolve persisted or otherwise untrusted input to a released Home layout. */
export function resolveHomeLayout(value: unknown): HomeLayout {
  return isHomeLayout(value) ? value : DEFAULT_HOME_LAYOUT;
}
