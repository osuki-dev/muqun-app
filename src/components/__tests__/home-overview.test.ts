import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const HOME_OVERVIEW = readFileSync(new URL('../home-overview.tsx', import.meta.url), 'utf8');

function hasInlineReturnControl(section: string): boolean {
  const sectionAt = HOME_OVERVIEW.indexOf(section);
  const scrollAt = HOME_OVERVIEW.indexOf('<KeyboardAwareScrollView', sectionAt);
  const closeAt = HOME_OVERVIEW.indexOf('</KeyboardAwareScrollView>', scrollAt);
  const returnAt = HOME_OVERVIEW.indexOf('{returnToTask', scrollAt);

  return sectionAt >= 0 && scrollAt > sectionAt && returnAt > scrollAt && returnAt < closeAt;
}

test('embedded return action stays inside each home layout scroller', () => {
  expect(hasInlineReturnControl('const editorialContent')).toBe(true);
  expect(hasInlineReturnControl('const classicContent')).toBe(true);
  expect(HOME_OVERVIEW).not.toContain('embeddedOverviewShell');
  expect(HOME_OVERVIEW).not.toContain("position: 'absolute',\n    top: 12");
  expect(HOME_OVERVIEW).toContain('minWidth: 44');
  expect(HOME_OVERVIEW).toContain('minHeight: 44');
  expect(HOME_OVERVIEW).toContain('minWidth: 0');
});
