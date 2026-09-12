import type { ThemeManifest } from '@/theme/schema';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** Input is an opaque color already checked by the manifest schema. */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export type ThemeContrastIssue = {
  path: string;
  background: string;
  ratio: number;
  required: number;
};

export function auditThemeContrast(manifest: ThemeManifest): ThemeContrastIssue[] {
  const issues: ThemeContrastIssue[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const { colors, terminal } = manifest.variants[mode];
    const check = (path: string, foreground: string, background: string, required: number) => {
      const ratio = contrastRatio(foreground, background);
      if (ratio < required) issues.push({ path: `${mode}.${path}`, background, ratio, required });
    };
    for (const surface of ['background', 'surface', 'surfaceRaised'] as const) {
      for (const ink of ['text', 'textMuted'] as const) {
        check(`colors.${ink}/${surface}`, colors[ink], colors[surface], 4.5);
      }
    }
    check('colors.onPrimary/primary', colors.onPrimary, colors.primary, 4.5);
    check('terminal.foreground/background', terminal.foreground, terminal.background, 4.5);
    check('terminal.link/background', terminal.link, terminal.background, 4.5);
    check('terminal.cursor/background', terminal.cursor, terminal.background, 3);
  }
  return issues;
}
