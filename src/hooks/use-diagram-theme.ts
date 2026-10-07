import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { darkTheme, lightTheme, type DiagramTheme } from '@osuki-dev/skia-diagrams';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useInterfaceFontFamily, useMonoFontFamily } from '@/hooks/use-user-fonts';

/** Diagram surfaces, text and controls follow the same tokens as the transcript. */
export function useDiagramTheme(): DiagramTheme {
  const { colors, radius } = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const background = useSurfaceBackground();
  const font = useInterfaceFontFamily();
  const mono = useMonoFontFamily();
  return {
    ...(resolvedMode === 'dark' ? darkTheme : lightTheme),
    background: 'transparent',
    nodeFill: background(colors.surfaceRaised),
    nodeStroke: colors.border,
    nodeText: colors.text,
    edgeStroke: colors.textMuted,
    edgeText: colors.textMuted,
    edgeTextBackground: background(colors.surfaceRaised),
    clusterFill: background(colors.surface),
    clusterStroke: colors.border,
    clusterText: colors.text,
    gridStroke: colors.border,
    mutedText: colors.textMuted,
    accent: colors.primary,
    noteFill: background(colors.surfaceRaised),
    noteText: colors.text,
    fontFamily: font ?? 'sans-serif',
    fontFamilyMono: mono,
    radius: radius.sm,
  };
}
