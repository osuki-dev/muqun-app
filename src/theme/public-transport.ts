import type { PublicThemeTransport } from './remote-import';

// Browser networking cannot enforce the native public-destination contract.
export const publicThemeTransport: PublicThemeTransport | null = null;
