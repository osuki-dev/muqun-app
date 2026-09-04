import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Asset } from 'expo-asset';

import { AGENT_SPAWN_CAPABILITY } from '@/lib/agent-spawn';
import { normalizeGatewayEntities, type GatewayEntity } from '@/lib/gateway-entities';
import type { SessionAsset } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { DEMO_PAIRING_SERVER_ID } from '@/lib/pairing';
import {
  buildDemoTerminalRows,
  demoTerminalRange,
  demoTerminalScroll,
  demoTerminalTail,
} from '@/lib/demo-terminal-history';

/**
 * A self-contained demo: the whole app driven by data baked into the bundle,
 * with no network and no gateway.
 *
 * It exists for two audiences. App-store reviewers cannot pair to a machine
 * they do not own, so without this the app looks broken to them. And someone
 * deciding whether to install herdr can see exactly what the app does first.
 *
 * The data here is invented -- a fictional "add dark mode" task -- so nothing
 * real is ever shown. This is a distinct code path from the real transport, so
 * demo data can never leak into a live connection and vice versa.
 *
 * **Why this file translates and the live path does not.** Against a real
 * gateway every label, tab name, key description and command blurb below
 * arrives over the wire already in the user's language -- the request carries
 * the active locale and the gateway answers in it, so the app has nothing to
 * translate and must not second-guess what it was sent. Demo mode has no wire
 * and no gateway, so this file *is* the gateway, and its prose is the only copy
 * in the app that would otherwise be hard-coded English. That is not a small
 * corner: this is what an App Store or Play reviewer sees, and it is where the
 * store screenshots come from, so a Traditional Chinese phone showing an English demo is a
 * screenshot in the wrong language on every localized store listing.
 *
 * **Why every one of these is `i18n._(msg`...`)` inside a function.** These are
 * generators called at request time, not React components, so there is no
 * provider to subscribe to and no hook to call -- the global instance plus an
 * inert `msg` descriptor is the same shape the widget layouts and the
 * notification channels use (`src/lib/agent-widget-layout.tsx`,
 * `src/i18n/labels.ts`). The placement matters more than the shape: an
 * `i18n._()` evaluated at module scope resolves once, at import time, in
 * whatever locale happened to be active then -- which is usually none at all --
 * and never changes again when the user switches language. So the fixtures that
 * carry prose are built inside the function that answers the request rather
 * than hoisted into a `const`, and the ones that carry no prose are left as
 * module-scope constants.
 */
/**
 * Re-exported rather than declared, so the demo's identity has one home.
 *
 * It moved to `pairing.ts` when the scanner learned to recognise it: those
 * rules are pure and unit-tested, and this module reaches for `expo-asset`,
 * which a pure module must not have to import to know one string.
 */
export const DEMO_SERVER_ID = DEMO_PAIRING_SERVER_ID;

export const demoRecord: GatewayRecord = {
  serverId: DEMO_SERVER_ID,
  // A getter, not a string: this record is a module-scope constant that outlives
  // any one locale, and the screens that show it (`enterDemo`, the server header,
  // `demoHealth`) read it long after this module was imported. Resolving on read
  // is what makes a language switch reach the demo's own name.
  get label(): string {
    return i18n._(msg`Demo workspace`);
  },
  // Not a reachable address on purpose: nothing in demo mode makes a request.
  url: 'https://demo.invalid',
  token: 'demo',
  pairedAt: 0,
};

let active = false;

export function setDemoActive(value: boolean): void {
  active = value;
}

export function isDemoActive(): boolean {
  return active;
}

export function isDemoRecord(record: GatewayRecord | null): boolean {
  return record?.serverId === DEMO_SERVER_ID;
}

const SESSION_ID = 'demo';

type RawEntity = Record<string, unknown>;

/**
 * No `pane_count` and no `status`, deliberately (card #830).
 *
 * Both used to be set here, and setting them is what hid a bug for as long as
 * this fixture has existed: the panels sheet read the workspace's count and
 * status straight off this record, offline it got `5` and `working` and looked
 * right, and against a real tmux session it got neither -- `tmux list-sessions`
 * has no per-session pane count to report -- so every chip in the rail said `0`
 * beside a grey dot. A fixture that answers a question the wire does not answer
 * is not a demo, it is a test that can only pass.
 *
 * The sheet counts the panes below instead, so the rail still reads `5 panels`
 * against a working dot here -- but it reads it the way it reads it on a real
 * gateway, which is the only way this fixture is worth running.
 */
const workspacesRaw: RawEntity[] = [
  { id: 'ws-1', workspace_id: 'ws-1', label: 'muqun', cwd: '~/code/muqun', focused: true },
];

/**
 * Three tabs rather than one, so the two-finger tab swipe has somewhere to go
 * offline -- and three rather than two, because with two the ring is a toggle
 * and wrapping past the end cannot be told apart from stepping back.
 *
 * A function rather than a constant because the three names are prose a person
 * reads off the tab bar: hoisting them would freeze the language they were
 * imported in.
 */
