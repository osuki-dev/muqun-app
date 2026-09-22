import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const footerSource = readFileSync(new URL('../list-load-more-footer.tsx', import.meta.url), 'utf8');

test('ListLoadMoreFooter adheres to profile tokens and shared contract', () => {
  expect(footerSource).toContain('useAppearanceProfile');
  expect(footerSource).toContain('useThemeTokens');
  expect(footerSource).toContain('profile.density');
  expect(footerSource).toContain('profile.chrome.control');
  expect(footerSource).toContain('hasMore');
  expect(footerSource).toContain('onLoadMore');
  expect(footerSource).toContain('Spinner');
  expect(footerSource).toContain('Button');
  expect(footerSource).toContain('Text');
});

test('ListLoadMoreFooter supports custom and default count/loading states', () => {
  expect(footerSource).toContain('testID={buttonTestID}');
  expect(footerSource).toContain('testID={`${testID}-loading`}');
  expect(footerSource).toContain('testID={`${testID}-count`}');
  expect(footerSource).toContain('Showing ${shown} of ${total}');
});
