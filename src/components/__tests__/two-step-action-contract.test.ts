/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const twoStepAction = readFileSync(join(COMPONENTS, 'two-step-action.tsx'), 'utf8');
const customThemeLibrary = readFileSync(join(COMPONENTS, 'custom-theme-library.tsx'), 'utf8');

describe('inline theme removal confirmation', () => {
  test('the reusable action supports controlled, disabled compact actions', () => {
    expect(twoStepAction).toContain('armed?: boolean;');
    expect(twoStepAction).toContain('disabled?: boolean;');
    expect(twoStepAction).toContain("presentation?: 'default' | 'compact';");
    expect(twoStepAction).toContain('if (disabled) return;');
    expect(twoStepAction).toContain('setArmed(false);\n      onConfirm();');
    expect(twoStepAction).toContain('setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS)');
  });

  test('each theme row controls the one armed removal action beside it', () => {
    expect(customThemeLibrary).toContain('<TwoStepAction');
    expect(customThemeLibrary).toContain('presentation="compact"');
    expect(customThemeLibrary).toContain('armed={pendingRemoval === installed.id}');
    expect(customThemeLibrary).toContain(
      'armed ? installed.id : current === installed.id ? null : current'
    );
    expect(customThemeLibrary).toContain('useThemeLibrary.getState().remove(installed.id);');
    expect(customThemeLibrary).not.toContain('theme-list-remove-confirm');
    expect(customThemeLibrary).not.toContain('theme-list-confirm-remove');
  });
});