function tabsRaw(): RawEntity[] {
  return [
    {
      id: 'tab-1',
      tab_id: 'tab-1',
      workspace_id: 'ws-1',
      label: i18n._(msg`Development`),
      focused: true,
    },
    { id: 'tab-2', tab_id: 'tab-2', workspace_id: 'ws-1', label: i18n._(msg`Review`) },
    { id: 'tab-3', tab_id: 'tab-3', workspace_id: 'ws-1', label: i18n._(msg`Logs`) },
  ];
}

const panesRaw: RawEntity[] = [
  {
    id: 'pane-1',
    pane_id: 'pane-1',
    tab_id: 'tab-1',
    workspace_id: 'ws-1',
    label: 'Claude Code',
    agent: 'claude',
    agent_status: 'working',
    cwd: '~/code/muqun',
    focused: true,
    revision: 1,
    scroll: demoTerminalScroll(),
  },
  {
    id: 'pane-2',
    pane_id: 'pane-2',
    tab_id: 'tab-1',
    workspace_id: 'ws-1',
    label: 'nvim',
    terminal_title_stripped: 'nvim src/theme.ts',
    cwd: '~/code/muqun/src',
    revision: 1,
  },
  {
    id: 'pane-3',
    pane_id: 'pane-3',
    tab_id: 'tab-1',
    workspace_id: 'ws-1',
    label: 'zsh',
    terminal_title_stripped: 'you@mac:~/code/muqun',
    cwd: '~/code/muqun',
    revision: 1,
  },
  {
    id: 'pane-4',
    pane_id: 'pane-4',
    tab_id: 'tab-2',
    workspace_id: 'ws-1',
    label: 'git',
    terminal_title_stripped: 'git diff --stat',
    cwd: '~/code/muqun',
    focused: true,
    revision: 1,
  },
  {
    id: 'pane-5',
    pane_id: 'pane-5',
    tab_id: 'tab-3',
    workspace_id: 'ws-1',
    label: 'tail',
    terminal_title_stripped: 'tail -f gateway.log',
    cwd: '~/code/muqun-gateway',
    focused: true,
    revision: 1,
  },
];

const agentsRaw: RawEntity[] = [
  {
    id: 'pane-1',
    pane_id: 'pane-1',
    target: 'pane-1',
    agent: 'claude',
    label: 'Claude Code',
    status: 'working',
  },
];

/** A fictional agent transcript that exercises tables, diffs, colour and chrome. */
const CLAUDE_OUTPUT = [
  '[2m⏺[0m [1mAdd a dark mode toggle to Settings[0m',
  '',
  '  I looked at how the theme is resolved and wired a toggle into the',
  '  settings store. Two files changed.',
  '',
  '[1mUpdate(src/theme.ts)[0m  [2mAdded 4 lines[0m',
  '[48;2;20;60;20m[38;2;120;220;120m  12 +  export type ColorMode = "system" | "light" | "dark";[0m',
  '[48;2;20;60;20m[38;2;120;220;120m  13 +  export function resolveMode(mode: ColorMode) {[0m',
  '[48;2;80;20;20m[38;2;235;130;130m  14 -    return "light";[0m',
  '[48;2;20;60;20m[38;2;120;220;120m  14 +    return mode === "system" ? systemMode() : mode;[0m',
  '     15    }',
  '',
  '[1mThe three modes:[0m',
  '┌────────────┬──────────────────────────────┐',
  '│ [36mmode[0m       │ result                       │',
  '├────────────┼──────────────────────────────┤',
  '│ [35msystem[0m     │ follows the device setting   │',
  '│ [35mlight[0m      │ always light                 │',
  '│ [35mdark[0m       │ always dark                  │',
  '└────────────┴──────────────────────────────┘',
  '',
  '[32m✓[0m Type check passed',
  '[32m✓[0m 24 tests passed',
  '',
  '[2m✻[0m Want me to add a matching toggle to the onboarding screen too?',
  '',
  '[2m▶▶ auto mode on (shift+tab to cycle)[0m',
];

const NVIM_OUTPUT = [
  '[38;2;130;170;255m  1[0m [38;2;200;120;255mexport[0m [38;2;120;220;180mtype[0m ColorMode = [38;2;220;180;120m"system"[0m | [38;2;220;180;120m"light"[0m | [38;2;220;180;120m"dark"[0m;',
  '[38;2;130;170;255m  2[0m',
  '[38;2;130;170;255m  3[0m [38;2;200;120;255mexport[0m [38;2;200;120;255mfunction[0m [38;2;120;220;255mresolveMode[0m(mode: ColorMode) {',
  '[38;2;130;170;255m  4[0m   [38;2;200;120;255mreturn[0m mode === [38;2;220;180;120m"system"[0m ? systemMode() : mode;',
  '[38;2;130;170;255m  5[0m }',
  '[38;2;90;90;90m~[0m',
  '[38;2;90;90;90m~[0m',
  '[48;2;30;32;48m[38;2;200;211;245m src/theme.ts                                    1,1    Top [0m',
];

