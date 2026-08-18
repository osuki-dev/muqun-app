import {
  TerminalEmulator,
  parseTerminalSnapshot,
  terminalFrameLinks,
  terminalFrameText,
} from '../src/terminal/terminal-core';
import { resolveThemePack } from '../src/constants/theme-packs';
import { createTerminalTheme, DEFAULT_TERMINAL_THEME } from '../src/terminal/palette';
import {
  hasEarlierTerminalOutput,
  mergeTerminalWindow,
  terminalOutputLineCount,
} from '../src/terminal/history';
import { displayWidth, graphemeWidth } from '../src/terminal/unicode';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, label: string): void {
  assert(Object.is(actual, expected), `${label}: expected ${String(expected)}, received ${String(actual)}`);
}

equal(displayWidth('hello'), 5, 'ASCII width');
equal(displayWidth('你好'), 4, 'CJK width');
equal(graphemeWidth('👨‍💻'), 2, 'emoji grapheme width');
equal(graphemeWidth('é'), 1, 'combining grapheme width');

const colored = parseTerminalSnapshot('\u001b[1;38;2;12;34;56;48;5;196mhello\u001b[0m');
equal(terminalFrameText(colored), 'hello', 'SGR text');
equal(colored.lines[0].runs[0].style.bold, true, 'SGR bold');
equal(colored.lines[0].runs[0].style.foreground, 'rgb(12, 34, 56)', 'SGR true color');
equal(colored.lines[0].runs[0].style.background, 'rgb(255, 0, 0)', 'SGR indexed color');

const themedAnsi = parseTerminalSnapshot('\u001b[31merror', {
  ...DEFAULT_TERMINAL_THEME,
  ansi: DEFAULT_TERMINAL_THEME.ansi.map((color, index) =>
    index === 1 ? '#AABBCC' : color
  ),
});
equal(themedAnsi.lines[0].runs[0].style.foreground, '#AABBCC', 'theme ANSI red');

// The terminal palette is the pack's own published ANSI row now, not a mix of
// app tokens, so these read it off the default pack rather than synthesising a
// colour set to feed in.
const osukiPack = resolveThemePack('osuki');
const lightTerminalTheme = createTerminalTheme(osukiPack, 'light');
const darkTerminalTheme = createTerminalTheme(osukiPack, 'dark');
equal(lightTerminalTheme.ansi[0], osukiPack.light.colors.text, 'light ANSI black');
equal(darkTerminalTheme.ansi[0], '#0C121A', 'dark ANSI black');
equal(darkTerminalTheme.ansi[15], osukiPack.dark.colors.text, 'dark ANSI bright white');
assert(
  darkTerminalTheme.ansi[0] !== darkTerminalTheme.foreground,
  'dark ANSI black must not resolve to the default foreground'
);

equal(
  mergeTerminalWindow('1\n2\n3\n4', '3\n4\n5\n6', 8),
  '1\n2\n3\n4\n5\n6',
  'terminal history overlapping tail merge'
);
equal(
  mergeTerminalWindow('1\n2\n3\n4', 'next\nprompt', 4),
  '1\n2\nnext\nprompt',
  'terminal history changed screen fallback'
);
equal(
  mergeTerminalWindow('1\n2\n3\n4', '3\n4\n5\n6', 5),
  '2\n3\n4\n5\n6',
  'terminal history bounded window'
);
equal(terminalOutputLineCount('1\n2\n'), 2, 'terminal history ignores final newline');
equal(
  hasEarlierTerminalOutput(
    Array.from({ length: 239 }, (_, index) => String(index)).join('\n'),
    240,
    2_000,
    { max_offset_from_bottom: 908, viewport_rows: 65 }
  ),
  true,
  'terminal history uses scroll metrics for wrapped output'
);
equal(
  hasEarlierTerminalOutput(
    Array.from({ length: 394 }, (_, index) => String(index)).join('\n'),
    480,
    2_000,
    { max_offset_from_bottom: 331, viewport_rows: 63 }
  ),
  false,
  'terminal history stops at known scrollback end'
);
equal(
  hasEarlierTerminalOutput(
    Array.from({ length: 239 }, (_, index) => String(index)).join('\n'),
    240,
    2_000,
    undefined
  ),
  true,
  'terminal history tolerates legacy near-limit responses'
);
equal(
  hasEarlierTerminalOutput('output', 2_000, 2_000, {
    max_offset_from_bottom: 4_000,
    viewport_rows: 65,
  }),
  false,
  'terminal history respects client maximum'
);

const colonColor = parseTerminalSnapshot('\u001b[38:2::21:42:63mcolor');
equal(colonColor.lines[0].runs[0].style.foreground, 'rgb(21, 42, 63)', 'SGR colon color');

