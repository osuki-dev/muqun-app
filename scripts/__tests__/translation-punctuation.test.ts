import { expect, test } from 'bun:test';

import { normalizeCatalog, withoutClosingFullStop } from '../normalize-translation-punctuation';

test('only removes a closing full stop', () => {
  expect(withoutClosingFullStop('First sentence. Last sentence.')).toBe(
    'First sentence. Last sentence'
  );
  expect(withoutClosingFullStop('跟随主题。')).toBe('跟随主题');
  expect(withoutClosingFullStop('Waiting...')).toBe('Waiting...');
  expect(withoutClosingFullStop('Waiting…')).toBe('Waiting…');
  expect(withoutClosingFullStop('Continue?')).toBe('Continue?');
  expect(withoutClosingFullStop('Version 0.9.0')).toBe('Version 0.9.0');
});

test('keeps message ids, placeholders and headers intact', () => {
  const source = 'msgid "Hello {name}."\nmsgstr "你好 {name}。"\n';
  const normalized = normalizeCatalog(source);
  expect(normalized).toBe('msgid "Hello {name}."\nmsgstr "你好 {name}"\n');
  expect(normalizeCatalog(normalized)).toBe(normalized);
  expect(normalizeCatalog('msgid ""\nmsgstr ""\n"Language: en\\n"\n')).toBe(
    'msgid ""\nmsgstr ""\n"Language: en\\n"\n'
  );
  expect(normalizeCatalog('msgstr ""\n"First. "\n"Last."')).toBe('msgstr "First. Last"');
});