const ZSH_OUTPUT = [
  '[38;2;120;220;180myou@mac[0m [38;2;130;170;255m~/code/muqun[0m $ git status --short',
  ' [38;2;120;220;120mM[0m src/theme.ts',
  ' [38;2;120;220;120mM[0m src/app/settings.tsx',
  '[38;2;120;220;180myou@mac[0m [38;2;130;170;255m~/code/muqun[0m $ ',
];

/** The Review tab: a diff, so a tab switch is unmistakable at a glance. */
const GIT_OUTPUT = [
  '[38;2;120;220;180myou@mac[0m [38;2;130;170;255m~/code/muqun[0m $ git diff --stat',
  ' src/lib/tab-swipe.ts            [38;2;120;220;120m| 118 ++++++++++++++[0m',
  ' src/hooks/use-tab-swipe.ts      [38;2;120;220;120m|  96 +++++++++++[0m',
  ' src/components/skia-terminal.ts [38;2;120;220;120m|   4 ++[0m[38;2;220;120;120m--[0m',
  ' 3 files changed, [38;2;120;220;120m214 insertions(+)[0m, [38;2;220;120;120m2 deletions(-)[0m',
  '[38;2;120;220;180myou@mac[0m [38;2;130;170;255m~/code/muqun[0m $ ',
];

/** The Logs tab: a tail, in a different cwd again. */
const TAIL_OUTPUT = [
  '[2m12:04:18[0m [38;2;120;220;180mINFO [0m muqun_gateway::sse client connected id=ios-7f2a',
  '[2m12:04:18[0m [38;2;120;220;180mINFO [0m muqun_gateway::panes subscribe session=default',
  '[2m12:04:21[0m [38;2;130;170;255mDEBUG[0m muqun_gateway::panes revision bump pane=pane-1 rev=482',
  '[2m12:04:23[0m [38;2;220;180;120mWARN [0m muqun_gateway::poll compensation tick ran long (168ms)',
  '[2m12:04:24[0m [38;2;130;170;255mDEBUG[0m muqun_gateway::panes revision bump pane=pane-1 rev=483',
  '[2m12:04:26[0m [38;2;120;220;180mINFO [0m muqun_gateway::uploads accepted 1 file (412 KB)',
];

let tick = 0;

function demoPaneRows(paneId: string, advance: boolean): string[] {
  if (advance) tick += 1;
  if (paneId === 'pane-2') return NVIM_OUTPUT;
  if (paneId === 'pane-3') return ZSH_OUTPUT;
  if (paneId === 'pane-4') return GIT_OUTPUT;
  if (paneId === 'pane-5') return TAIL_OUTPUT;
  const spinner = ['·', '✢', '✳', '∗'][tick % 4];
  return buildDemoTerminalRows([...CLAUDE_OUTPUT, `\u001b[2m${spinner} Working…\u001b[0m`]);
}

/** A little life on each read, so demo mode does not look frozen. */
export function demoPaneOutput(paneId: string, lines: number): string {
  return demoTerminalTail(demoPaneRows(paneId, true), lines);
}

/** A stable, disjoint page: historical reads do not advance the live spinner. */
export function demoPaneRange(
  paneId: string,
  start: number,
  end: number
): ReturnType<typeof demoTerminalRange> {
  return demoTerminalRange(demoPaneRows(paneId, false), start, end);
}

/**
 * The key row the demo's panes advertise.
 *
 * These `description`s become the caps' `accessibilityLabel` by way of
 * `terminalKeysFromGateway`, so they are read aloud and they have to be in the
 * user's language -- but they are deliberately *not* macro calls. They are
 * lookup keys into `terminalKeyDescription` in `src/i18n/labels.ts`, which is
 * keyed by the English text and already translated into all eight catalogs;
 * that is the same table, and the same plain-string convention, that the
 * offline fallback rows in `src/lib/terminal-keys.ts` use. So the wording here
 * is chosen to match an existing entry exactly ("Interrupt" became "Control C",
 * "Left" became "Left arrow") and the demo gets translated captions for free,
 * with no message ids of its own. Anything reworded away from a key in that
 * table silently falls back to English.
 *
 * The `label` caps stay as they are: a glyph is not language.
 */
const BASE_KEYS = [
  { label: '↵', key: 'enter', description: 'Enter' },
  { label: '⇧↵', key: 'shift+enter', description: 'Shift Enter, newline without sending' },
  { label: 'ESC', key: 'esc', description: 'Escape' },
];
const TAIL_KEYS = [
  { label: 'TAB', key: 'tab', description: 'Tab' },
  { label: '⌃C', key: 'ctrl+c', description: 'Control C' },
  { label: '⌫', key: 'backspace', description: 'Backspace' },
];
const NAV_KEYS = [
  { label: '←', key: 'left', description: 'Left arrow' },
  { label: '↓', key: 'down', description: 'Down arrow' },
  { label: '↑', key: 'up', description: 'Up arrow' },
  { label: '→', key: 'right', description: 'Right arrow' },
];

