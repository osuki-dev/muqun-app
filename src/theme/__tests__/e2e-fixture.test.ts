import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { auditThemeContrast } from '@/theme/contrast';
import { parseThemeManifest } from '@/theme/schema';

test('the native theme E2E fixture can actually be applied', () => {
  const flow = readFileSync(
    new URL('../../../e2e/agent-device/flows/custom-themes.ad', import.meta.url),
    'utf8'
  );
  const line = flow.split('\n').find((entry) => entry.startsWith('fill '));
  expect(line).toBeDefined();
  // Native .ad tokenization uses double quotes, not shell single-quote rules.
  expect(line?.startsWith('fill "id=theme-json-input" ')).toBe(true);
  const argument = line!.slice(line!.indexOf(' "{') + 1);
  const manifest = parseThemeManifest(JSON.parse(argument));
  expect(manifest.id).toBe('theme-qa');
  expect(auditThemeContrast(manifest)).toEqual([]);
});
