import { expect, test } from 'bun:test';

import { paneSkillsFromAnswer } from '../pane-composer';

const skill = { name: 'review', description: 'Review the diff', source: 'workspace' as const };

test('a known prefix with skills yields both', () => {
  expect(paneSkillsFromAnswer({ skill_prefix: '/', skills: [skill] })).toEqual({
    skillPrefix: '/',
    skills: [skill],
  });
  expect(paneSkillsFromAnswer({ skill_prefix: '$', skills: [] })).toEqual({
    skillPrefix: '$',
    skills: [],
  });
});

test('no prefix, an unknown prefix or no list yields nothing', () => {
  expect(paneSkillsFromAnswer({ skills: [skill] })).toEqual({});
  expect(paneSkillsFromAnswer({ skill_prefix: '#', skills: [skill] })).toEqual({});
  expect(paneSkillsFromAnswer({ skill_prefix: '/' })).toEqual({});
  expect(paneSkillsFromAnswer(null)).toEqual({});
});

test('entries that cannot be typed as one token or are malformed are dropped', () => {
  const answer = paneSkillsFromAnswer({
    skill_prefix: '$',
    skills: [
      skill,
      { name: 'two words', description: '', source: 'user' },
      { name: '', description: '', source: 'user' },
      { name: 'x', description: 'no source' },
      { name: 'y', description: 'odd source', source: 'plugin' },
      'z',
    ],
  });
  expect(answer).toEqual({ skillPrefix: '$', skills: [skill] });
});
