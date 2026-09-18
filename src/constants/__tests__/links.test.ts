import { expect, test } from 'bun:test';

import { GATEWAY_SETUP_URL, MUQUN_SITE_URL, PRIVACY_POLICY_URL, SUPPORT_GUIDE_URL } from '../links';

/**
 * The outbound addresses, checked for the two things review has actually caught.
 *
 * A URL in a store binary is not a deploy -- `links.ts` says so at length -- so
 * the cheap half of "is this link right" belongs in the gate rather than in a
 * reviewer's eye. What a test can prove is the shape: the scheme, the host and
 * the path. Whether the page answers 200 is the check the file's own ordering
 * rule describes, and no test in this tree can make that call offline.
 */

test('the support guide is an https page on the app’s own site', () => {
  const url = new URL(SUPPORT_GUIDE_URL);
  expect(url.protocol).toBe('https:');
  expect(url.host).toBe('muqun.dev');
  expect(url.pathname).toBe('/support/');
  // No fragment: the row opens the guide, not a section of it. An anchor here
  // would be a promise about the page's internal ids that this repository has
  // no way to keep.
  expect(url.hash).toBe('');
});

test('the site is named once, and every page under it is built from that name', () => {
  // The whole reason `MUQUN_SITE_URL` exists: when the site moves, it is one
  // edit rather than a hunt, and a half-done rename cannot leave two hosts
  // shipping in one binary.
  expect(SUPPORT_GUIDE_URL.startsWith(MUQUN_SITE_URL)).toBe(true);
  expect(GATEWAY_SETUP_URL).toBe(MUQUN_SITE_URL);
  expect(new URL(PRIVACY_POLICY_URL).host).toBe(new URL(MUQUN_SITE_URL).host);

  // The trailing slash is load-bearing: a base without one concatenates into
  // `muqun.devsupport/`.
  expect(MUQUN_SITE_URL.endsWith('/')).toBe(true);
});
