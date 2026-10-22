import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';

import { withAlpha } from '@/lib/color';

/**
 * A soft glow in the background colour behind the HUD's text, so it reads on
 * a bright sky by day and a dark one by night without a plate.
 */
export function useStageTextHalo() {
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  return {
    textShadowColor: withAlpha(theme.colors.background, resolvedMode === 'light' ? 0.9 : 0.75),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  };
}

export type StageTextHalo = ReturnType<typeof useStageTextHalo>;