const CLAUDE_KEYS = [
  { label: '⇧TAB', key: 'shift+tab', description: 'Shift Tab, cycle mode' },
  { label: '⌃O', key: 'ctrl+o', description: 'Control O, expand' },
  { label: '⌃T', key: 'ctrl+t', description: 'Control T, toggle tasks' },
  { label: '⌃R', key: 'ctrl+r', description: 'Control R, transcript' },
];
const EDITOR_KEYS = [
  { label: '⌃W', key: 'ctrl+w', description: 'Control W, window prefix' },
  { label: '⌃D', key: 'ctrl+d', description: 'Control D, half page down' },
  { label: '⌃U', key: 'ctrl+u', description: 'Control U, half page up' },
];

/**
 * The demo pane's composer catalog: a short version of what the gateway reads
 * off a real Claude install, carrying one workspace-sourced entry so the source
 * tag can be seen offline, and both kinds of `args_hint` -- present and absent
 * -- so the hint's placeholder styling has something to draw.
 *
 * Six entries rather than the thirty-odd a real agent has. What the demo has to
 * show is that the panel opens, filters and inserts; a short list makes a flow's
 * assertions unambiguous and keeps the whole catalog one scroll away.
 *
 * Built per call rather than held in a `const` because the descriptions and the
 * argument hints are the sentences the panel actually shows. The `name`s are
 * not: `/clear` is what gets typed into the pane, so it is wire vocabulary and
 * stays English, as do `table`, `captured_from` and `source`.
 */
function claudeComposer() {
  return {
    version: 1,
    table: 'claude',
    captured_from: 'demo',
    file_mentions: true,
    slash_commands: [
      {
        name: '/clear',
        description: i18n._(msg`Start a new session with empty context`),
        args_hint: null,
        source: 'builtin',
      },
      {
        name: '/compact',
        description: i18n._(msg`Free up context by summarizing the conversation so far`),
        // A placeholder standing in for what the user would type, brackets and
        // all -- prose, not syntax, so it is translated like the sentence above.
        args_hint: i18n._(msg`[instructions]`),
        source: 'builtin',
      },
      {
        name: '/context',
        description: i18n._(msg`Visualize current context usage as a colored grid`),
        args_hint: null,
        source: 'builtin',
      },
      {
        name: '/model',
        description: i18n._(msg`Set the AI model for Claude Code`),
        args_hint: i18n._(msg`[model]`),
        source: 'builtin',
      },
      {
        name: '/review',
        description: i18n._(msg`Review a GitHub pull request`),
        args_hint: i18n._(msg`[pr number]`),
        source: 'builtin',
      },
      {
        name: '/release-notes',
        description: i18n._(msg`Draft the notes for the next build`),
        args_hint: null,
        source: 'workspace',
      },
    ],
  };
}

/**
 * The same catalog under the shortcuts endpoint's older field names.
 *
 * Derived rather than written twice on purpose: a real gateway serves one table
 * through both surfaces, and a demo whose two answers disagreed would show the
 * list flickering from one to the other as the parts probe lands -- a bug the
 * app cannot have and the demo should not invent.
 */
function claudeCommands() {
  return claudeComposer().slash_commands.map((entry) => ({
    command: entry.name,
    description: entry.description,
    ...(entry.args_hint ? { argument_hint: entry.args_hint } : {}),
    source: entry.source,
  }));
}
/** The `command` strings are what nvim is sent; only the blurbs are read. */
function editorCommands() {
  return [
    { command: ':w', description: i18n._(msg`Write the file`), source: 'builtin' },
    { command: ':q', description: i18n._(msg`Quit`), source: 'builtin' },
    { command: ':wq', description: i18n._(msg`Write and quit`), source: 'builtin' },
  ];
}

export function demoShortcuts(paneId: string) {
  if (paneId === 'pane-1') {
    return {
      version: 3,
      profile: 'claude',
      configured: false,
      keys: [...BASE_KEYS, ...CLAUDE_KEYS, ...TAIL_KEYS, ...NAV_KEYS],
      commands: claudeCommands(),
    };
  }
  if (paneId === 'pane-2') {
    return {
      version: 3,
      profile: 'editor',
      configured: false,
      keys: [...BASE_KEYS, ...EDITOR_KEYS, ...TAIL_KEYS, ...NAV_KEYS],
      commands: editorCommands(),
    };
  }
  return {
    version: 3,
    profile: 'shell',
    configured: false,
    keys: [...BASE_KEYS, ...TAIL_KEYS, ...NAV_KEYS],
    commands: [],
  };
}

/**
 * How long the demo pretends you were away, so "while you were away" can be
 * seen with no gateway and no waiting.
 *
 * Forty-seven minutes: comfortably past the fifteen-minute threshold, an
 * awkward enough number to read as a real absence rather than a round fixture,
 * and short enough that the card still says it in minutes.
 */
