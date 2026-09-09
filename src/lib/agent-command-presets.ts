import { createThemeAuthoringPrompt } from '@/theme/authoring';

/** Trusted bundled instruction builders. Custom command text never selects a builder. */
export const agentCommandPresets: Readonly<
  Record<string, { description: string; build: () => string }>
> = {
  'muqun-theme': {
    description:
      'Complete light/dark colors, terminal palette, optional artwork, and an importable theme file',
    build: createThemeAuthoringPrompt,
  },
};
