import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('navigation rows retain an explicit localized name independently of busy state', () => {
  const source = readFileSync(
    new URL('../../components/settings-chrome.tsx', import.meta.url),
    'utf8'
  );
  const row = source.split('export function SettingsNavRow(')[1].split('export function ')[0];
  expect(row).toContain('accessibilityLabel={detail ? `${label}, ${detail}` : label}');
  expect(row).toContain('accessibilityState={{ disabled, busy }}');
  expect(row).toContain('disabled={disabled}');
  expect(row).toContain('testID={testID}');
});
