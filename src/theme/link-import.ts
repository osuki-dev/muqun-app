import type { ThemeLinkInspection, ThemeLinkOptions } from './link-source';

export const themeLinkImportAvailable = false;
export async function inspectThemeLink(
  _input: string,
  _options: ThemeLinkOptions = {}
): Promise<ThemeLinkInspection> {
  throw new Error('Theme link import requires the Android or iOS app');
}