const DEMO_AWAY_MS = 47 * 60 * 1000;

/**
 * Handed out once per launch and never again.
 *
 * The digest is built from a real stored "last viewed" mark, and in the demo
 * that mark is always a few seconds old -- so without this the surface would be
 * unreachable offline, which is precisely what the demo exists to prevent. But
 * synthesizing the window on every visit would raise the same card every time
 * the server screen mounted, which is nagging rather than demonstrating. Once
 * per launch is the honest middle: a reviewer sees it, and a reviewer who then
 * taps around the demo for ten minutes is left alone.
 */
let demoAwayOffered = false;
/** The window handed out this launch, so the events can be laid out inside it. */
let demoAwayStartMs: number | null = null;

export function demoAwayWindowStart(nowMs: number = Date.now()): number | null {
  if (demoAwayOffered) return null;
  demoAwayOffered = true;
  demoAwayStartMs = nowMs - DEMO_AWAY_MS;
  return demoAwayStartMs;
}

/**
 * The status transitions the demo's agents made during that window: Claude
 * stopped to ask twice and then finished, the editor pane settled, and a third
 * agent is still going. Enough shape that the digest shows a finished row, a
 * "stopped to ask" count and a still-running row without being a wall.
 *
 * Returned in the ring's own wire shape -- `seq` and `unix_ms`, not `at` -- so
 * demo mode runs exactly the parser a real answer runs. Spaced forward from the
 * window this launch handed out, so the relative times on the card read like a
 * real afternoon rather than like a fixture.
 *
 * Takes no `since`: neither does the request. The ring answers with everything
 * it holds and the window is applied by `summariseAwayEvents`, so a demo that
 * filtered here would be testing a code path the real one does not have.
 */
export function demoAgentEvents(): Record<string, unknown> {
  const start = demoAwayStartMs ?? Date.now() - DEMO_AWAY_MS;
  const at = (minutesAfter: number) => start + minutesAfter * 60_000;
  const events = [
    { pane_id: 'pane-1', agent: 'claude', from: 'idle', to: 'working', unix_ms: at(2) },
    { pane_id: 'pane-3', agent: 'codex', from: 'idle', to: 'working', unix_ms: at(4) },
    { pane_id: 'pane-1', agent: 'claude', from: 'working', to: 'blocked', unix_ms: at(9) },
    { pane_id: 'pane-1', agent: 'claude', from: 'blocked', to: 'working', unix_ms: at(11) },
    { pane_id: 'pane-2', agent: 'nvim', from: 'idle', to: 'working', unix_ms: at(14) },
    { pane_id: 'pane-1', agent: 'claude', from: 'working', to: 'blocked', unix_ms: at(23) },
    { pane_id: 'pane-1', agent: 'claude', from: 'blocked', to: 'working', unix_ms: at(26) },
    { pane_id: 'pane-2', agent: 'nvim', from: 'working', to: 'idle', unix_ms: at(31) },
    { pane_id: 'pane-1', agent: 'claude', from: 'working', to: 'done', unix_ms: at(38) },
  ];
  return {
    session_id: SESSION_ID,
    events: events.map((event, index) => ({ seq: index + 1, ...event })),
    next_since: events.length,
    missed: false,
    capacity: 200,
  };
}

/**
 * Artifacts for the same fictional "add dark mode" task. One of each kind the
 * viewer knows, so the Artifacts list and every viewer branch can be seen
 * without a gateway -- including the "no preview" one.
 */
const DEMO_ASSET_TEXT: Record<string, string> = {
  'as-demo-report': [
    '# Dark mode — change summary',
    '',
    'Wired a `ColorMode` union through the theme resolver and added a toggle to',
    'Settings. The system option follows the device. Contrast stays above',
    '$L = \\frac{Y_1 + 0.05}{Y_2 + 0.05} \\geq 4.5$ in both modes:',
    '',
    '$$\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}$$',
    '',
    '## Files touched',
    '',
    '| file | change |',
    '| --- | --- |',
    '| `src/theme.ts` | resolver takes a mode |',
    '| `src/app/settings.tsx` | new toggle row |',
    '',
    '## Checks',
    '',
    '- [x] Type check',
    '- [x] 24 tests',
    '- [ ] Screenshot review',
    '',
    '> Onboarding still hardcodes the light palette — worth a follow-up.',
  ].join('\n'),
  'as-demo-diff': [
    'diff --git a/src/theme.ts b/src/theme.ts',
    '@@ -9,6 +9,9 @@',
    '-  return "light";',
    '+  return mode === "system" ? systemMode() : mode;',
  ].join('\n'),
  'as-demo-coverage': [
    '{',
    '  "statements": 91.4,',
    '  "branches": 84.2,',
    '  "functions": 93.0,',
    '  "lines": 91.8',
    '}',
  ].join('\n'),
};

/** Minutes ago, so the list always reads as "just happened". */
const DEMO_ASSET_AGE_MINUTES: Record<string, number> = {
  'as-demo-report': 2,
  'as-demo-shot': 11,
  'as-demo-diff': 26,
  'as-demo-coverage': 74,
  'as-demo-spec': 1_500,
};

