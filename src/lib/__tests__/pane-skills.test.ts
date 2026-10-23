import { expect, test } from 'bun:test';

import { paneComposerExtrasFromAnswer } from '../pane-composer';

const skill = { name: 'review', description: 'Review the diff', source: 'workspace' as const };

test('skills and file mentions are read when the Gateway sends them', () => {
  expect(paneComposerExtrasFromAnswer({ skills: [skill], file_mentions: true })).toEqual({
    skills: [skill],
    fileMentions: true,
  });
  expect(paneComposerExtrasFromAnswer({ skills: [], file_mentions: false })).toEqual({
    skills: [],
    fileMentions: false,
  });
});

test('an older Gateway that sends neither offers nothing', () => {
  expect(paneComposerExtrasFromAnswer({ keys: [] })).toEqual({});
  expect(paneComposerExtrasFromAnswer(null)).toEqual({});
  expect(paneComposerExtrasFromAnswer({ file_mentions: 'yes' })).toEqual({});
});

test('entries that are not one plain token or are malformed are dropped', () => {
  const answer = paneComposerExtrasFromAnswer({
    skills: [
      skill,
      { name: 'two words', description: '', source: 'user' },
      { name: 'ok\u001b[2J', description: '', source: 'user' },
      { name: 'line\nbreak', description: '', source: 'user' },
      { name: '', description: '', source: 'user' },
      { name: 'x', description: 'no source' },
      { name: 'y', description: 'odd source', source: 'plugin' },
      'z',
    ],
  });
  expect(answer).toEqual({ skills: [skill] });
});
