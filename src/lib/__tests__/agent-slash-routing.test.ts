import { describe, expect, test } from 'bun:test';

import { readSkillInvocation, readSlashCommand } from '../agent-commands';

describe('recipient-owned slash commands', () => {
  test('missing commands never invoke app navigation or swallow the prompt', () => {
    for (const name of [
      'new',
      'sessions',
      'models',
      'agents',
      'undo',
      'keep',
      'compact',
      'clear',
      'export',
    ]) {
      expect(readSlashCommand(`/${name} keep these arguments`, [])).toBeNull();
    }
    expect(readSlashCommand('/etc/hosts', [])).toBeNull();
    expect(readSlashCommand('/', [])).toBeNull();
  });

  test('native commands keep their exact names and arguments, including former app names', () => {
    const commands = [{ name: '/clear' }, { name: 'models' }];
    expect(readSlashCommand('/CLEAR preserve draft', commands)).toEqual({
      kind: 'server',
      name: '/clear',
      args: 'preserve draft',
    });
    expect(readSlashCommand('/models provider/model', commands)).toEqual({
      kind: 'server',
      name: 'models',
      args: 'provider/model',
    });
    expect(readSlashCommand('/clear', [])).toBeNull();
  });

  test('only reported slash skills run, and native commands take precedence', () => {
    const skills = [{ id: 'clear', name: 'Clear review', description: '', slash: true }];
    expect(readSlashCommand('/clear review', [], skills)).toEqual({
      kind: 'skill',
      name: 'clear',
      args: 'review',
    });
    expect(readSlashCommand('/clear review', [{ name: 'clear' }], skills)).toEqual({
      kind: 'server',
      name: 'clear',
      args: 'review',
    });
    expect(readSlashCommand('/clear review', [], [{ ...skills[0], slash: false }])).toBeNull();
    expect(readSkillInvocation('$clear review', skills)).toEqual({ name: 'clear', args: 'review' });
  });
});
