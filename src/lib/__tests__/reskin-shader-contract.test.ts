/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The shaders cannot be imported here -- they reach Skia, which does not load
 * outside Metro -- so these read the source, in the same shape and for the same
 * reason as `motion-tokens.test.ts`.
 *
 * What they are actually for: a uniform whose name does not match its
 * declaration is not an error in Skia. The value is dropped, the program runs
 * with whatever that uniform was last set to, and the effect comes out subtly
 * or catastrophically wrong on a device with no message anywhere. That is a
 * class of bug a spelling check catches for free, and a class nobody finds by
 * reading, because both halves look right on their own page.
 */

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHADERS = readFileSync(join(LIB, 'reskin-shaders.ts'), 'utf8');
const FIELD = readFileSync(join(LIB, 'sksl-field.ts'), 'utf8');
const BLOOM = readFileSync(join(LIB, 'ink-bloom-shader.ts'), 'utf8');

/** The uniforms a program declares. */
function declared(source: string, program: string): string[] {
  const body = source.split(`export const ${program} = \``)[1]?.split('\n`;')[0] ?? '';
  return [...body.matchAll(/^uniform\s+\w+\s+(\w+)\s*;/gm)].map((match) => match[1] as string);
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
  ] as const) {
    test(`${name} declares exactly what ${builder} writes`, () => {
      const uniforms = declared(SHADERS, name).filter((uniform) => uniform !== 'uCover');
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

  test('both programs leave early before they touch the expensive half', () => {
    // The launch opening's rule: a pixel that is not near the front pays for a
    // comparison and nothing else. Both early-outs must come before any noise,
    // dot arithmetic or rim light in the text of `main`.
    for (const name of ['THEME_WASH_SKSL', 'FONT_HALFTONE_SKSL'] as const) {
      const main = program(SHADERS, name).split('half4 main(')[1] ?? '';
      const returns = main.indexOf('return half4(0.0);');
      expect(returns).toBeGreaterThan(0);
      for (const expensive of ['fbm(', 'rimLight(', 'floor(q / uCell)']) {
        const at = main.indexOf(expensive);
        if (at >= 0) expect(at).toBeGreaterThan(returns);
      }
    }
  });

  test('the wash travels along a line and the halftone does not', () => {
    // The one assertion that keeps these from drifting back into the launch's
    // radial bloom: the wash's front is a projection onto a direction, and the
    // halftone has no direction at all.
    const wash = program(SHADERS, 'THEME_WASH_SKSL');
    expect(wash).toContain('dot(d, uDir)');
    expect(program(SHADERS, 'FONT_HALFTONE_SKSL')).not.toContain('uDir');
  });

  test('the noise field has one definition and three callers', () => {
    // `sksl-field.ts` owns it; the bloom and both re-skin programs compose it.
    expect(FIELD).toContain('float hash21(');
    expect(FIELD).toContain('float fbm(');
    expect(SHADERS).toContain('${SKSL_NOISE}');
    expect(BLOOM).toContain('${SKSL_NOISE}');
    for (const source of [SHADERS, BLOOM]) {
      expect(source).not.toContain('float hash21(');
      expect(source).not.toContain('float vnoise(');
    }
  });

  test('the hash stays free of trigonometry', () => {
    // Twenty-four sines per pixel is what made the first draft of the launch a
    // slideshow on a device with no GPU. See the note in `sksl-field.ts`.
    const noise = FIELD.split('export const SKSL_NOISE = `')[1]?.split('\n`;')[0] ?? '';
    expect(noise.length).toBeGreaterThan(0);
    expect(/\bsin\s*\(|\bcos\s*\(|\btan\s*\(/.test(noise)).toBe(false);
  });

  test('every program is compiled once, at module scope', () => {
    // `RuntimeEffect.Make` per mount is a compile on a frame somebody is
    // watching, and it returns null rather than throwing, so a caller that
    // never checks would discover a typo one device at a time.
    for (const effect of ['THEME_WASH_EFFECT', 'FONT_HALFTONE_EFFECT']) {
      expect(SHADERS).toContain(`export const ${effect} = Skia.RuntimeEffect.Make(`);
    }
  });
});
