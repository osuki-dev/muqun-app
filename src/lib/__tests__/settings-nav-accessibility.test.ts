import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

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

test('Settings rows use profile spacing while retaining their minimum touch height', () => {
  const source = read('components/settings-chrome.tsx');
  for (const name of [
    'SettingsToggleRow',
    'SettingsNavRow',
    'SettingsChoiceRow',
    'SettingsInfoRow',
  ]) {
    const row = source.split(`export function ${name}(`)[1].split('export function ')[0];
    expect(row).toContain('const profile = useAppearanceProfile();');
    expect(row).toContain('paddingVertical: profile.settingsRowPaddingVertical');
  }
  expect(source).toContain('const ROW_MIN_HEIGHT = 60;');
  expect(source).toContain('minHeight: ROW_MIN_HEIGHT');
  expect(source).not.toContain('paddingVertical: LADDER.snug');
  const servers = read('components/settings-servers.tsx');
  expect(servers).toContain('paddingVertical: profile.settingsRowPaddingVertical');
  expect(servers).toContain('minHeight: 60');
  expect(read('components/settings-storage.tsx')).toContain(
    'paddingVertical: profile.settingsRowPaddingVertical'
  );
});

test('Settings and theme-management chrome consume semantic roles without profile branches', () => {
  const roles = {
    'components/settings-chrome.tsx': ['chrome.surface', 'chrome.control'],
    'components/settings-servers.tsx': ['chrome.control', 'radius.sm'],
    'components/settings-storage.tsx': ['chrome.control'],
    'app/settings.tsx': ['radius.sm'],
    'components/theme-appearance-settings.tsx': ['chrome.card'],
    'components/custom-theme-library.tsx': ['chrome.card', 'chrome.control', 'chrome.surface'],
    'components/theme-link-import.tsx': ['chrome.card'],
    'components/two-step-action.tsx': ['chrome.control'],
  };
  for (const [path, tokens] of Object.entries(roles)) {
    const source = read(path);
    expect(source).toContain('const profile = useAppearanceProfile();');
    expect(source).not.toContain('profile.id');
    expect(source).not.toContain('appChrome.radius');
    for (const token of tokens) expect(source).toContain(`borderRadius: profile.${token}`);
  }
  const chrome = read('components/settings-chrome.tsx');
  expect(chrome).not.toContain('profile.chrome.popover');
  expect(chrome).toContain('height: StyleSheet.hairlineWidth');
});

test('Settings groups draw only between-row separators, including flush and server lists', () => {
  const chrome = read('components/settings-chrome.tsx');
  const card = chrome.split('export function SettingsCard(')[1].split('export function ')[0];
  // Both the flush and painted lists place the rule before non-first rows.
  expect(card.match(/\{position > 0 \? <SettingsSeparator \/> : null\}/g)).toHaveLength(2);
  expect(card.match(/<SettingsSeparator \/>/g)).toHaveLength(2);
  const servers = read('components/settings-servers.tsx');
  expect(servers).toContain('{index > 0 ? <SettingsSeparator /> : null}');
  // SettingsCard owns top-level rules; explicit children would duplicate them.
  expect(servers.match(/<SettingsSeparator \/>/g)).toHaveLength(1);
  for (const path of [
    'components/settings-chrome.tsx',
    'components/settings-servers.tsx',
    'components/settings-storage.tsx',
    'app/settings.tsx',
    'components/theme-appearance-settings.tsx',
    'components/custom-theme-library.tsx',
    'components/theme-link-import.tsx',
    'components/two-step-action.tsx',
  ]) {
    expect(/borderBottomWidth\s*:/.test(read(path))).toBe(false);
  }
});

test('profile migration preserves artwork, status chips and the confirmation timer indicator', () => {
  expect(read('components/custom-theme-library.tsx')).toContain(
    'style={{ ...size, borderRadius: 8 }}'
  );
  expect(read('components/settings-servers.tsx')).toContain('borderRadius: LADDER.gap');
  const action = read('components/two-step-action.tsx');
  expect(action.match(/borderRadius: profile.chrome.control/g)).toHaveLength(2);
  expect(action).toContain('height: 2');
  expect(action).toContain('minHeight: 44');
});