const cursor = new TerminalEmulator({ columns: 8, rows: 3, convertEol: true });
cursor.write('hello\u001b[2DXY');
equal(terminalFrameText(cursor.frame()), 'helXY', 'cursor overwrite');

const erase = new TerminalEmulator({ columns: 8, rows: 3, convertEol: true });
erase.write('abcdef\u001b[3D\u001b[K');
equal(terminalFrameText(erase.frame()), 'abc', 'erase to end of line');

const wrapping = new TerminalEmulator({ columns: 4, rows: 3, convertEol: true });
wrapping.write('12345');
equal(terminalFrameText(wrapping.frame()), '1234\n5', 'automatic line wrapping');

const alternate = new TerminalEmulator({ columns: 10, rows: 3, convertEol: true });
alternate.write('main\u001b[?1049hother');
equal(terminalFrameText(alternate.frame()), 'other', 'alternate buffer enter');
alternate.write('\u001b[?1049l');
equal(terminalFrameText(alternate.frame()), 'main', 'alternate buffer restore');

const unicode = parseTerminalSnapshot('A你B\né emoji 👨‍💻');
equal(terminalFrameText(unicode), 'A你B\né emoji 👨‍💻', 'Unicode output');

const controlStrings = parseTerminalSnapshot(
  '\u001b]2;Muqun terminal\u001b\\visible\u001b(B\u001bPignored payload\u001b\\'
);
equal(terminalFrameText(controlStrings), 'visible', 'OSC, DCS, and charset escapes');
equal(controlStrings.title, 'Muqun terminal', 'OSC title');

const links = parseTerminalSnapshot(
  'Docs: https://docs.expo.dev/versions/v57.0.0/.\n' +
    '\u001b]8;;https://github.com/BANG88/herdr-gateway\u0007Gateway repo\u001b]8;;\u0007\n' +
    'Health: http://10.0.2.2:7348/health'
);
const detectedLinks = terminalFrameLinks(links);
equal(detectedLinks.length, 3, 'HTTP, HTTPS, and OSC 8 link count');
equal(detectedLinks[0].uri, 'https://docs.expo.dev/versions/v57.0.0/', 'plain URL');
equal(detectedLinks[1].uri, 'https://github.com/BANG88/herdr-gateway', 'OSC 8 URL');
equal(detectedLinks[1].startColumn, 0, 'OSC 8 start column');
equal(detectedLinks[1].endColumn, 12, 'OSC 8 end column');
equal(detectedLinks[2].uri, 'http://10.0.2.2:7348/health', 'plain HTTP URL');

console.log('terminal core: all checks passed');

// Agent TUIs frame their input box with chrome sized to the desktop pane. On a
// phone that wraps into rows of stray horizontal lines.
{
  const { isFullWidthRule, titledRuleText, stripAgentChrome } = await import('../src/lib/agent-chrome');

  // Pane-width frames are chrome.
  for (const rule of ['─'.repeat(240), '━'.repeat(98), '╭' + '─'.repeat(96) + '╮', '│' + ' '.repeat(96) + '│']) {
    if (!isFullWidthRule(rule)) throw new Error(`Expected chrome: ${rule.slice(0, 12)}…`);
  }

  // A table around real data is content, whatever it is drawn with.
  for (const keep of [
    '┌──────────┬────────┬──────────┬──────────┐',
    '├──────────┼────────┼──────────┼──────────┤',
    '---',
    '─────',
    'text ────────────────────',
  ]) {
    if (isFullWidthRule(keep)) throw new Error(`Should have been kept: ${keep}`);
  }

  // A padded heading keeps its title and loses the padding.
  const titled = '─ Worked for 6m 26s ' + '─'.repeat(220);
  if (titledRuleText(titled) !== 'Worked for 6m 26s') throw new Error('Titled rule not unpacked.');
  if (titledRuleText('─ short ───') !== null) throw new Error('Narrow rule should not be unpacked.');

  const framed = ['prose', '', '─'.repeat(240), '❯ input', '─'.repeat(240)].join('\n');
  const stripped = stripAgentChrome(framed).split('\n');
  if (stripped.some((line) => isFullWidthRule(line))) throw new Error('Chrome survived stripping.');
  if (!stripped.includes('❯ input')) throw new Error('Stripping ate the prompt line.');
  if (!stripped.includes('prose')) throw new Error('Stripping ate the prose.');

  // Panes that are not agents (nvim, npm, shells) must pass through untouched.
  const nvim = ['  1 const a = 1;', '  2 │ nested', '~', '~'].join('\n');
  if (stripAgentChrome(nvim) !== nvim) throw new Error('A non-agent pane was modified.');
}

console.log('agent chrome: all checks passed');
