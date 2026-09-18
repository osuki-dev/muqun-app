/**
 * The two large files demo mode carries, built rather than written out.
 *
 * The rest of the demo's artifacts are the ones a fictional agent writes: a
 * note, a patch, a coverage summary, none of them past a few hundred bytes.
 * They prove the viewer opens a file. They cannot prove anything about the
 * sizes the viewer used to turn away, and the end-to-end suite runs offline, so
 * a demo file is the only file it has to prove it with.
 *
 * Built, because a hundred and forty kilobytes of fixture written out in a
 * source file is a hundred and forty kilobytes in the app bundle, paid by every
 * reader who never opens demo mode. Built once, the first time the Files list
 * is read, and held after that -- the list reports each file's size, so the
 * string has to exist before the row does.
 *
 * Its own module, and not `demo-gateway`'s: that file reaches the Lingui macro,
 * which a test process cannot load, and these two need to be measured by a test
 * rather than described by one.
 */

const built = new Map<string, string>();

function once(id: string, build: () => string): string {
  const existing = built.get(id);
  if (existing !== undefined) return existing;
  const value = build();
  built.set(id, value);
  return value;
}

/**
 * A bundle: past the highlight ceiling, so the line viewer draws it, and with
 * the one enormous line every bundle has, so the row clamp is exercised by
 * something other than a test.
 */
export function demoBundleText(): string {
  return once('bundle', () => {
    const lines: string[] = [
      '/* muqun demo bundle — built by the demo, never shipped */',
      "'use strict';",
      '',
    ];
    for (let index = 0; index < 700; index += 1) {
      lines.push(`function render${index}(state, props) {`);
      lines.push(`  const value = state.items[${index}] ?? props.fallback;`);
      lines.push(`  return value === undefined ? null : { id: ${index}, value };`);
      lines.push('}');
      lines.push('');
    }
    lines.push('// One minified line, which is the case a line viewer has to survive.');
    lines.push(`var __chunk = ${JSON.stringify('x'.repeat(6_000))};`);
    lines.push('');
    return lines.join('\n');
  });
}

/**
 * A changelog: a document far longer than one native view was ever handed, and
 * carrying every block kind the chunker must not cut through -- headings,
 * tables, ordered lists with continuations, and fences.
 */
export function demoChangelogText(): string {
  return once('changelog', () => {
    const lines: string[] = ['# Changelog', ''];
    for (let release = 120; release >= 1; release -= 1) {
      lines.push(`## v0.${release}.0`, '');
      lines.push(
        `The ${release}th release. Theme resolution, the terminal surface and the`,
        'files sheet all moved; the notes below are what a reader would look for.',
        ''
      );
      lines.push('| Area | Change |', '| --- | --- |');
      for (let row = 1; row <= 4; row += 1) {
        lines.push(`| area-${row} | change ${row} of release ${release} |`);
      }
      lines.push('');
      for (let item = 1; item <= 4; item += 1) {
        lines.push(`${item}. Item ${item} of release ${release}, written out at some length`);
        lines.push('   so that a list item wraps rather than sitting on one line.');
        lines.push('');
      }
      lines.push('```ts', `export const VERSION = '0.${release}.0';`, '```', '');
    }
    return lines.join('\n');
  });
}

/**
 * The size of the one file demo mode still has refused.
 *
 * Nothing generates its bytes: the size is the whole fixture, because the
 * viewer never asks for the rest. That is the point of it.
 */
export const DEMO_REFUSED_LOG_BYTES = 8 * 1024 * 1024;