function demoAssetModifiedAt(id: string): number {
  return Date.now() - (DEMO_ASSET_AGE_MINUTES[id] ?? 0) * 60_000;
}

export function demoSessionAssets(): SessionAsset[] {
  const origin = { session_id: SESSION_ID, pane_id: 'pane-1', workspace_id: 'ws-1' };
  return [
    {
      id: 'as-demo-report',
      path: '~/code/muqun/notes/dark-mode.md',
      name: 'dark-mode.md',
      kind: 'markdown',
      mime: 'text/markdown',
      size: DEMO_ASSET_TEXT['as-demo-report'].length,
      modified_unix_ms: demoAssetModifiedAt('as-demo-report'),
      origin,
      previewable: true,
    },
    {
      id: 'as-demo-shot',
      path: '~/code/muqun/out/settings-dark.png',
      name: 'settings-dark.png',
      kind: 'image',
      mime: 'image/png',
      size: 184_320,
      modified_unix_ms: demoAssetModifiedAt('as-demo-shot'),
      origin,
      previewable: true,
    },
    {
      id: 'as-demo-diff',
      path: '~/code/muqun/out/theme.diff',
      name: 'theme.diff',
      kind: 'text',
      mime: 'text/x-diff',
      size: DEMO_ASSET_TEXT['as-demo-diff'].length,
      modified_unix_ms: demoAssetModifiedAt('as-demo-diff'),
      origin,
      previewable: true,
    },
    {
      id: 'as-demo-coverage',
      path: '~/code/muqun/out/coverage.json',
      name: 'coverage.json',
      kind: 'text',
      mime: 'application/json',
      size: DEMO_ASSET_TEXT['as-demo-coverage'].length,
      modified_unix_ms: demoAssetModifiedAt('as-demo-coverage'),
      origin,
      previewable: true,
    },
    {
      id: 'as-demo-spec',
      path: '~/code/muqun/docs/design-spec.pdf',
      name: 'design-spec.pdf',
      kind: 'pdf',
      mime: 'application/pdf',
      size: 2_411_008,
      modified_unix_ms: demoAssetModifiedAt('as-demo-spec'),
      origin,
      previewable: false,
    },
  ];
}

/**
 * The same fictional task as the transcript above, but as the gateway's
 * normalized content model rather than as terminal output.
 *
 * Every part type the app renders appears here, plus one -- `future-thing` --
 * that it deliberately does not know. That last entry is the demo's proof of
 * the model's central rule: a client meets an unfamiliar type by showing its
 * `fallback_text`, so a gateway that learns a new part type never blanks a
 * screen on a phone that has not been updated yet.
 *
 * Returned raw, in wire shape, so demo mode exercises the real envelope parser
 * instead of a hand-built object that could drift away from the contract.
 */
