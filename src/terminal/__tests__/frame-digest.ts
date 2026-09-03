// A stable digest of a frame -- every cell, style, run, cursor and title --
// for the golden test. FNV-1a over the JSON, twice with different seeds, so a
// collision would have to fool two independent 32-bit hashes at once.
//
// `signature` is left out on purpose: it hashes the packed cell words, and
// those carry indices into the process-wide intern tables (see `grid.ts`),
// whose numbering depends on which strings the process happened to see first.
// Identical frames therefore hash differently between a fresh process and
// the test runner. Everything the signature stands for is in the cells.
import type { TerminalFrame } from '@/terminal/types';

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function frameDigest(frame: TerminalFrame): string {
  const json = JSON.stringify({
    ...frame,
    lines: frame.lines.map(({ cells, runs }) => ({ cells, runs })),
  });
  return `${fnv1a(json, 0x811c9dc5).toString(16).padStart(8, '0')}${fnv1a(json, 0x9747b28c).toString(16).padStart(8, '0')}:${json.length}`;
}
