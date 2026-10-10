import { describe, expect, test } from 'bun:test';

import {
  deleteMentionAtomically,
  mentionRanges,
  orderMentionComputers,
  taskMentions,
  type MentionComputer,
  type MentionToken,
} from '../composer-mentions';

const mini: MentionToken = { text: '@mini', kind: 'computer' };
const nas: MentionToken = { text: '@nas', kind: 'computer' };
const macMini: MentionToken = { text: '@mac mini', kind: 'computer' };
const mac: MentionToken = { text: '@mac', kind: 'computer' };
const file: MentionToken = { text: 'src/a.ts', kind: 'file' };

describe('mentionRanges: which spans of the draft are drawn as mentions', () => {
  test.each([
    [
      'a computer at the start',
      '@mini check the build',
      [mini],
      [{ start: 0, end: 5, kind: 'computer' }],
    ],
    [
      'two computers',
      'ask @mini and @nas',
      [mini, nas],
      [
        { start: 4, end: 9, kind: 'computer' },
        { start: 14, end: 18, kind: 'computer' },
      ],
    ],
    ['an address is not a mention', 'mail a@mini.com', [mini], []],
    ['a longer word is not a mention', '@minis', [mini], []],
    [
      'a file path inserted from the sheet',
      'open src/a.ts now',
      [file],
      [{ start: 5, end: 13, kind: 'file' }],
    ],
    [
      'the longest token wins an overlap',
      'ask @mac mini now',
      [mac, macMini],
      [{ start: 4, end: 13, kind: 'computer' }],
    ],
    ['nothing typed', '', [mini], []],
  ] as const)('%s', (_name, text, tokens, expected) => {
    expect(mentionRanges(text, tokens)).toEqual([...expected]);
  });
});

describe('deleteMentionAtomically: a backspace at the end of a mention takes the whole token', () => {
  test.each([
    ['at the end of a computer', '@mini ', '@min ', [mini], { text: ' ', caret: 0 }],
    ['after other words', 'ask @mini', 'ask @min', [mini], { text: 'ask ', caret: 4 }],
    [
      'at the end of a file path',
      'src/a.ts done',
      'src/a.t done',
      [file],
      { text: ' done', caret: 0 },
    ],
    ['the space after a mention is an ordinary character', '@mini ', '@mini', [mini], null],
    ['a deletion inside a mention is ordinary editing', '@mini x', '@mni x', [mini], null],
    ['typing is not a deletion', '@mini', '@mini!', [mini], null],
    ['a replaced selection is not a backspace', '@mini x', 'y', [mini], null],
  ] as const)('%s', (_name, prev, next, tokens, expected) => {
    expect(deleteMentionAtomically(prev, next, mentionRanges(prev, tokens))).toEqual(expected);
  });
});

describe('orderMentionComputers: the Computers group, current first', () => {
  const computer = (name: string, reachable: boolean, current = false): MentionComputer => ({
    serverId: `srv-${name}`,
    name,
    reachable,
    current,
  });
  const fleet = [
    computer('nas', false),
    computer('mini', true),
    computer('coding', true, true),
    computer('mac', true),
  ];
  test.each([
    ['current, then reachable, then unreachable', '', ['coding', 'mini', 'mac', 'nas']],
    ['a typed prefix filters, case-insensitively', 'M', ['mini', 'mac']],
    ['no computer matches', 'x', []],
  ] as const)('%s', (_name, query, expected) => {
    expect(orderMentionComputers(fleet, query).map((entry) => entry.name)).toEqual([...expected]);
  });
});

describe('taskMentions: only what the target computer has linked, as it names them', () => {
  const offered: MentionComputer[] = [
    { serverId: 'srv-coding', name: 'coding', reachable: true, current: true },
    { serverId: 'srv-mini', name: 'mini', reachable: true, current: false },
    { serverId: 'srv-nas', name: 'nas', reachable: true, current: false },
  ];
  const peers = [{ serverId: 'srv-mini', name: 'mac-mini' }];
  test.each([
    [
      'a linked peer by its own name; the target as self',
      '@mini and @coding',
      ['mac-mini', 'self'],
    ],
    ['a computer the target has not linked is dropped', '@nas please', []],
    ['nothing named', 'just do it', []],
  ] as const)('%s', (_name, text, expected) => {
    expect(taskMentions(text, offered, peers)).toEqual([...expected]);
  });
});
