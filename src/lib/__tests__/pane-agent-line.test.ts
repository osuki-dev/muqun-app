import { describe, expect, test } from 'bun:test';

import { paneAgentActivity, paneAgentLine, paneAgentRead } from '@/lib/pane-agent-line';

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

describe('paneAgentRead: which message the reply answers, and whether the agent is at work', () => {
  test('the prompt above the reply and a working spinner below it', () => {
    const capture = screen(
      '> first question',
      '⏺ First answer.',
      '> second question',
      '⏺ Looking into it now.',
      '✻ Cogitating… (4s · esc to interrupt)',
      '╭────────╮',
      '│ >      │',
      '╰────────╯'
    );
    expect(paneAgentRead(capture)).toEqual({
      line: 'Looking into it now.',
      prompt: 'second question',
      busy: true,
    });
  });

  test('just sent: the new message shows with nothing under it yet', () => {
    const capture = screen('> first question', '⏺ First answer.', '> second question', '│ >   │');
    const read = paneAgentRead(capture);
    expect(read.prompt).toBe('second question');
    expect(read.line).toBeUndefined();
    expect(read.busy).toBe(false);
  });

  test('a TUI notice is never read as the answer', () => {
    const screen = [
      '⏺ The review is done: two nits, no blockers.',
      '',
      '  Update available! Run: mise upgrade claude',
      '────────────────────────────────────────',
      '> ',
      '────────────────────────────────────────',
      '  ? for shortcuts',
    ].join('\n');
    expect(paneAgentLine(screen)).toBe('The review is done: two nits, no blockers.');
    expect(
      paneAgentLine(['> hi', '', 'Update available! Run: mise upgrade claude', '> '].join('\n'))
    ).toBeUndefined();
  });
});

describe('paneAgentActivity', () => {
  const claudeComposer = [
    '',
    '╭──────────────────────────────────────────────────────────────╮',
    '│ >                                                            │',
    '╰──────────────────────────────────────────────────────────────╯',
    '  ⏵⏵ accept edits on (shift+tab to cycle)   Update available! Run: claude update',
  ];

  test('Claude Code: a running tool call is what it is doing, under its spinner too', () => {
    const capture = screen(
      '> run the tests and fix what fails',
      '',
      '⏺ I will run the suite first.',
      '',
      '⏺ Bash(bun test src)',
      '  ⎿  Running…',
      '',
      '✻ Cogitating… (12s · ↑ 1.2k tokens · esc to interrupt)',
      ...claudeComposer
    );
    expect(paneAgentActivity(capture)).toBe('Bash: bun test src');
  });

  test('Claude Code: after a finished call, the spinner under it is newest', () => {
    const capture = screen(
      '> add tests for the parser',
      '',
      '⏺ Read(src/lib/parser.ts)',
      '  ⎿  Read 120 lines (ctrl+o to expand)',
      '',
      '✶ Pondering… (3m 4s · ↓ 2.1k tokens · esc to interrupt)',
      ...claudeComposer
    );
    expect(paneAgentActivity(capture)).toBe('Pondering… 3m 4s');
  });

  test('Claude Code: a finished call with no spinner is the newest thing', () => {
    const capture = screen(
      '> look at the parser',
      '',
      '⏺ Reading the parser first.',
      '',
      '⏺ Read(src/lib/parser.ts)',
      '  ⎿  Read 120 lines (ctrl+o to expand)',
      ...claudeComposer
    );
    expect(paneAgentActivity(capture)).toBe('Read: src/lib/parser.ts');
  });

  test('Claude Code: its latest words when they come after the call', () => {
    const capture = screen(
      '> look at the parser',
      '',
      '⏺ Read(src/lib/parser.ts)',
      '  ⎿  Read 120 lines (ctrl+o to expand)',
      '',
      '⏺ The parser drops the last token when the input ends without a',
      '  newline; fixing that now.',
      ...claudeComposer
    );
    expect(paneAgentActivity(capture)).toBe(
      'The parser drops the last token when the input ends without a newline; fixing that now.'
    );
  });

  test('Codex: the status line under finished work, with its elapsed time', () => {
    const capture = screen(
      '› fix the failing test',
      '',
      '• I will look at the failing test first.',
      '',
      '• Explored',
      '  └ Read a.test.ts',
      '    Search failing in src',
      '',
      '• Ran bun test src/lib',
      '  └ 12 pass',
      '    1 fail',
      '',
      '◦ Working (32s • esc to interrupt)',
      '',
      '› Implement {feature}',
      '',
      '  100% context left · ? for shortcuts'
    );
    expect(paneAgentActivity(capture)).toBe('Working 32s');
  });

  test('Codex: an edit with nothing after it, and a one-word group with its detail', () => {
    const edited = screen(
      '› fix the failing test',
      '',
      '• Edited src/lib/a.ts (+3 -1)',
      '    12 -  const a = 1;',
      '    12 +  const a = 2;',
      '',
      '› Implement {feature}'
    );
    expect(paneAgentActivity(edited)).toBe('Edited src/lib/a.ts (+3 -1)');
    const exploring = screen('› fix it', '', '• Exploring', '› Implement {feature}');
    expect(paneAgentActivity(exploring)).toBe('Exploring');
  });

  test('indented tool output that looks like a spinner is not the status line', () => {
    const capture = screen(
      '> build it',
      '',
      '⏺ Bash(cargo build)',
      '  ⎿  Compiling muqun v0.1.0',
      '     Building…',
      ...claudeComposer
    );
    expect(paneAgentActivity(capture)).toBe('Bash: cargo build');
  });

  test('nothing in the turn yet, or only notices: nothing', () => {
    expect(
      paneAgentActivity(screen('> hi', '', 'Update available! Run: claude update', '> '))
    ).toBe(undefined);
    expect(paneAgentActivity(screen('⏺ Old answer.', '> new question', '> '))).toBeUndefined();
  });
});
