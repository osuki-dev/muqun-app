import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { setupI18n } from '@lingui/core';
import { readApprovalBody } from '../agent-engine-text';
import { messages } from '../../i18n/locales/en/messages';

// Pure parser/catalog contracts only. Native card wording/occurrence checks live
// in notifications-compact-lifecycle; this does not render or simulate React.
test('unknown approval keys preserve their complete subject, including additional colons', () => {
  expect(readApprovalBody('custom_permission: /critical/file.ts')).toEqual({
    action: 'custom_permission',
    subject: '/critical/file.ts',
  });
  expect(readApprovalBody('unknown_fixture_rule: /fixture/permission-tail.ts')).toEqual({
    action: 'unknown_fixture_rule',
    subject: '/fixture/permission-tail.ts',
  });
  expect(readApprovalBody('custom_permission: /critical/file.ts:80\nKeep this context.')).toEqual({
    action: 'custom_permission',
    subject: '/critical/file.ts:80\nKeep this context.',
  });
});

test('known edit and the old bash example parse without consuming or repeating their subject', () => {
  expect(readApprovalBody('edit: /fixture/permission-tail.ts')).toEqual({
    action: 'edit',
    subject: '/fixture/permission-tail.ts',
  });
  expect(readApprovalBody('bash: echo hello')).toEqual({ action: 'bash', subject: 'echo hello' });
});

test('the actual English catalog translates edit and bash phrases without a fallback', () => {
  const local = setupI18n();
  local.load('en', messages);
  local.activate('en');
  // Same Lingui ID calculation as the existing catalogs.test.ts contracts.
  for (const phrase of ['Edit a file', 'Run a command']) {
    const id = createHash('sha256').update(`${phrase}\u001f`).digest('base64').slice(0, 6);
    expect(Object.hasOwn(messages, id)).toBe(true);
    expect(local._(id)).toBe(phrase);
  }
});
