import { createThemeAuthoringPrompt } from '@/theme/authoring';

export type AgentCommandPreset = { description: string; build: () => string };

/** Trusted bundled instruction builders. Custom command text never selects a builder. */
export const agentCommandPresets: Readonly<Record<string, AgentCommandPreset>> = {
  'muqun-theme': {
    description:
      'Complete light/dark colors, terminal palette, optional artwork, and an importable theme file',
    build: createThemeAuthoringPrompt,
  },
};