export function demoPaneParts(paneId: string): Record<string, unknown> {
  const capabilities = {
    parts: paneId === 'pane-1',
    assets: true,
    image_upload: true,
    composer: true,
  };
  if (paneId !== 'pane-1') {
    // No composer descriptor at all, the way the gateway answers for a pane it
    // has no command table for -- which is what makes `@` an ordinary character
    // in the editor pane, and gives the demo both sides of the capability gate.
    return {
      schema_version: '1.3.0',
      capabilities,
      data: { parts: [], pane: { pane_id: paneId } },
    };
  }
  return {
    schema_version: '1.3.0',
    capabilities,
    data: {
      pane: { pane_id: paneId, agent: 'claude', parts: 'dictionary', composer: claudeComposer() },
      parts: [
        {
          type: 'prompt',
          text: 'add a dark mode toggle to Settings',
          range: { start: 0, end: 0 },
          fallback_text: '› add a dark mode toggle to Settings',
        },
        {
          type: 'text',
          markdown: [
            'I looked at how the theme is resolved and wired a toggle into the settings',
            'store. Two files changed, and `resolveMode` now takes the mode instead of',
            'assuming `light`. Contrast stays above $L = \\frac{Y_1 + 0.05}{Y_2 + 0.05} \\geq 4.5$:',
            '',
            '$$\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}$$',
          ].join('\n'),
          range: { start: 2, end: 5 },
          fallback_text:
            'I looked at how the theme is resolved and wired a toggle into the settings store.',
        },
        {
          type: 'todo',
          items: [
            { text: 'Add a ColorMode union to the theme', done: true },
            { text: 'Resolve the system mode from the device', done: true },
            { text: 'Add the Settings toggle row', done: true },
            { text: 'Match the onboarding screen', done: false },
          ],
          range: { start: 7, end: 11 },
          fallback_text:
            '☒ Add a ColorMode union to the theme\n☒ Resolve the system mode from the device\n☒ Add the Settings toggle row\n☐ Match the onboarding screen',
        },
        {
          type: 'tool-block',
          tool: 'Read',
          input: 'src/theme.ts',
          result: ['   1  export type ColorMode = "system" | "light" | "dark";'],
          status: 'ok',
          truncated: false,
          range: { start: 13, end: 15 },
          fallback_text: '⏺ Read(src/theme.ts)\n  ⎿ read 42 lines',
        },
        {
          type: 'diff',
          file: 'src/theme.ts',
          hunks: [
            '@@ -9,6 +9,9 @@',
            ' export function resolveMode(mode: ColorMode) {',
            '-  return "light";',
            '+  return mode === "system" ? systemMode() : mode;',
            ' }',
          ],
          range: { start: 17, end: 22 },
          fallback_text:
            'Update(src/theme.ts)\n-  return "light";\n+  return mode === "system" ? systemMode() : mode;',
        },
        {
          type: 'table',
          rows: [
            ['mode', 'result'],
            ['system', 'follows the device setting'],
            ['light', 'always light'],
            ['dark', 'always dark'],
          ],
          range: { start: 24, end: 29 },
          fallback_text: 'mode | result\nsystem | follows the device setting',
        },
        {
          type: 'tool-block',
          tool: 'Bash',
          input: 'bun test src/theme',
          result: [
            'bun test v1.2.4',
            '',
            'src/theme.test.ts:',
            '✓ resolveMode returns the device mode for "system"',
            '✓ resolveMode returns the mode it was given',
            '',
            ' 24 pass',
            ' 0 fail',
          ],
          status: 'ok',
          truncated: true,
          range: { start: 31, end: 36 },
          fallback_text: '⏺ Bash(bun test src/theme)\n  ⎿ 24 pass, 0 fail',
        },
        {
          type: 'tool-block',
          tool: 'Bash',
          input: 'npx tsc --noEmit',
          result: [
            'src/app/onboarding.tsx(48,7): error TS2322: Type "light" is not assignable',
            '  to type ColorMode | undefined.',
          ],
          status: 'error',
          truncated: false,
          range: { start: 38, end: 41 },
          fallback_text: '⏺ Bash(npx tsc --noEmit)\n  ⎿ 1 error in src/app/onboarding.tsx',
        },
        {
          type: 'asset-ref',
          asset_id: 'as-demo-report',
          range: { start: 43, end: 43 },
          fallback_text: 'Wrote ~/code/muqun/notes/dark-mode.md',
        },
        {
          type: 'tool-block',
          tool: 'Edit',
          input: 'src/app/onboarding.tsx',
          result: [],
          status: 'running',
          truncated: false,
          range: { start: 45, end: 45 },
          fallback_text: '⏺ Edit(src/app/onboarding.tsx)',
        },
        {
          // No renderer for this type in this build, on purpose.
          type: 'future-thing',
          approval: { question: 'Apply the onboarding fix?', choices: ['yes', 'no'] },
          range: { start: 47, end: 48 },
          fallback_text: 'Apply the onboarding fix? (yes / no)',
        },
        {
          type: 'status',
          text: 'Working…',
          spinner: true,
          range: { start: 50, end: 50 },
          fallback_text: '✻ Working…',
        },
      ],
    },
  };
}

export function demoAssetText(assetId: string): string {
  return DEMO_ASSET_TEXT[assetId] ?? '';
}

/**
 * The demo image is a bundled asset, so opening it stays entirely offline --
 * demo mode never makes a request.
 */
export function demoAssetContentUri(assetId: string): string {
  if (assetId !== 'as-demo-shot') return '';
  return Asset.fromModule(require('../../assets/images/muqun-hero.png')).uri;
}

export const demoSessionId = SESSION_ID;

export function demoHealth() {
  return {
    ok: true,
    gatewayVersion: 'demo',
    apiVersion: '1.1.0',
    apiMajor: 1,
    // Exactly what the demo can actually do offline, and nothing else. It is
    // tempting to list every capability a current gateway declares, but a
    // capability here is a promise the fixtures have to keep: `pane_approvals`
    // would put a banner on screen that no bundled answer can resolve. Spawning
    // is listed because `demoSpawnedAgent` really does hand back a pane the
    // demo session has; agent_events because the away fixture answers it.
    capabilities: ['agent_events', AGENT_SPAWN_CAPABILITY],
    serverId: DEMO_SERVER_ID,
    label: demoRecord.label,
    herdr: {
      connected: true,
      version: '0.7.5',
      protocol: 17,
      compatible: true,
      supportedProtocolMin: 17,
      supportedProtocolMax: null,
    },
  };
}

export function demoSessions() {
  return { sessions: [{ id: SESSION_ID, label: demoRecord.label }] };
}

export function demoWorkspaces(): GatewayEntity[] {
  return normalizeGatewayEntities(workspacesRaw, []);
}
export function demoTabs(): GatewayEntity[] {
  return normalizeGatewayEntities(tabsRaw(), []);
}
export function demoPanes(): GatewayEntity[] {
  return normalizeGatewayEntities(panesRaw, []);
}
export function demoAgents(): GatewayEntity[] {
  return normalizeGatewayEntities(agentsRaw, []);
}

