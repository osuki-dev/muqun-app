import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { decorationSchema } from '../schema';

// Contract guard, not a replacement for native screenshots or interaction QA.
// Every advertised slot must retain a real consumer rather than a schema-only promise.
const consumers = {
  'shell.background': 'src/app/settings.tsx',
  'home.background': 'src/app/(drawer)/index.tsx',
  'home.decoration': 'src/app/(drawer)/index.tsx',
  'navigation.background': 'src/components/glass-chrome.tsx',
  'composer.background': 'src/components/glass-chrome.tsx',
  'actions.background': 'src/components/glass-chrome.tsx',
  'cards.decoration': 'src/components/settings-chrome.tsx',
  'buttons.primary.background': 'src/components/themed-button.tsx',
  'tabs.background': 'src/app/commands.tsx',
  'emptyState.illustration': 'src/app/(drawer)/index.tsx',
} as const;

test('every supported artwork slot has a named runtime consumer', () => {
  expect(Object.keys(decorationSchema.shape).sort()).toEqual(Object.keys(consumers).sort());
  for (const [slot, file] of Object.entries(consumers)) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('glass-chrome.tsx')) {
      expect(source).toContain('`${surface}.background`');
    } else {
      expect(source).toContain(slot);
    }
  }
});

test('theme operation messages retain a shared readable surface without fading their text', () => {
  const source = readFileSync('src/components/custom-theme-library.tsx', 'utf8');
  const message = source.match(/testID="theme-status-message"[\s\S]*?<\/View>/)?.[0];
  expect(message).toBeDefined();
  expect(message).toContain('backgroundColor: background(colors.surfaceRaised)');
  expect(message).toContain('accessibilityRole="alert"');
  expect(message).toContain('accessibilityLiveRegion="polite"');
  expect(message).toContain('{error}');
  expect(message).toContain('{notice}');
  expect(/\bopacity\s*:/.test(message ?? '')).toBe(false);
});
