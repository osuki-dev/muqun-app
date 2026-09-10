export type AgentCommandPreset = {
  description: string;
  build: () => string;
};

/** Trusted bundled builders only; user-authored commands remain plain instruction text. */
export const agentCommandPresets: Readonly<Record<string, AgentCommandPreset>> = {};
