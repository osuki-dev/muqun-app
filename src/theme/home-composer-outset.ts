import type { ThemeImage } from '@/theme/schema';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';

export type HomeComposerOutset = { left: number; right: number; bottom: number };

/** Only resolved, drawable Home background artwork may leave the input clip. */
export function resolveHomeComposerOutset(
  image: ThemeImage | null,
  assets: Record<string, string> | null | undefined
): HomeComposerOutset | null {
  if (!image?.outset || !isRenderableThemeAsset(assets?.[image.asset])) return null;
  const { left = 0, right = 0, bottom = 0 } = image.outset;
  return left || right || bottom ? { left, right, bottom } : null;
}
