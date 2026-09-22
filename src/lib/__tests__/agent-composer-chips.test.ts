import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { composerChipIds, type ComposerChipState } from '../agent-composer-chips';

const quiet: ComposerChipState = {
  canOpenSessions: true,
  canOpenModel: true,
  taskCount: 0,
  canOpenTasks: false,
  inboxCount: 0,
  backgroundCount: 0,
  canOpenBackground: true,
  hasContextPill: false,
  hasDiffs: false,
  running: false,
};

describe('composerChipIds', () => {
  test('an idle session shows the three it always has', () => {
    expect(composerChipIds(quiet)).toEqual(['sessions', 'mode', 'model']);
  });

  test('the agent chip is there even with no sheets to open', () => {
    expect(composerChipIds({ ...quiet, canOpenSessions: false, canOpenModel: false })).toEqual([
      'mode',
    ]);
  });

  test('the changes chip survives the context pill', () => {
    // The bug this file exists for: the changes chip was last in a chain of
    // conditionals and went missing on exactly the sessions that had spent
    // tokens -- which are the sessions that changed files.
    const chips = composerChipIds({ ...quiet, hasContextPill: true, hasDiffs: true });
    expect(chips).toContain('context');
    expect(chips).toContain('diff');
  });

  test('every chip can stand at once', () => {
    expect(
      composerChipIds({
        canOpenSessions: true,
        canOpenModel: true,
        taskCount: 3,
        canOpenTasks: true,
        inboxCount: 2,
        backgroundCount: 1,
        canOpenBackground: true,
        hasContextPill: true,
        hasDiffs: true,
        running: true,
      })
    ).toEqual([
      'sessions',
      'mode',
      'model',
      'inbox',
      'background',
      'tasks',
      'delivery',
      'context',
      'diff',
      'stop',
    ]);
  });

  test('the rendered controls follow the chip order, with Stop last in native traversal', () => {
    const source = readFileSync(
      new URL('../../components/agent-composer.tsx', import.meta.url),
      'utf8'
    );
    const renderedOrder = Array.from(
      source.matchAll(/chipIds\.has\('([^']+)'\)/g),
      (match) => match[1]
    );
    expect(renderedOrder).toEqual(
      composerChipIds({
        ...quiet,
        canOpenTasks: true,
        inboxCount: 1,
        backgroundCount: 1,
        hasContextPill: true,
        hasDiffs: true,
        running: true,
      })
    );
  });

  test('Stop stays last with either or both trailing status controls absent', () => {
    for (const hasContextPill of [false, true]) {
      for (const hasDiffs of [false, true]) {
        const chips = composerChipIds({ ...quiet, running: true, hasContextPill, hasDiffs });
        expect(chips.at(-1)).toBe('stop');
        expect(chips.filter((id) => id === 'stop')).toHaveLength(1);
      }
    }
  });

  test('tasks appear for a published list even with no sheet behind them', () => {
    expect(composerChipIds({ ...quiet, taskCount: 2 })).toContain('tasks');
  });

  test('what is running in the background needs somewhere to go', () => {
    expect(
      composerChipIds({ ...quiet, backgroundCount: 2, canOpenBackground: false })
    ).not.toContain('background');
  });

  test('steering and stopping belong to a turn in flight', () => {
    expect(composerChipIds({ ...quiet, running: true })).toEqual([
      'sessions',
      'mode',
      'model',
      'delivery',
      'stop',
    ]);
  });
});
