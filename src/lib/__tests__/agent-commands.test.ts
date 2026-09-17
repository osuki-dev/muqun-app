import { describe, expect, test } from 'bun:test';

import type { CommandInfo } from '../agent-protocol';
import {
  AGENT_CLIENT_COMMANDS,
  commandKey,
  isClientCommand,
  readSlashCommand,
} from '../agent-commands';

const SERVER: CommandInfo[] = [
  { name: 'review', description: 'Review the branch', agent: 'plan' },
  { name: '/deploy', description: 'Ship it' },
];

describe('commandKey', () => {
  test('the bare name, without the slash or the arguments', () => {
    expect(commandKey('/review branch')).toBe('review');
    expect(commandKey('review')).toBe('review');
    expect(commandKey('  /Review  ')).toBe('review');
    expect(commandKey('')).toBe('');
    expect(commandKey('/')).toBe('');
  });
});

describe('readSlashCommand', () => {
  test('an ordinary prompt is not a command', () => {
    expect(readSlashCommand('what does this do?', SERVER)).toBeNull();
    expect(readSlashCommand('', SERVER)).toBeNull();
  });

  test("the host's catalog, with its arguments", () => {
    expect(readSlashCommand('/review branch main', SERVER)).toEqual({
      kind: 'server',
      name: 'review',
      args: 'branch main',
    });
    expect(readSlashCommand('/review', SERVER)).toEqual({
      kind: 'server',
      name: 'review',
      args: '',
    });
  });

  test('a catalog name that already carries its slash round-trips', () => {
    expect(readSlashCommand('/deploy now', SERVER)).toEqual({
      kind: 'server',
      name: '/deploy',
      args: 'now',
    });
  });

  test("the app's own commands", () => {
    expect(readSlashCommand('/new', SERVER)).toEqual({ kind: 'client', name: 'new', args: '' });
    expect(readSlashCommand('/compact', SERVER)).toEqual({
      kind: 'client',
      name: 'compact',
      args: '',
    });
    expect(readSlashCommand('/EXPORT', SERVER)).toEqual({
      kind: 'client',
      name: 'export',
      args: '',
    });
  });

  test('the host wins over the app for the same name', () => {
    // A host that ships its own `/compact` means that one.
    const withCompact: CommandInfo[] = [...SERVER, { name: 'compact' }];
    expect(readSlashCommand('/compact', withCompact)).toEqual({
      kind: 'server',
      name: 'compact',
      args: '',
    });
  });

  test('a slash that matches nothing is a prompt, not a refusal', () => {
    // A model is perfectly able to be asked about a path.
    expect(readSlashCommand('/etc/hosts is world readable?', SERVER)).toBeNull();
    expect(readSlashCommand('/nonsense', [])).toBeNull();
  });

  test('every listed client command routes to itself', () => {
    for (const command of AGENT_CLIENT_COMMANDS) {
      const parsed = readSlashCommand(command.name, []);
      expect(parsed).toEqual({ kind: 'client', name: command.id, args: '' });
      expect(isClientCommand(command.id)).toBe(true);
    }
  });

  test('the menu carries the eight the app answers', () => {
    expect(AGENT_CLIENT_COMMANDS.map((command) => command.name)).toEqual([
      '/new',
      '/sessions',
      '/models',
      '/agents',
      '/undo',
      '/redo',
      '/compact',
      '/export',
    ]);
  });

  test('isClientCommand says no to a name that is not one', () => {
    expect(isClientCommand('review')).toBe(false);
  });
});
