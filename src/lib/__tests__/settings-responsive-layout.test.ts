/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'settings.tsx'),
  'utf8'
);

function styleBody(style: string): string {
  const match = source.match(new RegExp(`\\b${style}:\\s*\\{(.*?)\\n  \\}`, 's'));
  if (!match) throw new Error(`No style found for "${style}"`);
  return match[1];
}

describe('settings responsive grid', () => {
  test('uses the shared window-width policy to opt into Pad layout', () => {
    expect(source).toContain("responsiveWorkspaceLayout(width).mode === 'pad'");
    expect(source).toContain('useWindowDimensions()');
  });

  test('keeps the default flow single-column and only wraps in Pad mode', () => {
    expect(source).toContain(
      'style={[styles.deepSections, isPadLayout && styles.deepSectionsPad]}'
    );
    expect(styleBody('deepSections')).not.toContain('flexDirection');
    expect(styleBody('deepSectionsPad')).toContain("flexDirection: 'row'");
    expect(styleBody('deepSectionsPad')).toContain("flexWrap: 'wrap'");
    expect(styleBody('deepSectionPad')).toContain("flexBasis: '48%'");
  });

  test('preserves the compact reading order', () => {
    const sectionOrder = [
      '<SettingsServers',
      '<SettingsAppearance',
      '<SettingsTerminal',
      '<SettingsAlerts',
      '<SettingsSecurity',
      '<SettingsSection title={t`About`}',
    ].map((section) => source.indexOf(section));

    expect(sectionOrder.every((position) => position >= 0)).toBe(true);
    expect(sectionOrder).toEqual([...sectionOrder].sort((a, b) => a - b));
  });

  test('keeps the bounded content width in both layout modes', () => {
    const content = styleBody('content');
    expect(content).toContain("width: '100%'");
    expect(content).toContain('maxWidth: SETTINGS_CONTENT_MAX_WIDTH');
    expect(content).toContain("alignSelf: 'center'");
  });
});
