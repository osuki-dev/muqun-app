/**
 * Agent TUIs draw their own chrome sized to the desktop pane they run in.
 *
 * Claude Code, Codex, and Qoder all frame their input box with a rule spanning
 * the full pane width -- 240 columns on a typical desktop. Reflowed to a phone
 * that single line wraps into a dozen visual rows, which is where the stack of
 * stray horizontal lines in the agent view comes from.
 *
 * The rule carries no information once the content is no longer on a grid, so
 * it is dropped. A short `---` is left alone: that is a real thematic break the
 * author wrote, not chrome.
 */

/** Every character the agent TUIs draw frames and rules with. */
const BOX_CHARACTERS =
  '─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼╀╁╂╃╄╅╆╇╈╉╊╋' +
  '═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰▔▁▬-_=';

/**
 * Chrome is sized to the desktop pane, so it is far wider than a table an agent
 * would draw around real data. Measured against live output from Claude Code,
 * Codex, and Qoder: their frames run 98-242 columns while the widest genuine
 * table was 43, and nvim, npm, and shell panes produce none at all.
 */
const CHROME_WIDTH = 60;

/** `─ Worked for 6m 26s ────────────…` — a heading padded out to the pane width. */
const TITLED_RULE = /^[─━═]+\s+(.+?)\s+[─━═]{3,}$/u;

function isAllBoxDrawing(value: string): boolean {
  const withoutSpaces = value.replace(/\s/gu, '');
  if (!withoutSpaces) return false;
  for (const character of withoutSpaces) {
    if (!BOX_CHARACTERS.includes(character)) return false;
  }
  return true;
}

/**
 * True for a frame or rule drawn to the pane width, which carries no meaning
 * once the content is no longer on a grid. Narrower box drawing is left alone:
 * that is a table around real data, and dropping it would lose the shape.
 */
export function isFullWidthRule(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= CHROME_WIDTH && isAllBoxDrawing(trimmed);
}

/** The heading inside a padded rule, or null when the line is not one. */
export function titledRuleText(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length < CHROME_WIDTH) return null;
  return TITLED_RULE.exec(trimmed)?.[1]?.trim() || null;
}

/**
 * Removes pane-width frames and unpads titled rules, so an agent transcript
 * reflows onto a phone without its desktop chrome wrapping into stray lines.
 */
export function stripAgentChrome(input: string): string {
  const kept: string[] = [];
  for (const line of input.split('\n')) {
    const title = titledRuleText(line);
    if (title) {
      kept.push(title);
      continue;
    }
    if (isFullWidthRule(line)) {
      // A frame usually sits against a blank line; leaving that behind would
      // open a gap where the border used to be.
      if (kept.at(-1)?.trim() === '') kept.pop();
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}
