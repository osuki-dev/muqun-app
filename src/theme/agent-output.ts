import { parseThemeManifest, THEME_LIMITS, type ThemeManifest } from '@/theme/schema';

/**
 * The theme an assistant wrote, read back out of what it printed.
 *
 * The authoring prompt asks for a manifest fenced as `muqun-theme`
 * (`authoring.ts`), and until now nothing read that fence back, so the delivery
 * ended at a file path on a development machine.
 *
 * The prompt *itself* embeds the starter manifest in a fence of the same name,
 * and an agent's pane commonly still shows the task it was given. Scanning
 * forwards would therefore hand back the starter every time. The reply comes
 * after the request, so candidates are tried newest first and the first one
 * that is a valid manifest wins.
 *
 * Never throws: output is untrusted text, and a pane with no theme in it is the
 * ordinary case, not an error.
 */
const FENCE = /```[ \t]*muqun-theme[ \t]*\r?\n([\s\S]*?)```/g;

export function extractThemeFromOutput(text: string): ThemeManifest | null {
  if (!text) return null;
  const blocks: string[] = [];
  for (const match of text.matchAll(FENCE)) {
    const body = match[1];
    // A manifest cannot be larger than the limit the importer would enforce,
    // so an oversized block is not a candidate worth parsing.
    if (body && body.length <= THEME_LIMITS.manifestBytes) blocks.push(body);
  }
  for (let index = blocks.length - 1; index >= 0; index--) {
    try {
      return parseThemeManifest(blocks[index]);
    } catch {
      // Truncated or partial output is expected while an agent is still
      // printing. Keep looking further back rather than reporting a failure.
    }
  }
  return null;
}

/** A manifest that names images cannot install from text alone. */
export function themeNeedsImages(manifest: ThemeManifest): boolean {
  return Object.keys(manifest.assets ?? {}).length > 0;
}
