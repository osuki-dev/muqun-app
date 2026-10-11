import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const HOME_OVERVIEW = readFileSync(new URL('../home-overview.tsx', import.meta.url), 'utf8');
const HOME_SCROLL_VIEWPORT = readFileSync(
  new URL('../home-scroll-viewport.tsx', import.meta.url),
  'utf8'
);

function hasInlineReturnControl(section: string): boolean {
  const sectionAt = HOME_OVERVIEW.indexOf(section);
  const scrollAt = HOME_OVERVIEW.indexOf('<HomeScrollViewport', sectionAt);
  const closeAt = HOME_OVERVIEW.indexOf('</HomeScrollViewport>', scrollAt);
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

test('every Home layout hides its vertical scroll indicator', () => {
  const scrollers = HOME_OVERVIEW.split('<HomeScrollViewport').slice(1);
  expect(scrollers).toHaveLength(2);
  for (const scroller of scrollers) {
    const content = scroller.slice(0, scroller.indexOf('</HomeScrollViewport>'));
    expect(content.match(/showsVerticalScrollIndicator=\{false\}/g)).toHaveLength(1);
  }
});

test('the foreground viewport forwards content and scroll props to its native scroller', () => {
  // These checks cover the component boundary, so changing the wrapper name
  // cannot silently move the return action outside the scroll view or swallow
  // its indicator setting, callbacks or ref.
  expect(HOME_SCROLL_VIEWPORT.match(/<KeyboardAwareScrollView\b/g)).toHaveLength(1);
  expect(HOME_SCROLL_VIEWPORT).toContain(
    '<KeyboardAwareScrollView {...scrollProps}>{children}</KeyboardAwareScrollView>'
  );
  expect(/dockOffset,\s*\.\.\.scrollProps/.test(HOME_SCROLL_VIEWPORT)).toBe(true);
});
