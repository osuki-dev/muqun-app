import { describe, expect, test } from 'bun:test';

import { paneAgentLine } from '@/lib/pane-agent-line';

const screen = (...lines: string[]) => lines.join('\n');

describe('paneAgentLine: Claude Code', () => {
  test('the last message after tool calls, rejoined, without the composer or footer', () => {
    const capture = screen(
      '> review the PR on this branch',
      '',
      '⏺ I will start by reading the diff.',
      '',
      '⏺ Bash(git diff main...HEAD --stat)',
      '  ⎿  src/lib/home-thread.ts | 42 ++++++++++++++++++++--',
      '     src/components/home-thread.tsx | 12 +++---',
      '     … +40 lines (ctrl+r to expand)',
      '',
      '⏺ The change looks good overall. Two issues: the parse() fallback misses a',
      '  null check, and one test name has a typo.',
      '',
      '╭──────────────────────────────────────────────────────────────────────╮',
      '│ >                                                                    │',
      '╰──────────────────────────────────────────────────────────────────────╯',
      '  ? for shortcuts                                    ◯ IDE disconnected'
    );
    expect(paneAgentLine(capture)).toBe(
      'The change looks good overall. Two issues: the parse() fallback misses a null check, and one test name has a typo.'
    );
  });

  test('a spinner and token counter under the reply are not the reply', () => {
    const capture = screen(
      '> add tests for the parser',
      '',
      '● Reading the parser first.',
      '',
      '● Read(src/lib/parser.ts)',
      '  ⎿  Read 120 lines (ctrl+o to expand)',
      '',
      '✻ Cogitating… (12s · ↑ 1.2k tokens · esc to interrupt)',
      '',
      '────────────────────────────────────────────────',
      '> ',
      '────────────────────────────────────────────────',
      '  ⏵⏵ accept edits on (shift+tab to cycle)'
    );
    expect(paneAgentLine(capture)).toBe('Reading the parser first.');
  });

  test('nothing yet since the reader’s message: the previous turn’s reply is not shown', () => {
    const capture = screen(
      '⏺ Done. All checks pass.',
      '',
      '> now open a PR',
      '',
      '✶ Pondering… (3s · esc to interrupt)',
      '',
      '────────────────',
      '> ',
      '────────────────'
    );
    expect(paneAgentLine(capture)).toBeUndefined();
  });

  test('a tool call whose header is status text does not lend its output to the message above', () => {
    const capture = screen(
      '> check it',
      '⏺ Let me look at the files.',
      '⏺ Read 3 files (ctrl+o to expand)',
      '  ⎿  src/a.ts',
      '> '
    );
    expect(paneAgentLine(capture)).toBe('Let me look at the files.');
  });

  test('the welcome banner and a boxed permission dialog are chrome', () => {
    const capture = screen(
      '╭───────────────────────────────────────╮',
      '│ ✻ Welcome to Claude Code!             │',
      '│   cwd: /work/app                      │',
      '╰───────────────────────────────────────╯',
      '',
      '╭───────────────────────────────────────╮',
      '│ Do you want to proceed?               │',
      '│ ❯ 1. Yes                              │',
      '│   2. No                               │',
      '╰───────────────────────────────────────╯'
    );
    expect(paneAgentLine(capture)).toBeUndefined();
  });

  test('escape sequences in the capture are stripped', () => {
    const capture = screen(
      '\u001b[2m> \u001b[0mfix it',
      '\u001b[38;5;246m⏺\u001b[0m \u001b[1mFixed\u001b[0m the off-by-one in paging.\r',
      '\u001b]0;claude\u0007> '
    );
    expect(paneAgentLine(capture)).toBe('Fixed the off-by-one in paging.');
  });
});

describe('paneAgentLine: Codex', () => {
  test('the last message, not the explored or ran cells, nor the working line', () => {
    const capture = screen(
      '› explain this codebase',
      '',
      '• I’ll look at the repository layout first.',
      '',
      '• Explored',
      '  └ List ls -la',
      '    Read README.md',
      '',
      '• Ran git log --oneline -5',
      '  └ 5e6ce7c0 Codex inbox',
      '',
      '• This is a React Native app with a Rust gateway; the app talks to it over',
      '  an encrypted transport.',
      '',
      '• Working (5s • esc to interrupt)',
      '',
      '› Find and fix a bug in @filename',
      '',
      '  ⏎ send   ⌃J newline   ⌃T transcript   ⌃C quit   25K tokens used   88% context left'
    );
    expect(paneAgentLine(capture)).toBe(
      'This is a React Native app with a Rust gateway; the app talks to it over an encrypted transport.'
    );
  });

  test('an edit cell after the message is skipped', () => {
    const capture = screen(
      '▌ bump the version',
      '• Bumping the version in package.json.',
      '• Edited package.json (+1 -1)',
      '    3 -  "version": "1.2.0",',
      '    3 +  "version": "1.2.1",',
      '▌ ',
      '  100% context left · ? for shortcuts'
    );
    expect(paneAgentLine(capture)).toBe('Bumping the version in package.json.');
  });
});

describe('paneAgentLine: anything else', () => {
  test('an agent drawn without bullets gives its last readable line', () => {
    const capture = screen(
      '> summarise the log',
      'Reading app.log',
      'The crash comes from a null session after reconnect.',
      '==========',
      '> '
    );
    expect(paneAgentLine(capture)).toBe('The crash comes from a null session after reconnect.');
  });

  test('a screen of drawing, spinners and counters reads as nothing', () => {
    expect(paneAgentLine('')).toBeUndefined();
    expect(
      paneAgentLine(screen('⠋ Thinking…', '│ 12.4k tokens │', '░░░▒▒▓▓', '42%'))
    ).toBeUndefined();
  });

  test('a long message is cut at a bound', () => {
    const line = paneAgentLine(`⏺ ${'word '.repeat(200)}`);
    expect(line?.length).toBeLessThanOrEqual(280);
    expect(line?.endsWith('…')).toBe(true);
  });
});
