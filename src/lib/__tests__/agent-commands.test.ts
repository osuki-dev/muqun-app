import { describe, expect, test } from 'bun:test';

import type { CommandInfo, SkillInfo } from '../agent-protocol';
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

const SKILLS: SkillInfo[] = [
  { id: 'commit-message', name: 'Commit message', description: 'Write one', slash: true },
  { id: 'Changelog', name: 'Changelog', description: 'Weekly digest', slash: true },
  // Not offered as a slash line: the agent reaches for it on its own.
  { id: 'pdf', name: 'PDF', description: 'Read a PDF', autoinvoke: true },
  // A catalog that predates the flag says nothing, which is not a yes.
  { id: 'docx', name: 'DOCX', description: 'Read a document' },
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
    // `/clear` is a listed command rather than a string the send path matches.
    expect(readSlashCommand('/clear', SERVER)).toEqual({
      kind: 'client',
      name: 'clear',
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

  test('a catalog skill is its own kind, carrying the skill id', () => {
    expect(readSlashCommand('/commit-message', SERVER, SKILLS)).toEqual({
      kind: 'skill',
      name: 'commit-message',
      args: '',
    });
    // The id is the wire value, whatever case it was typed in.
    expect(readSlashCommand('/CHANGELOG last week', SERVER, SKILLS)).toEqual({
      kind: 'skill',
      name: 'Changelog',
      args: 'last week',
    });
  });

  test('a skill the catalog does not offer as a slash line stays a prompt', () => {
    expect(readSlashCommand('/pdf', SERVER, SKILLS)).toBeNull();
    expect(readSlashCommand('/docx', SERVER, SKILLS)).toBeNull();
  });

  test('a host command wins over a skill of the same name', () => {
    const shadowed: SkillInfo[] = [
      { id: 'review', name: 'Review', description: 'A skill called review', slash: true },
    ];
    expect(readSlashCommand('/review branch', SERVER, shadowed)).toEqual({
      kind: 'server',
      name: 'review',
      args: 'branch',
    });
  });

  test("a skill wins over the app's own command of the same name", () => {
    // Both come from the host; the app's list is the fallback for what no
    // catalog claims.
    const shadowing: SkillInfo[] = [
      { id: 'export', name: 'Export', description: 'The host\u2019s own export', slash: true },
    ];
    expect(readSlashCommand('/export', [], shadowing)).toEqual({
      kind: 'skill',
      name: 'export',
      args: '',
    });
  });

  test('with no skills passed, nothing changes', () => {
    expect(readSlashCommand('/commit-message', SERVER)).toBeNull();
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

  test('the menu carries the nine the app answers', () => {
    expect(AGENT_CLIENT_COMMANDS.map((command) => command.name)).toEqual([
      '/new',
      '/sessions',
      '/models',
      '/agents',
      '/undo',
      '/keep',
      '/compact',
      '/clear',
      '/export',
    ]);
  });

  test('isClientCommand says no to a name that is not one', () => {
    expect(isClientCommand('review')).toBe(false);
  });
});
