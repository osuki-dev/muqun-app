/**
 * A document, split where markdown allows it to be split.
 *
 * `BoundedMarkdown` exists because one native markdown view must never be
 * handed an unbounded string. That guard is right and stays, but on its own it
 * means a 300 KB README is read one "Show more" at a time forever. The way out
 * is more views rather than a bigger one: the document is cut into chunks, each
 * chunk is a cell in a virtualized list, and only the cells on screen are
 * mounted. Nothing is refused and no view measures more than a screenful or
 * two.
 *
 * What makes that safe is *where* the cuts go. A chunk is parsed on its own, so
 * a cut inside a fence turns the rest of the file into code, a cut inside a
 * table turns its remaining rows into a paragraph of pipes, and a cut inside an
 * ordered list restarts it at 1. So the document is first reduced to atoms --
 * runs of lines that must be parsed together -- and chunks are then packed out
 * of whole atoms and never out of parts of one.
 *
 * The split is lossless: the chunks joined with a newline are the document
 * again, byte for byte. That is the invariant the tests hold this to, and it is
 * what lets the viewer claim it is showing the whole file.
 *
 * Pure, and therefore tested: the component that draws the cells decides
 * nothing.
 */

/**
 * Characters of markdown packed into one cell before a new one is started.
 *
 * Comfortably under `MARKDOWN_CHUNK_CHARS`, the point at which `BoundedMarkdown`
 * starts holding content back: a chunk this size arrives whole, with no
 * "Show more" inside it, which is what makes a document of them read as one
 * document. Small enough that a cell measures in a frame; large enough that a
 * README is tens of cells rather than thousands.
 */
export const MARKDOWN_BLOCK_CHUNK_CHARS = 4_000;

/** The opening of a fenced block: three or more backticks or tildes, indented at most three. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** A closing fence carries nothing but the marker. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
/** A bullet or an ordered marker, which is what makes the lines around it one list. */
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
/** An ATX heading, which is the one line a chunk would rather start with than end on. */
const HEADING = /^ {0,3}#{1,6}(\s|$)/;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** Leading indent in columns, counting a tab as four. */
function indentOf(line: string): number {
  let columns = 0;
  for (const character of line) {
    if (character === ' ') columns += 1;
    else if (character === '\t') columns += 4;
    else break;
  }
  return columns;
}

/**
 * Past a fence, whatever is inside it.
 *
 * A fence is closed by a marker of the same character and at least the same
 * length, and by nothing else -- not by a blank line, and not by the shorter
 * marker its own content may contain. An unclosed fence runs to the end of the
 * file, which is also how the parser reads it, so the chunk boundary and the
 * parse agree.
 */
function skipFence(lines: readonly string[], start: number, marker: string): number {
  let index = start + 1;
  const character = marker[0];
  while (index < lines.length) {
    const close = FENCE_CLOSE.exec(lines[index]);
    if (close && close[1][0] === character && close[1].length >= marker.length) return index + 1;
    index += 1;
  }
  return lines.length;
}

/**
 * One atom: from `start` to the index after it.
 *
 * A run of non-blank lines, plus the blank lines that follow it -- so the
 * document's own spacing travels with the block it separates rather than
 * landing at the top of the next cell. Two things extend a run past a blank
 * line: a fence, which swallows blanks until it closes, and a loose list, whose
 * items are separated by exactly the blank line that would otherwise end the
 * atom.
 */
function scanAtom(lines: readonly string[], start: number): number {
  let index = start;
  let listy = false;
  for (;;) {
    while (index < lines.length) {
      const open = FENCE_OPEN.exec(lines[index]);
      if (open) {
        index = skipFence(lines, index, open[1]);
        continue;
      }
      if (isBlank(lines[index])) break;
      if (LIST_ITEM.test(lines[index])) listy = true;
      index += 1;
    }
    while (index < lines.length && isBlank(lines[index])) index += 1;
    if (index >= lines.length) return index;
    // A loose list: the blank run was inside it, not after it.
    if (listy && (LIST_ITEM.test(lines[index]) || indentOf(lines[index]) >= 2)) continue;
    return index;
  }
}

/** Whether an atom is a bare heading, which reads as an orphan at the foot of a cell. */
function isHeadingOnly(lines: readonly string[], start: number, end: number): boolean {
  let seen = 0;
  for (let index = start; index < end; index += 1) {
    if (isBlank(lines[index])) continue;
    seen += 1;
    if (seen > 1 || !HEADING.test(lines[index])) return false;
  }
  return seen === 1;
}

/**
 * The document, as chunks a list can draw one cell at a time.
 *
 * Greedy: atoms are packed until the next one would take the chunk past
 * `target`, and an atom larger than `target` on its own -- a 200 KB fenced
 * block, say -- becomes a chunk by itself rather than being cut. That last case
 * is exactly the one `BoundedMarkdown` was written for, so it lands where it is
 * already handled.
 */
export function splitMarkdownBlocks(
  markdown: string,
  target: number = MARKDOWN_BLOCK_CHUNK_CHARS
): string[] {
  if (typeof markdown !== 'string' || markdown.length === 0) return [];
  const lines = markdown.split('\n');

  // Where each atom starts, and one past the last line.
  const bounds: number[] = [];
  for (let index = 0; index < lines.length; index = scanAtom(lines, index)) bounds.push(index);
  bounds.push(lines.length);

  // `+ 1` per line for the newline the join puts back.
  const sizeOf = (from: number, to: number) => {
    let total = 0;
    for (let index = from; index < to; index += 1) total += lines[index].length + 1;
    return total;
  };

  const chunks: string[] = [];
  let start = 0;
  let packed = 0;
  for (let atom = 0; atom + 1 < bounds.length; atom += 1) {
    const from = bounds[atom];
    const size = sizeOf(from, bounds[atom + 1]);
    // A cell that is nothing but a heading is the orphan this guards against,
    // so it is never the cell a flush leaves behind: it takes the next atom
    // however far past the target that puts it.
    if (packed > 0 && packed + size > target && !isHeadingOnly(lines, start, from)) {
      // A heading that landed last has its content in the next cell. Send it
      // there rather than leaving it alone at the foot of this one.
      const previous = bounds[atom - 1];
      const cut = previous > start && isHeadingOnly(lines, previous, from) ? previous : from;
      chunks.push(lines.slice(start, cut).join('\n'));
      start = cut;
      packed = sizeOf(cut, from);
    }
    packed += size;
  }
  chunks.push(lines.slice(start).join('\n'));
  return chunks;
}
