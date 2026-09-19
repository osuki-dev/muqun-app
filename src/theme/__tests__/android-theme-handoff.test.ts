import { expect, test } from 'bun:test';
import config from '../../../app.json';

test('opaque Android document URIs can reach the theme reader without a filename', () => {
  const filters = config.expo.android.intentFilters;
  for (const mimeType of [
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'application/json',
    'application/vnd.muqun.theme',
  ]) {
    expect(
      filters.some((filter) => {
        const data = filter.data;
        return (
          filter.action === 'VIEW' &&
          filter.category.includes('DEFAULT') &&
          data.some((item) => item.scheme === 'content') &&
          data.some((item) => item.mimeType === mimeType) &&
          data.every(
            (item) => !item.host && !Object.keys(item).some((key) => key.startsWith('path'))
          )
        );
      })
    ).toBe(true);
  }
});

test('theme handoff does not claim arbitrary web links or all MIME types', () => {
  for (const filter of config.expo.android.intentFilters) {
    const data = filter.data;
    expect(data.some((item) => item.scheme === 'http' || item.scheme === 'https')).toBe(false);
    expect(data.some((item) => item.mimeType === '*/*')).toBe(false);
  }
});
