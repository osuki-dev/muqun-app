import { parseThemeManifest, type ThemeManifest } from '@/theme/schema';

/** Recognition is not installation. Only an explicit preview action may use this result. */
export function themeFromDocument(name: string, content: string | null): ThemeManifest | null {
  if (!/\.muqun-theme\.json$/i.test(name) || content === null) return null;
  try {
    return parseThemeManifest(content);
  } catch {
    return null;
  }
}
