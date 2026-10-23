const BULLET = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s/;

/** The notes' plain words: emphasis, code ticks and link targets go. */
function inlineText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The release notes as a list of changes, or null when they are not one.
 *
 * Notes arrive as Markdown: usually a heading naming the release, then
 * bullets. The heading says nothing the dialog's own title does not, so a
 * first-line heading is dropped when bullets follow. Anything else -- prose,
 * a table, a second heading -- returns null, and the caller renders the
 * Markdown as written rather than lose part of it.
 */
export function updateNoteBullets(markdown: string): string[] | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const bullets: string[] = [];
  let seenContent = false;
  let previousBlank = false;
  for (const line of lines) {
    if (!line.trim()) {
      previousBlank = true;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      bullets.push(bullet[1] ?? '');
    } else if (!seenContent && HEADING.test(line)) {
      // The title line; nothing to keep.
    } else if (bullets.length > 0 && !previousBlank && /^\s+\S/.test(line)) {
      // A wrapped bullet continues on an indented line.
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    } else {
      return null;
    }
    seenContent = true;
    previousBlank = false;
  }
  const items = bullets.map(inlineText).filter(Boolean);
  return items.length > 0 ? items : null;
}
