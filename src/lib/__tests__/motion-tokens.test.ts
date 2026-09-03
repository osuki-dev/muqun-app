// The only test in the app that reads the filesystem, so it is also the only
// one that needs Node's types; `expo/tsconfig.base` does not pull them in.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `src/lib/motion.ts` cannot be imported here: it pulls in Reanimated, which
 * pulls in React Native, which does not parse outside Metro. So these tests
 * read the sources instead -- which is the right shape for them anyway, since
 * what actually matters is not that `DURATION.micro` is 150 but that no screen
 * has quietly written 150 out by hand again.
 *
 * The audit on card #618 found 40 literal durations across `src/**`, spanning
 * nine different values, and concluded that a global tuning pass could not
 * land while they existed. These tests are what stops that coming back.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Files still allowed to hold a raw duration, each for a stated reason. This
 * list should only ever get shorter.
 */
const ALLOWED: Record<string, string> = {
  'lib/motion.ts': 'the module that defines them; PRESS lives below the smallest token on purpose',
  'components/logo-loader.tsx':
    'BREATH_MS is the period of a loop, not a transition between two states',
  'components/update-status-banner.tsx':
    'DOWNLOAD_RAMP_MS stands in for a download of unknown length',
  'components/animated-icon.tsx': 'splash keyframes, which run before the app is interactive',
  'components/animated-icon.web.tsx': 'splash keyframes, which run before the app is interactive',
  // `skia-terminal.tsx`, `approval-banner.tsx` and `attachment-strip.tsx` were
  // here through the P1 batch, held by branches that were in flight at the
  // time. All three are on tokens now and the entries are gone, which is what
  // this list is for: an amnesty with an expiry date, not an exemption.
};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

/** `duration: 200`, `.duration(180)` -- but not `duration: MOTION_THING`. */
const LITERAL_DURATION = /\.duration\(\s*\d|duration:\s*\d/;

describe('motion tokens', () => {
  test('no screen or component writes a duration out by hand', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = file.slice(SRC.length + 1);
      if (relative in ALLOWED) continue;
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        if (LITERAL_DURATION.test(line)) offenders.push(`${relative}:${index + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test('every allowlisted file still exists, so the list cannot rot', () => {
    const present = new Set(sourceFiles(SRC).map((file) => file.slice(SRC.length + 1)));
    for (const file of Object.keys(ALLOWED)) expect(present.has(file)).toBe(true);
  });

  test('entering and exiting animations come from the shared module', () => {
    // A builder imported straight from Reanimated has not been through
    // `motion.ts`, so it carries neither the system ease-out nor the
    // reduce-motion check.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = file.slice(SRC.length + 1);
      if (relative in ALLOWED) continue;
      const source = readFileSync(file, 'utf8');
      const reanimatedImport = source.match(
        /import\s+Animated\s*,?\s*\{([^}]*)\}\s*from\s*'react-native-reanimated'/
      );
      if (!reanimatedImport) continue;
      for (const name of reanimatedImport[1].split(',')) {
        const symbol = name.trim();
        // The layout-animation builders are the ones that must be wrapped;
        // hooks and `withTiming` are fine to use directly.
        if (/^(Fade|Slide|Zoom|Stretch|Flip|Bounce|Pinwheel|Rotate|Roll|Light)/.test(symbol)) {
          offenders.push(`${relative}: ${symbol}`);
        }
        if (symbol === 'LinearTransition' || symbol === 'CurvedTransition') {
          offenders.push(`${relative}: ${symbol}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("an image's own fade is a duration too, and comes from the same place", () => {
    // `expo-image`'s `transition` prop is a number of milliseconds, so it is a
    // duration that the `.duration(...)` scan above cannot see. The audit found
    // two of them -- 100 in the attachment strip and 120 in the lightbox --
    // sitting outside a scale the rest of the app had just been moved onto.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = file.slice(SRC.length + 1);
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        if (/transition=\{\s*\d/.test(line))
          offenders.push(`${relative}:${index + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test('nothing springs, because the design system says nothing springs', () => {
    // "@osuki-dev/ui/src/theme/motion.ts: percussive, mechanical precision --
    // no spring, no bounce."
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = file.slice(SRC.length + 1);
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        if (/\bwithSpring\(|\.springify\(/.test(line)) {
          offenders.push(`${relative}:${index + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
