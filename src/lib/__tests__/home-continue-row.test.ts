import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_META_CHARS,
  homeContinueComputerLabel,
  homeContinueMetaChars,
  homeContinueMetaParts,
  homePathLabel,
  middleTruncatePath,
  terminalRowPath,
  terminalRowTitle,
} from '../home-continue-row';

describe('homePathLabel', () => {
  test('home roots read as ~', () => {
    expect(homePathLabel('/home/demo/projects/app')).toBe('~/projects/app');
    expect(homePathLabel('/Users/demo/code/')).toBe('~/code');
    expect(homePathLabel('/root')).toBe('~');
    expect(homePathLabel('/home/demo')).toBe('~');
  });

  test('other paths keep their spelling, minus a trailing slash', () => {
    expect(homePathLabel('/srv/app/')).toBe('/srv/app');
    expect(homePathLabel('/')).toBe('/');
    expect(homePathLabel('~/x')).toBe('~/x');
    expect(homePathLabel('/homework/a')).toBe('/homework/a');
    expect(homePathLabel('  ')).toBe('');
  });
});

describe('middleTruncatePath', () => {
  test('a path that fits is unchanged', () => {
    expect(middleTruncatePath('~/code/app', 20)).toBe('~/code/app');
  });

  test('the middle goes, the tail stays, cut at a folder boundary', () => {
    expect(middleTruncatePath('~/.cache/tmp/abc/def/proj', 16)).toBe('~/…/abc/def/proj');
    expect(middleTruncatePath('/var/lib/very/deep/thing', 14)).toBe('/…/deep/thing');
  });

  test('a single segment longer than the room keeps its own end', () => {
    expect(middleTruncatePath('~/a-very-long-folder-name', 10)).toBe('…lder-name');
  });

  test('never longer than the budget', () => {
    const path = '~/one/two/three/four/five/six/seven';
    for (let max = 4; max < path.length; max++) {
      expect(middleTruncatePath(path, max).length).toBeLessThanOrEqual(max);
    }
  });
});

describe('terminalRowTitle', () => {
  test('the cwd folder, never the prompt', () => {
    expect(
      terminalRowTitle({
        paneTitle: 'user@host:~/.cache/tmp/x/proj',
        cwd: '/home/user/.cache/tmp/x/proj',
      })
    ).toBe('proj');
  });

  test('without a cwd, the prompt prefix is stripped and a path gives its folder', () => {
    expect(terminalRowTitle({ paneTitle: 'user@host:~/code/app' })).toBe('app');
    expect(terminalRowTitle({ paneTitle: 'user@host: ~' })).toBe('~');
    expect(terminalRowTitle({ paneTitle: 'nvim' })).toBe('nvim');
    expect(terminalRowTitle({ paneTitle: 'user@host:' })).toBe('');
  });

  test('a plain pane prefers its cwd folder over a program name', () => {
    expect(terminalRowTitle({ paneTitle: 'zsh', cwd: '/srv/app' })).toBe('app');
  });

  test('an agent pane keeps a task title, but not a prompt', () => {
    expect(
      terminalRowTitle({ paneTitle: 'Fix the login bug', cwd: '/srv/app', hasAgent: true })
    ).toBe('Fix the login bug');
    expect(
      terminalRowTitle({ paneTitle: 'me@box:~/srv/app', cwd: '/srv/app', hasAgent: true })
    ).toBe('app');
  });

  test('an agent pane titled with its binary path is named by the agent', () => {
    expect(
      terminalRowTitle({
        paneTitle: "'/opt/homebrew/bin/codex'",
        cwd: '/Users/me/code/app',
        hasAgent: true,
        agentName: 'Codex',
      })
    ).toBe('Codex');
    expect(
      terminalRowTitle({ paneTitle: '/usr/local/bin/claude', hasAgent: true, agentName: 'Claude' })
    ).toBe('Claude');
    // No name to give it: the folder, as before, never the path.
    expect(
      terminalRowTitle({
        paneTitle: "'/opt/homebrew/bin/codex'",
        cwd: '/srv/app',
        hasAgent: true,
      })
    ).toBe('app');
  });
});

