// The seam the network layer reads through.
//
// `activeLocaleHeaders()` is called by `gatewayFetch`, `gatewayAuthHeaders` and
// the SSE connect path, none of which is a React component and none of which
// can call a hook. What these assertions protect is that it answers with the
// language the UI is actually in, and that it keeps answering after a switch.
import { beforeEach, describe, expect, test } from 'bun:test';

import { activeLocaleHeaders, getActiveLocale, setActiveLocale } from '../active-locale';
import { SOURCE_LOCALE } from '../locale';

beforeEach(() => {
  setActiveLocale(SOURCE_LOCALE);
});

describe('the locale the network layer stamps on requests', () => {
  test('starts at the source locale, so a request before activation is still valid', () => {
    expect(getActiveLocale()).toBe('en');
    expect(activeLocaleHeaders()).toEqual({
      'X-Muqun-Locale': 'en',
      'Accept-Language': 'en',
    });
  });

  test('follows the activated locale', () => {
    setActiveLocale('zh-TW');
    expect(getActiveLocale()).toBe('zh-TW');
    expect(activeLocaleHeaders()['X-Muqun-Locale']).toBe('zh-TW');
  });

  test('is read per call, so switching language reaches the very next request', () => {
    const before = activeLocaleHeaders();
    setActiveLocale('zh-TW');
    const after = activeLocaleHeaders();

    expect(before['X-Muqun-Locale']).toBe('en');
    expect(after['X-Muqun-Locale']).toBe('zh-TW');
  });
});
