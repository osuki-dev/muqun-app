import { parseThemeIndex, type ThemeIndexEntry } from '@/theme/gallery';
import snapshot from './demo-gallery.json';

/** Published catalogue metadata kept offline and separate from the real download cache. */
export function demoThemeIndex(): ThemeIndexEntry[] {
  return parseThemeIndex(JSON.stringify(snapshot));
}
