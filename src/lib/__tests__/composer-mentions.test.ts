import { expect, test } from 'bun:test';
import { taskMentions, type MentionComputer } from '../composer-mentions';

const offered: MentionComputer[] = [
  { serverId: 'local-id', name: 'local', current: true, reachable: true },
  { serverId: 'remote-id', name: 'mini', current: false, reachable: true },
];

test('computer references resolve by identity even when the peer was renamed', () => {
  expect(
    taskMentions('@local inspect @mini', offered, [{ serverId: 'remote-id', name: 'studio' }])
  ).toEqual(['self', 'studio']);
});

test('a replacement computer with the same name cannot inherit a reference', () => {
  expect(
    taskMentions('@mini inspect', offered, [{ serverId: 'replacement', name: 'mini' }])
  ).toBeNull();
});

test('a missing peer refuses the whole request instead of dropping one reference', () => {
  expect(taskMentions('@local inspect @mini', offered, [])).toBeNull();
});

test('ambiguous displayed names and legacy wire names cannot pick a destination', () => {
  const peers = [{ serverId: 'remote-id', name: 'mini' }];
  expect(
    taskMentions('@mini inspect', [...offered, { ...offered[1]!, serverId: 'other' }], peers)
  ).toBeNull();
  expect(
    taskMentions('@mini inspect', offered, [...peers, { serverId: 'other', name: 'MINI' }])
  ).toBeNull();
  expect(
    taskMentions('@mini inspect', offered, [{ serverId: 'remote-id', name: 'self' }])
  ).toBeNull();
});

test('too many named computers cannot be silently truncated', () => {
  const computers = Array.from({ length: 9 }, (_, index) => ({
    serverId: `id-${index}`,
    name: `computer-${index}`,
    reachable: true,
    current: false,
  }));
  expect(
    taskMentions(computers.map(({ name }) => `@${name}`).join(' '), computers, computers)
  ).toBeNull();
});

test('file mentions and ordinary text need no computer resolution', () => {
  expect(taskMentions('Read @src/mini.ts', offered, [])).toEqual([]);
  expect(taskMentions('inspect the project', offered, [])).toEqual([]);
});
