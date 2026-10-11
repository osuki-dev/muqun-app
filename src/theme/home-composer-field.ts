import { appChrome } from '@/constants/appearance';
import { surfaceBackgroundFill, surfaceBackgroundOpacity } from './surface-background';

/** Home has no enclosing plate: bake the quiet tint into its single field fill. */
export function homeComposerFieldFill(surface: string, text: string, opacity: number): string {
  const alpha = surfaceBackgroundOpacity(opacity);
  if (!/^#[\da-f]{6}$/i.test(surface) || !/^#[\da-f]{6}$/i.test(text))
    return surfaceBackgroundFill(surface, alpha);
  const tint = appChrome.opacity.chromeControlQuiet;
  const channels = [1, 3, 5].map((offset) =>
    Math.round(
      Number.parseInt(surface.slice(offset, offset + 2), 16) * (1 - tint) +
        Number.parseInt(text.slice(offset, offset + 2), 16) * tint
    )
      .toString(16)
      .padStart(2, '0')
  );
  return surfaceBackgroundFill(`#${channels.join('')}`, alpha);
}
