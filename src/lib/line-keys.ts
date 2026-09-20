/**
 * Stable, content-derived React keys for the lines of a text blob — a patch, a
 * command's output, a file's content. Identical lines repeat in real diffs, so
 * each key is the line's content plus its occurrence number: never the array
 * index, and never colliding on repeated lines.
 */
export interface KeyedLine {
  line: string;
  key: string;
}

export function keyedLines(text: string): KeyedLine[] {
  const seen = new Map<string, number>();
  return text.split('\n').map((line) => {
    const base = line.slice(0, 32) || 'blank';
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { line, key: `${base}#${count}` };
  });
}