/**
 * The agent catalog the New Task picker draws.
 *
 * Raw wire shape, so demo mode runs the real parser -- including the
 * `available: false` row, which is there on purpose: the picker has to show a
 * kind this host could not find on `PATH` as a hint rather than hide it, and a
 * demo where every option is identical never exercises that.
 */
export function demoAgentProfiles(): Record<string, unknown> {
  return {
    agents: [
      { kind: 'claude', command: 'claude', available: true, source: 'builtin' },
      { kind: 'codex', command: 'codex', available: true, source: 'builtin' },
      { kind: 'opencode', command: 'opencode', available: true, source: 'builtin' },
      { kind: 'gemini', command: 'gemini', available: false, source: 'builtin' },
    ],
    default_startup_timeout_ms: 30_000,
  };
}

/**
 * Where this session has worked lately. The two workspaces the demo panes sit
 * in, plus one the phone would otherwise have to type out, so the recent list
 * is visibly a shortcut rather than a mirror of what is already on screen.
 */
export function demoRecentCwds(): Record<string, unknown> {
  return {
    cwds: ['~/code/muqun', '~/code/muqun/src', '~/code/muqun-gateway'],
  };
}

/**
 * A spawn, answered with the demo's own agent pane.
 *
 * Nothing is created: the fixture session is a fixed five panes, and inventing
 * a sixth would hand the phone an id that the next snapshot does not contain,
 * which is the one failure the panel picker's retry cannot recover from. So the
 * demo does what a real gateway does at the only point that matters to the app
 * -- it names a pane that exists, and the sheet lands on it.
 */
export function demoSpawnedAgent(request: { agent: string }): Record<string, unknown> {
  return {
    pane: {
      pane_id: 'pane-1',
      tab_id: 'tab-1',
      workspace_id: 'ws-1',
      agent: request.agent,
    },
  };
}

/**
 * A workspace for `@` mentions to search. Shallow files first, the way the
 * gateway's own empty-query answer is ordered, so the demo's first screen looks
 * like a real one.
 */
const DEMO_FILES: readonly { path: string; kind: string }[] = [
  { path: 'app.json', kind: 'text' },
  { path: 'package.json', kind: 'text' },
  { path: 'README.md', kind: 'markdown' },
  { path: 'tsconfig.json', kind: 'text' },
  { path: 'src/theme.ts', kind: 'text' },
  { path: 'src/app/settings.tsx', kind: 'text' },
  { path: 'src/app/onboarding.tsx', kind: 'text' },
  { path: 'src/components/toggle-row.tsx', kind: 'text' },
  { path: 'src/stores/app-settings.ts', kind: 'text' },
  { path: 'src/lib/color-mode.ts', kind: 'text' },
  { path: 'docs/theming.md', kind: 'markdown' },
  { path: 'docs/architecture.md', kind: 'markdown' },
  { path: 'assets/icon.png', kind: 'image' },
  { path: 'assets/splash.png', kind: 'image' },
];

/**
 * The demo's answer to the file-search endpoint, in wire shape so demo mode runs
 * the same envelope parser the gateway's answer does.
 *
 * The ranking is a plain subsequence match with the name weighted over the
 * directories above it -- a small echo of what the gateway does properly, which
 * is enough for the demo to behave like the real thing while typing.
 */
export function demoPaneFiles(
  paneId: string,
  query: string,
  limit: number
): Record<string, unknown> {
  const capped = Math.max(1, Math.min(50, Math.round(limit)));
  // Same fence as the real endpoint: a pane the gateway has no workspace for
  // answers with an empty list and a null root rather than with an error.
  const searchable = paneId === 'pane-1';
  const needle = query.trim().toLowerCase();

  const matches = !searchable
    ? []
    : DEMO_FILES.map((file, index) => {
        const name = file.path.slice(file.path.lastIndexOf('/') + 1);
        if (!needle) return { file, name, score: -index };
        const inName = name.toLowerCase().indexOf(needle);
        const inPath = file.path.toLowerCase().indexOf(needle);
        if (inName < 0 && inPath < 0) return null;
        return { file, name, score: (inName >= 0 ? 100 - inName : 0) + (inPath >= 0 ? 10 : 0) };
      })
        .filter(
          (entry): entry is { file: (typeof DEMO_FILES)[number]; name: string; score: number } =>
            entry !== null
        )
        .sort((a, b) => b.score - a.score || a.file.path.length - b.file.path.length)
        .slice(0, capped);

  return {
    schema_version: '1.3.0',
    capabilities: { parts: true, assets: true, image_upload: true, composer: true },
    data: {
      session_id: SESSION_ID,
      pane_id: paneId,
      query: needle,
      limit: capped,
      root: searchable ? '/Users/demo/projects/aurora' : null,
      files: matches.map((entry) => ({
        path: entry.file.path,
        name: entry.name,
        kind: entry.file.kind,
      })),
    },
  };
}