describe('terminalRowPath', () => {
  test('omitted when the title already says it', () => {
    expect(terminalRowPath('proj', '/home/u/proj')).toBeUndefined();
    expect(terminalRowPath('~', '/home/u')).toBeUndefined();
    expect(terminalRowPath('srv', '/srv')).toBeUndefined();
    expect(terminalRowPath('x', undefined)).toBeUndefined();
  });

  test('kept, ~-relative, when it adds where the folder is', () => {
    expect(terminalRowPath('proj', '/home/u/code/proj')).toBe('~/code/proj');
  });
});

describe('homeContinueComputerLabel', () => {
  const servers = [
    { serverId: 'a', label: 'Studio' },
    { serverId: 'b', label: '  ' },
  ];
  test("the paired record's label", () => {
    expect(homeContinueComputerLabel(servers, 'a')).toBe('Studio');
  });
  test('nothing for an unknown, blank or absent computer', () => {
    expect(homeContinueComputerLabel(servers, 'b')).toBeUndefined();
    expect(homeContinueComputerLabel(servers, 'z')).toBeUndefined();
    expect(homeContinueComputerLabel(servers, undefined)).toBeUndefined();
  });
});

describe('homeContinueMetaParts', () => {
  test('kind · computer · path · status · seen, empty parts dropped', () => {
    expect(
      homeContinueMetaParts({
        kind: 'OpenCode',
        computer: 'Studio',
        path: '~/code/app',
        status: 'Idle',
        seen: 'Seen just now',
        maxChars: 80,
      })
    ).toEqual([
      { role: 'kind', text: 'OpenCode' },
      { role: 'computer', text: 'Studio' },
      { role: 'path', text: '~/code/app' },
      { role: 'status', text: 'Idle' },
      { role: 'seen', text: 'Seen just now' },
    ]);
    expect(homeContinueMetaParts({ kind: 'Terminal', computer: '', path: undefined })).toEqual([
      { role: 'kind', text: 'Terminal' },
    ]);
  });

  test('the path takes what the rest of the line leaves', () => {
    const parts = homeContinueMetaParts({
      kind: 'Terminal',
      computer: 'Studio',
      path: '~/.cache/tmp/abcdef/ghijkl/proj',
      maxChars: 40,
    });
    const line = parts.map((part) => part.text).join(' · ');
    expect(line.length).toBeLessThanOrEqual(40);
    expect(parts[2]!.text.endsWith('/proj')).toBe(true);
    expect(parts[2]!.text).toContain('…');
  });

  test('a crowded line still keeps a readable tail', () => {
    const parts = homeContinueMetaParts({
      kind: 'OpenCode',
      computer: 'A very long computer name indeed',
      path: '~/one/two/three/four/five/six',
      status: 'Running',
      seen: 'Seen 5m ago',
      maxChars: 30,
    });
    expect(parts[2]!.text.length).toBe(12);
  });
});

describe('homeContinueMetaChars', () => {
  test('scales with width and font size', () => {
    expect(homeContinueMetaChars(0, 12)).toBe(DEFAULT_META_CHARS);
    expect(homeContinueMetaChars(300, 12)).toBeGreaterThan(homeContinueMetaChars(200, 12));
    expect(homeContinueMetaChars(300, 16)).toBeLessThan(homeContinueMetaChars(300, 12));
  });
});

describe('homeContinueComputerLabel with more than one computer', () => {
  test("a row's own computer wins, never another record's label", () => {
    const servers = [
      { serverId: 'host-default', label: 'workstation' },
      { serverId: 'renamed', label: 'coding' },
    ];
    expect(homeContinueComputerLabel(servers, 'renamed')).toBe('coding');
    expect(homeContinueComputerLabel(servers, 'host-default')).toBe('workstation');
  });

  test('a serverId no paired record has gets no label at all', () => {
    expect(
      homeContinueComputerLabel([{ serverId: 'renamed', label: 'coding' }], 'workstation')
    ).toBe(undefined);
  });
});
