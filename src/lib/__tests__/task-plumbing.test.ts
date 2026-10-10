import { describe, expect, test } from 'bun:test';

import type { TimelineItem } from '../agent-protocol';
import { stripTaskInstruction, stripTaskMarkers, withoutTaskPlumbing } from '../task-plumbing';

/** The request exactly as the gateway's `completion_request` words it. */
const REQUEST =
  'When the whole task is finished, call the muqun tool tasks.complete with a one-line ' +
  'summary, or with outcome "blocked" and the reason if you stopped because you need the ' +
  'user (a missing file, an unclear request, a permission you cannot get); if you cannot ' +
  'call it, print one line exactly in this form: MUQUN_TASK_DONE: <one-line summary> -- ' +
  'or, blocked, MUQUN_TASK_BLOCKED: <one-line reason>';

describe('stripTaskInstruction', () => {
  test.each([
    ['goal only', 'Fix the build', 'Fix the build'],
    ['goal + request', `Fix the build\n\n${REQUEST}`, 'Fix the build'],
    ['request only', REQUEST, ''],
    [
      'a message that merely mentions the marker',
      'Why does it print MUQUN_TASK_DONE: twice?',
      'Why does it print MUQUN_TASK_DONE: twice?',
    ],
    [
      'the head sentence without the request after it',
      'When the whole task is finished, tell me.',
      'When the whole task is finished, tell me.',
    ],
  ])('%s', (_, text, expected) => {
    expect(stripTaskInstruction(text)).toBe(expected);
  });
});

describe('stripTaskMarkers', () => {
  test.each<[string, string, boolean, string]>([
    ['no marker', 'All green.', false, 'All green.'],
    [
      'trailing done line',
      'All green.\n\nMUQUN_TASK_DONE: the build is green',
      false,
      'All green.',
    ],
    [
      'bulleted blocked line',
      'Stopped.\n⏺ MUQUN_TASK_BLOCKED: notes.md is missing',
      false,
      'Stopped.',
    ],
    ['backticked line', 'Done.\n`MUQUN_TASK_DONE: built`', false, 'Done.'],
    ['marker only', '  - MUQUN_TASK_DONE: done', false, ''],
    [
      'mid-line mention stays',
      'It prints `MUQUN_TASK_DONE:` at the end',
      false,
      'It prints `MUQUN_TASK_DONE:` at the end',
    ],
    ['partial last line is held while streaming', 'Done.\nMUQUN_TASK_D', true, 'Done.'],
    ['and released at the turn end', 'Done.\nMUQUN_TASK_D', false, 'Done.\nMUQUN_TASK_D'],
    ['a terminated line is not held', 'Done.\nMUQUN\n', true, 'Done.\nMUQUN\n'],
  ])('%s', (_, text, streaming, expected) => {
    expect(stripTaskMarkers(text, streaming)).toBe(expected);
  });
});

describe('withoutTaskPlumbing', () => {
  const row = (role: TimelineItem['role'], part: TimelineItem['part']): TimelineItem => ({
    id: 'p',
    message_id: 'm',
    role,
    ordinal: 0,
    part,
    seq: 1,
    updated_ms: 1,
  });

  test.each<[string, TimelineItem, string | null]>([
    ['a synthetic part is not drawn', row('user', { type: 'synthetic', text: REQUEST }), null],
    [
      'a skill invocation keeps its notice',
      row('system', { type: 'synthetic', text: 'review', description: 'skill-invocation' }),
      'skill-invocation',
    ],
    ['a request-only user part is not drawn', row('user', { type: 'text', text: REQUEST }), null],
    [
      'a marker-only reply part is not drawn',
      row('assistant', { type: 'text', text: 'MUQUN_TASK_DONE: x' }),
      null,
    ],
    [
      'a reply keeps its prose',
      row('assistant', { type: 'text', text: 'Done.\nMUQUN_TASK_DONE: x' }),
      'Done.',
    ],
    [
      'a user goal keeps its words',
      row('user', { type: 'text', text: `Goal\n\n${REQUEST}` }),
      'Goal',
    ],
  ])('%s', (_, item, expected) => {
    const shown = withoutTaskPlumbing(item);
    const part = shown?.part;
    expect(
      part?.type === 'synthetic' ? part.description : part?.type === 'text' ? part.text : null
    ).toBe(expected);
  });

  test('an untouched row is the same object', () => {
    const item = row('assistant', { type: 'text', text: 'All green.' });
    expect(withoutTaskPlumbing(item)).toBe(item);
  });
});
