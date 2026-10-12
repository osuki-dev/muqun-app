/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Uniform names and child order must agree across TypeScript and SkSL.
const LIB = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHADERS = readFileSync(join(LIB, 'reskin-shaders.ts'), 'utf8');

/** The uniforms a program declares. */
function declared(source: string, program: string): string[] {
  const body = source.split(`export const ${program} = \``)[1]?.split('\n`;')[0] ?? '';
  return [...body.matchAll(/^(?:layout\(color\)\s+)?uniform\s+\w+\s+(\w+)\s*;/gm)].map(
    (match) => match[1] as string
  );
}

/** The uniforms a builder sets. */
function written(source: string, builder: string): string[] {
  const body = source.split(`export function ${builder}`)[1]?.split('\n}')[0] ?? '';
  return [...body.matchAll(/^\s{4}(u[A-Z]\w*):/gm)].map((match) => match[1] as string);
}

/** The body of one SkSL program. */
function program(source: string, name: string): string {
  return source.split(`export const ${name} = \``)[1]?.split('\n`;')[0] ?? '';
}

describe('re-skin shader contract', () => {
  for (const [name, builder] of [
    ['THEME_WASH_SKSL', 'themeWashUniforms'],
    ['FONT_HALFTONE_SKSL', 'fontHalftoneUniforms'],
    ['THEME_RIPPLE_SKSL', 'themeRippleUniforms'],
    ['FONT_SCAN_SKSL', 'fontScanUniforms'],
  ] as const) {
    test(`${name} declares exactly what ${builder} writes`, () => {
      const uniforms = declared(SHADERS, name).filter(
        (uniform) => uniform !== 'uCover' && uniform !== 'uNext'
      );
      const keys = written(SHADERS, builder);
      expect(uniforms.length).toBeGreaterThan(0);
      expect(keys.length).toBeGreaterThan(0);
      // Sorted, so the failure names the uniform rather than an ordering.
      expect([...keys].sort()).toEqual([...uniforms].sort());
    });

    test(`${name} takes the cover as a child shader`, () => {
      // A runtime effect must be given every child it declares, and the cover
      // is the photograph the whole module exists to erase.
      expect(declared(SHADERS, name)).toContain('uCover');
      expect(program(SHADERS, name)).toContain('uniform shader uCover;');
    });
  }

  test('the ripple binds its two pictures in declaration order', () => {
    const ripple = program(SHADERS, 'THEME_RIPPLE_SKSL');
    expect(ripple).toContain('uniform shader uNext;');
    // The cover is declared first: the overlay binds its children in order.
    expect(ripple.indexOf('uCover')).toBeLessThan(ripple.indexOf('uNext'));
  });
});
