import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Every field in the app draws its placeholder through `FontedTextInput`.
 *
 * The platform's hint is drawn from the native view's typeface, which did not
 * follow a reader-installed font on the owner's phone. A raw `<TextInput>`
 * added anywhere brings that back for one field, silently, on devices the
 * suite does not run on -- so the rule is pinned at the source.
 */
test('no screen mounts a raw TextInput', () => {
  const offenders: string[] = [];
  const files = (readdirSync('src', { recursive: true }) as string[])
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => `src/${name}`);
  for (const file of files) {
    if (file.includes('__tests__') || file.endsWith('fonted-text-input.tsx')) continue;
    if (
      /(?<![A-Za-z])<TextInput[\s/]/u.test(readFileSync(file, 'utf8').replace(/\/\/.*$/gmu, ''))
    ) {
      offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});

test('the shared field keeps the hint for the screen reader and hides it from the eye', () => {
  const source = readFileSync('src/components/fonted-text-input.tsx', 'utf8');
  expect(source).toContain('placeholder={placeholder}');
  expect(source).toContain('placeholderTextColor="transparent"');
});
