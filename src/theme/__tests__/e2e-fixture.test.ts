import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { createThemeStarter } from '../starter';
import { auditThemeContrast } from '../contrast';
import { parseThemeManifest } from '../schema';

/**
 * The theme the `custom-themes` flow installs is real, and reachable.
 *
 * This used to check a manifest pasted into the flow as a literal, because the
 * flow typed one into a JSON field. That field is gone, and with it the only
 * offline way a custom theme could reach the app -- so the flow now applies the
 * document the demo workspace ships, and what has to hold has moved with it.
 *
 * Two halves, and the second is the one that would actually go wrong: the
 * manifest behind that document has to be applicable, and the flow has to still
 * be pointed at it. A flow that quietly stops installing anything would leave
 * every assertion after the install testing the built-in theme instead, and
 * pass.
 */
const flow = readFileSync(
  new URL('../../../e2e/agent-device/flows/custom-themes.ad', import.meta.url),
  'utf8'
);

test('the theme the E2E flow installs can actually be applied', () => {
  // `demoAssetText('as-demo-theme')` is this manifest with its name replaced;
  // the name is not what decides whether it installs.
  const manifest = parseThemeManifest(JSON.stringify(createThemeStarter()));
  expect(auditThemeContrast(manifest)).toEqual([]);
  // The id the flow's row assertions are written against.
  expect(manifest.id).toBe('my-theme');
});

test('the flow still installs it, rather than testing the built-in theme', () => {
  expect(flow).toContain('press "text=\\"Open muqun.muqun-theme.json\\""');
  expect(flow).toContain('press "id=asset-preview-theme"');
  expect(flow).toContain('press "id=theme-apply"');
  expect(flow).toContain('press "id=theme-row-my-theme"');
});

test('the flow browses the bundled catalogue without downloading a theme package', () => {
  // Demo mode now supplies the catalogue offline, so the durable assertion is
  // its first fixture card rather than the obsolete network-error state. What
  // must never happen is a row press, which would start a package download.
  expect(flow).toContain('is visible "id=theme-browse"');
  expect(flow).toContain('wait "text=\\"Acacia Afterglow\\"" 15000');
  expect(flow).not.toContain('theme-browse-item');
  // Still never spelled in the .ad: the manifest drives the press.
  expect(flow).not.toContain('press "id=theme-browse"');
});
