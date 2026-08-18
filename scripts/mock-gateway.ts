declare const Bun: {
  file(path: string): { text(): Promise<string> };
  /** Creates missing parent directories, so the uploads dir needs no mkdir. */
  write(path: string, data: Uint8Array): Promise<number>;
  serve(options: {
    port: number;
    hostname: string;
    fetch(request: Request): Response | Promise<Response>;
  }): { url: URL };
};

/** What the multipart body hands back; the RN DOM types do not model it. */
interface UploadedPart {
  name?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const port = Number(process.env.MOCK_GATEWAY_PORT ?? 7347);
const publicUrl = process.env.MOCK_GATEWAY_PUBLIC_URL ?? `http://10.0.2.2:${port}`;
const pairingCode = process.env.MOCK_GATEWAY_CODE ?? 'MUQ2-3456';
const serverId = process.env.MOCK_GATEWAY_SERVER_ID ?? 'mock-gateway';
const serverLabel = process.env.MOCK_GATEWAY_LABEL ?? 'Local Herdr';
const responseDelayMs = Number(process.env.MOCK_GATEWAY_DELAY_MS ?? 0);
const capturePath = process.env.MOCK_GATEWAY_CAPTURE ?? '';
const uploadsDir =
  process.env.MOCK_GATEWAY_UPLOADS ?? `${process.env.TMPDIR ?? '/tmp'}/muqun-mock-uploads`;

type Entity = { id: string; label: string; [key: string]: unknown };

/**
 * Herdr's scroll metrics, which `hasEarlierTerminalOutput` prefers over
 * counting newlines: `max_offset_from_bottom + viewport_rows` is the total row
 * count, so this advertises a 1860-row scrollback and pagination stays
 * available all the way to the app's 2000-line cap.
 */
const paneScroll = { max_offset_from_bottom: 1800, viewport_rows: 60 };

/** How often the SSE ticker bumps the pane revision. */
const eventIntervalMs = Number(process.env.MOCK_GATEWAY_EVENT_MS ?? 5000);

/**
 * Streaming mode: a pane that is still being printed to.
 *
 * Off unless `MOCK_GATEWAY_STREAM_MS` is set, because every other use of this
 * script wants a scrollback that does not move under an assertion.
 *
 * It exists because there was no way to look at a *followed* pane at all. Demo
 * mode is a still image, and the fixed scrollback below never changes, so the
 * app's coalescer sees one identical snapshot and applies exactly one frame --
 * which is the one state in which the follow-to-bottom path does nothing. Card
 * #844 was a judder that only appeared while an agent was printing, and it was
 * unobservable in this repo.
 *
 *   MOCK_GATEWAY_STREAM_MS=100 MOCK_GATEWAY_STREAM_ROWS=6 bun scripts/mock-gateway.ts
 *
 * Six rows per 100ms is roughly what a coding agent mid-answer produces, and
 * 100ms is the interval the app applies frames on, so that pairing puts one
 * burst in each applied frame.
 */
const streamIntervalMs = Number(process.env.MOCK_GATEWAY_STREAM_MS ?? 0);
const streamRowsPerTick = Math.max(1, Number(process.env.MOCK_GATEWAY_STREAM_ROWS ?? 6));

/**
 * A deep synthetic scrollback so a `lines=240` read and a `lines=480` read
 * differ visibly: the endpoint returns the LAST `lines` of it, so the first
 * visible line number is the evidence that a wider read was applied.
 */
const syntheticHistory = Array.from(
  { length: 2000 },
  (_, index) => `history ${String(index + 1).padStart(4, '0')} · scrollback row · panel output`
);

/**
 * Appends what a printing agent would have printed since the last tick, and
 * drops as many off the top.
 *
 * Length is held constant on purpose. A real pane's scrollback is a ring
 * buffer, and a followed reader's offset has to survive rows leaving above them
 * as well as arriving below -- those are the two corrections in the grid's
 * apply effect, and only one of them is exercised by a window that merely grows.
 */
let streamedRows = 0;
function appendStreamedRows(): void {
  for (let index = 0; index < streamRowsPerTick; index += 1) {
    streamedRows += 1;
    syntheticHistory.push(
      `stream ${String(streamedRows).padStart(5, '0')} · the agent is still printing · `
        + 'a line long enough to be worth reading and to wrap on a phone'
    );
    syntheticHistory.shift();
  }
}

const pendingRequests = new Set<string>();
// Enough workspaces, tabs and panes to exercise the panel picker: one of each
// kind the key row resolves differently (agent, editor, plain shell).
const workspaces: Entity[] = [
  { id: 'workspace-1', label: serverLabel, cwd: '/workspace/muqun', pane_count: 3, focused: true },
  { id: 'workspace-2', label: 'muqun-gateway', cwd: '/workspace/muqun-gateway', pane_count: 1 },
];
const tabs: Entity[] = [
  { id: 'tab-1', label: 'Development', workspace_id: 'workspace-1', focused: true },
  { id: 'tab-2', label: 'Release', workspace_id: 'workspace-1' },
  { id: 'tab-3', label: 'API', workspace_id: 'workspace-2' },
];
const panes: Entity[] = [
  {
    id: 'pane-1',
    label: 'Claude Code',
    tab_id: 'tab-1',
    workspace_id: 'workspace-1',
    agent: 'claude',
    cwd: '/workspace/muqun',
    focused: true,
    scroll: paneScroll,
  },
  {
    id: 'pane-2',
    label: 'nvim',
    tab_id: 'tab-1',
    workspace_id: 'workspace-1',
    cwd: '/workspace/muqun/src',
    terminal_title_stripped: 'nvim src/app/_layout.tsx',
    scroll: paneScroll,
  },
  {
    id: 'pane-3',
    label: 'zsh',
    tab_id: 'tab-1',
    workspace_id: 'workspace-1',
    cwd: '/workspace/muqun',
    terminal_title_stripped: 'okk@mac-mini:~/muqun',
    scroll: paneScroll,
  },
  {
    id: 'pane-4',
    label: 'cargo watch',
    tab_id: 'tab-3',
    workspace_id: 'workspace-2',
    cwd: '/workspace/muqun-gateway',
    scroll: paneScroll,
  },
  {
    id: 'pane-5',
    label: 'Codex',
    tab_id: 'tab-2',
    workspace_id: 'workspace-1',
    agent: 'codex',
    cwd: '/workspace/muqun',
  },
  {
    id: 'pane-6',
    label: 'opencode',
    tab_id: 'tab-2',
    workspace_id: 'workspace-1',
    agent: 'opencode',
    cwd: '/workspace/muqun',
  },
  {
    id: 'pane-7',
    label: 'Qoder',
    tab_id: 'tab-2',
    workspace_id: 'workspace-1',
    agent: 'qoder',
    cwd: '/workspace/muqun',
  },
];
// More than one, in more than one state: the server list draws a row per agent
// and colours it by status, so a mock with a single working agent cannot show
// whether any of that is right. Four different agents, because the transcript
// each one leaves is different in ways the chat view has to survive -- see
// `DIVIDERS` below.
const agents: Entity[] = [
  { id: 'agent-1', label: 'Claude Code', target: 'pane-1', pane_id: 'pane-1', agent: 'claude', status: 'working' },
  { id: 'agent-2', label: 'Codex', target: 'pane-5', pane_id: 'pane-5', agent: 'codex', status: 'blocked' },
  { id: 'agent-3', label: 'opencode', target: 'pane-6', pane_id: 'pane-6', agent: 'opencode', status: 'idle' },
  { id: 'agent-4', label: 'Qoder', target: 'pane-7', pane_id: 'pane-7', agent: 'qoder', status: 'idle' },
];
let outputReadCount = 0;
let partsReadCount = 0;
let uploadCount = 0;

/** Source rows the synthetic transcript spans. One part every four rows. */
const TRANSCRIPT_ROWS = 2_000;

/** Source rows one turn of the synthetic transcript spans. */
const TURN_ROWS = 14;

/**
 * How each agent draws a divider, taken verbatim from a live pane of each.
 *
 * The point of keeping four is that they have almost nothing in common. Claude
 * hangs a title off the end of a very long rule and ends its prompt block with
 * a rule and a footer *in the same part*; Codex puts the title at the front,
 * behind a single character; opencode draws no dashes at all, closing every
 * block with a run of upper-half blocks; Qoder stacks three rules through one
 * part as a composer frame. A fixture with one tidy `────` in it -- which is
 * what this had -- proves nothing about any of them, and is why the chat view
 * shipped as a screen of hairlines.
 */
const DIVIDERS: Record<string, { rule: string; titled: (title: string) => string; block: string }> =
  {
    claude: {
      rule: '─'.repeat(120),
      titled: (title) => `${'─'.repeat(80)} ${title} ──`,
      block: `${'─'.repeat(120)}\n  ⏵⏵ auto mode on · ← for agents · esc to interrupt · ↓ to manage`,
    },
    codex: {
      rule: '─'.repeat(118),
      titled: (title) => `─ ${title} ${'─'.repeat(100)}`,
      block: `╭${'─'.repeat(116)}╮\n│ >_ OpenAI Codex (v0.145.0)                                        │\n╰${'─'.repeat(116)}╯`,
    },
    opencode: {
      rule: '▀'.repeat(118),
      titled: (title) => `━━ ${title} ━━`,
      block: `╹${'▀'.repeat(117)}`,
    },
    qoder: {
      rule: '═'.repeat(118),
      titled: (title) => `╭─ ${title} ${'─'.repeat(96)}╮`,
      block: `${'─'.repeat(118)}\n YOLO Shift+Tab to Auto Mode\n${'─'.repeat(118)}\n GLM-5.2 Model · ~/.ws\n${'─'.repeat(118)}`,
    },
  };

/**
 * A transcript as an agent actually leaves one: a question, the pane's echo of
 * that question, some prose, a batch of calls with the diff and the checklist
 * they produced, rules between the batches, a progress banner, and the answer.
 *
 * Every turn therefore carries two rules, one echoed prompt and a banner that
 * is spent the moment the next one arrives. In the live tail that is one of
 * each and nobody notices; in a page of earlier history it is dozens, which is
 * the noise the chat view folds.
 *
 * `fromRow` is the top of the window, so asking for more lines returns more
 * parts with the same ids for the ones already on screen -- which is what makes
 * row reuse and the reading-position anchor observable rather than asserted.
 */
function syntheticParts(fromRow: number, agent = 'claude'): Record<string, unknown>[] {
  const dialect = DIVIDERS[agent] ?? DIVIDERS.claude!;
  const parts: Record<string, unknown>[] = [];
  const range = (start: number, end: number) => ({ start, end });
  const text = (row: number, markdown: string) => ({
    type: 'text',
    markdown,
    range: range(row, row),
    fallback_text: markdown,
  });
  const rule = (row: number) => text(row, dialect.rule);
  const call = (row: number, tool: string, input: string) => ({
    type: 'tool-block',
    tool,
    input,
    result: [`${tool} ok`],
    status: 'ok',
    truncated: false,
    range: range(row, row),
    fallback_text: `⏺ ${tool}(${input})`,
  });

  // Turns sit on a fixed grid, never at the top of whatever window was asked
  // for. Part ids are derived from source rows, so a fixture whose turns moved
  // with the window would hand every part a new id on every page load and make
  // row reuse impossible to observe -- a property of the fixture, not the app.
  const first = Math.ceil(Math.max(0, fromRow) / TURN_ROWS) * TURN_ROWS;
  for (let row = first; row + TURN_ROWS <= TRANSCRIPT_ROWS; row += TURN_ROWS) {
    const turn = Math.floor(row / TURN_ROWS) + 1;
    const file = `src/turn-${turn}.ts`;
    const question = `turn ${turn}: rename the mode helper`;
    parts.push({
      type: 'prompt',
      text: question,
      range: range(row, row),
      fallback_text: `› ${question}`,
    });
    // The echo. Claude Code prints the prompt back under its own marker, and a
    // conversation that shows it twice is a conversation nobody wrote.
    parts.push({
      type: 'prompt',
      text: question,
      range: range(row + 1, row + 1),
      fallback_text: `› ${question}`,
    });
    parts.push({
      type: 'text',
      markdown: `Looking at how \`resolveMode\` is used in ${file}, then renaming it.`,
      range: range(row + 2, row + 2),
      fallback_text: `Looking at how resolveMode is used in ${file}.`,
    });
    // A rule with a title in it. Judged as a whole part this is not a rule at
    // all -- it has words in it -- which is how it reached the screen as a
    // full-width line of box-drawing glyphs.
    parts.push(text(row + 3, dialect.titled(`Analysing ${file}`)));
    parts.push(call(row + 4, 'Read', file));
    parts.push(call(row + 5, 'Grep', 'resolveMode'));
    parts.push({
      type: 'diff',
      file,
      hunks: ['@@ -9,6 +9,9 @@', '-export function resolveMode(', '+export function readMode('],
      range: range(row + 6, row + 6),
      fallback_text: `Update(${file})`,
    });
    parts.push(rule(row + 7));
    parts.push(call(row + 8, 'Edit', file));
    parts.push({
      type: 'todo',
      items: [
        { text: 'Rename the helper', done: true },
        { text: 'Update the call sites', done: true },
        { text: 'Run the tests', done: turn % 3 !== 0 },
      ],
      range: range(row + 9, row + 9),
      fallback_text: '☒ Rename the helper',
    });
    parts.push(call(row + 10, 'Bash', `bun test ${file}`));
    parts.push({
      type: 'status',
      text: `Working on turn ${turn}…`,
      spinner: true,
      range: range(row + 11, row + 11),
      fallback_text: `✻ Working on turn ${turn}…`,
    });
    parts.push({
      type: 'text',
      // A markdown thematic break inside otherwise real prose. The parts layer
      // never sees this one -- commonmark owns it -- so it is the renderer's
      // half of the same problem.
      markdown: `Renamed it to \`readMode\` and updated 4 call sites. Tests pass.\n\n---\n\nNothing else referenced it.`,
      range: range(row + 12, row + 12),
      fallback_text: 'Renamed it to readMode and updated 4 call sites.',
    });
    // The prompt block the agent redraws at the bottom of every turn: a rule
    // and a status footer sharing one part, which is the shape that made the
    // old part-level test useless.
    parts.push(text(row + 13, dialect.block));
  }
  return parts;
}
const terminalOutput = [
  '\u001b[1;36mMuqun Skia terminal\u001b[0m  \u001b[2mGPU-rendered pane snapshot\u001b[0m',
  '┌──────────────────────────────────────────────┐',
  '│ \u001b[32mready\u001b[0m  ANSI · 中文宽字符 · emoji 🚀 · e\u0301     │',
  '└──────────────────────────────────────────────┘',
  '\u001b[38;2;255;90;74m\uf013\u001b[0m settings  \uf07c src  \ue718 app.tsx  \ue7a8 React  \ue0b0 Nerd Font',
  '\uf489 terminal  \ue725 git  中文输入与输出：构建成功，没有乱码。',
  '\u001b[38;2;138;187;255mtrue color\u001b[0m  \u001b[48;5;236;38;5;214m256-color background\u001b[0m',
  'Docs: \u001b]8;;https://docs.expo.dev/versions/v57.0.0/\u0007Expo 57\u001b]8;;\u0007  http://10.0.2.2:7348/health',
  ...Array.from(
    { length: 64 },
    (_, index) => `${String(index + 1).padStart(2, '0')}  dev server log · panel output`,
  ),
  '\u001b[38;2;255;90;74m\uf013\u001b[0m \uf07c src  \ue718 app.tsx  \ue7a8 React  \ue0b0  中文显示正常',
  'Docs: \u001b]8;;https://docs.expo.dev/versions/v57.0.0/\u0007Expo 57\u001b]8;;\u0007  http://10.0.2.2:7348/health',
  'long line → packages/mobile/src/features/terminal/rendering/skia-terminal.tsx:128:24 — horizontal pan keeps every column available',
  '',
  // An agent-drawn table: the columns only line up if the renderer keeps the
  // grid, which is what this fixture is here to prove.
  '\u001b[1m现在两条 iOS lane：\u001b[0m',
  '┌────────────────────┬─────────────┬────────────┬──────────────────────┐',
  '│ \u001b[36m命令\u001b[0m               │ \u001b[35mprofile\u001b[0m     │ channel    │ 去向                 │',
  '├────────────────────┼─────────────┼────────────┼──────────────────────┤',
  '│ \u001b[36mbun run build:ios\u001b[0m  │ \u001b[35mtestflight\u001b[0m  │ preview    │ TestFlight（测试用） │',
  '│ \u001b[36mbun run submit:ios\u001b[0m │ \u001b[35mproduction\u001b[0m  │ production │ TestFlight（正式候选）│',
  '└────────────────────┴─────────────┴────────────┴──────────────────────┘',
  '',
  // A diff hunk the way an agent draws one: whole-row background colour, which
  // only survives if the renderer keeps ANSI background attributes.
  '\u001b[1mUpdate(package.json)\u001b[0m',
  '\u001b[48;2;20;60;20m\u001b[38;2;120;220;120m  58 +    "testflight": {                    \u001b[0m',
  '\u001b[48;2;20;60;20m\u001b[38;2;120;220;120m  59 +      "ios": {}                        \u001b[0m',
  '\u001b[48;2;80;20;20m\u001b[38;2;235;130;130m  67 -    "build:ios": "--profile preview"   \u001b[0m',
  '\u001b[48;2;20;60;20m\u001b[38;2;120;220;120m  67 +    "build:ios": "--profile testflight"\u001b[0m',
  '    68      "build:ios:production": "…"',
].join('\n');

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The allow-list the real gateway sniffs for, in the same order. */
function sniffUploadKind(bytes: Uint8Array): { extension: string; mime: string } | null {
  const starts = (...magic: number[]) => magic.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { extension: 'png', mime: 'image/png' };
  }
  if (starts(0xff, 0xd8, 0xff)) return { extension: 'jpg', mime: 'image/jpeg' };
  const ascii = (offset: number, text: string) =>
    [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { extension: 'gif', mime: 'image/gif' };
  if (bytes.byteLength >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    return { extension: 'webp', mime: 'image/webp' };
  }
  const heicBrands = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1'];
  if (bytes.byteLength >= 12 && ascii(4, 'ftyp') && heicBrands.some((brand) => ascii(8, brand))) {
    return { extension: 'heic', mime: 'image/heic' };
  }
  return null;
}

/**
 * One artifact of every kind the Files browser has a different answer for:
 * `image` opens the lightbox, `markdown` and `text` are read into a string,
 * `pdf` gets the details card. Four rows is the whole matrix.
 */
const mockAssets = [
  {
    id: 'asset-image',
    path: '/workspace/muqun/out/screenshot.png',
    name: 'screenshot.png',
    kind: 'image',
    mime: 'image/png',
    size: 512 * 1024,
    modified_unix_ms: Date.now() - 60_000,
    previewable: true,
  },
  {
    id: 'asset-markdown',
    path: '/workspace/muqun/docs/notes.md',
    name: 'notes.md',
    kind: 'markdown',
    mime: 'text/markdown',
    size: 2_048,
    modified_unix_ms: Date.now() - 120_000,
    previewable: true,
  },
  {
    id: 'asset-text',
    path: '/workspace/muqun/src/index.ts',
    name: 'index.ts',
    kind: 'text',
    mime: 'text/plain',
    size: 1_024,
    modified_unix_ms: Date.now() - 180_000,
    previewable: true,
  },
  {
    id: 'asset-pdf',
    path: '/workspace/muqun/docs/spec.pdf',
    name: 'spec.pdf',
    kind: 'pdf',
    mime: 'application/pdf',
    size: 96_000,
    modified_unix_ms: Date.now() - 240_000,
    previewable: false,
  },
];

/**
 * How long `GET /api/assets/{id}/content` sits on a read before answering.
 *
 * Separate from `MOCK_GATEWAY_DELAY_MS`, which delays *every* route -- at the
 * minute-long values this scenario needs, that one also stalls pairing and the
 * pane list, so the app never gets far enough to open a file. This one stalls
 * only the read, which is the thing under test: a file that is still arriving,
 * on a session that is otherwise responsive.
 */
const assetDelayMs = Number(process.env.MOCK_GATEWAY_ASSET_DELAY_MS ?? 0);

/** A 2x2 PNG; the bytes only have to decode, the viewer is what is under test. */
const pngBytes = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8z4' +
      'AAjEgcEAAAmwEDsDh0/AAAAABJRU5ErkJggg=='
  ),
  (character) => character.charCodeAt(0)
);

const assetMarkdown = [
  '# Release notes',
  '',
  'A file the agent wrote. Tables are a GFM extension:',
  '',
  '| kind | viewer |',
  '| --- | --- |',
  '| image | lightbox |',
  '| markdown | document |',
  '',
].join('\n');

const assetText = [
  "import { serve } from 'bun';",
  '',
  'serve({',
  '  port: 7347,',
  '  fetch: () => new Response("ok"),',
  '});',
  '',
].join('\n');

function assetContent(id: string): { bytes: Uint8Array; mime: string } | null {
  if (id === 'asset-image') return { bytes: pngBytes, mime: 'image/png' };
  if (id === 'asset-markdown') {
    return { bytes: new TextEncoder().encode(assetMarkdown), mime: 'text/markdown' };
  }
  if (id === 'asset-text') {
    return { bytes: new TextEncoder().encode(assetText), mime: 'text/plain' };
  }
  if (id === 'asset-pdf') {
    return { bytes: new TextEncoder().encode('%PDF-1.4\n'), mime: 'application/pdf' };
  }
  return null;
}

function entityCollection(pathname: string) {
  if (pathname.endsWith('/workspaces')) return workspaces;
  if (pathname.endsWith('/tabs')) return tabs;
  if (pathname.endsWith('/panes')) return panes;
  if (pathname.endsWith('/agents')) return agents;
  return null;
}

function nextId(prefix: string, items: Entity[]) {
  return `${prefix}-${items.length + 1}`;
}

/**
 * The shell herdr opens in a tab it has just made, added to the pane list and
 * described the way a create response describes it -- `pane_id`, not `id`,
 * because that is the shape the app reads the new target out of.
 */
function rootPaneFor(tab: Entity) {
  const workspaceId = String(tab.workspace_id ?? 'workspace-1');
  const pane: Entity = {
    id: nextId('pane', panes),
    label: 'zsh',
    tab_id: tab.id,
    workspace_id: workspaceId,
    cwd: String(tab.cwd ?? '/workspace/muqun'),
    terminal_title_stripped: 'okk@mac-mini:~/muqun',
    scroll: paneScroll,
  };
  panes.push(pane);
  return { pane_id: pane.id, tab_id: tab.id, workspace_id: workspaceId };
}

function entityPrefix(pathname: string) {
  if (pathname.includes('/workspaces')) return 'workspace';
  if (pathname.includes('/tabs')) return 'tab';
  if (pathname.includes('/panes')) return 'pane';
  return 'entity';
}

const server = Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    }

    if (request.method === 'OPTIONS') return json({ ok: true });

    if (request.method === 'POST' && pathname === '/api/pair/request') {
      const data = await body(request);
      const requestId = String(data.request_id ?? '');
      if (!requestId) return json({ error: 'request_id is required' }, 400);
      pendingRequests.add(requestId);
      console.log(`[mock] pairing request ${requestId}; code ${pairingCode}`);
      return json({
        request_id: requestId,
        server_id: serverId,
        server_label: serverLabel,
        status: 'pending',
      });
    }

    if (request.method === 'POST' && pathname === '/api/pair/claim') {
      const data = await body(request);
      const requestId = String(data.request_id ?? '');
      const code = String(data.code ?? '').toUpperCase();
      console.log(`[mock] pairing claim fields=${Object.keys(data).join(',')} id=${requestId || '-'} code=${code || '-'}`);
      if (!pendingRequests.has(requestId)) return json({ error: 'pairing request not found' }, 404);
      if (code !== pairingCode) return json({ error: 'incorrect pairing code' }, 401);
      pendingRequests.delete(requestId);
      return json({
        kind: 'muqun-gateway',
        server_id: serverId,
        label: serverLabel,
        url: publicUrl,
        // pairing-transaction.ts requires a 43-128 char token, so the mock
        // must hand out something the app will actually accept.
        token: 'mock-device-token-'.padEnd(43, 'x'),
      });
    }

    // The real gateway decides an upload's type by sniffing the leading bytes
    // and never consults the client's filename, so the mock does the same:
    // a client that names a WebP `.jpg` has to fail here too, or this endpoint
    // would pass a mistake the real one rejects.
    if (request.method === 'POST' && pathname === '/api/uploads') {
      const form = (await request.formData()) as unknown as {
        get(field: string): UploadedPart | string | null;
      };
      const file = form.get('file');
      if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
        return json({ error: 'expected a file field' }, 400);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > 25 * 1024 * 1024) {
        return json({ error: 'the upload must be at most 25 MiB' }, 413);
      }
      const kind = sniffUploadKind(bytes);
      if (!kind) {
        return json({ error: 'only png, jpeg, gif, webp, and heic images are accepted' }, 415);
      }
      const clientName = file.name || `upload.${kind.extension}`;
      uploadCount += 1;
      const path = `${uploadsDir}/upload-${Date.now().toString(36)}-${uploadCount}.${kind.extension}`;
      await Bun.write(path, bytes);
      console.log(`[mock] upload ${clientName} -> ${path} (${bytes.byteLength} bytes, ${kind.mime})`);
      return json({ path, name: clientName, size: bytes.byteLength, mime: kind.mime });
    }

    if (request.method === 'GET' && pathname === '/health') {
      return json({
        ok: true,
        gatewayVersion: 'mock-1.0.0',
        apiVersion: '1.1.0',
        apiMajor: 1,
        serverId,
        label: serverLabel,
        herdr: {
          connected: true,
          version: '0.7.5',
          protocol: 17,
          compatible: true,
          supportedProtocolMin: 17,
          supportedProtocolMax: 17,
        },
      });
    }

    if (request.method === 'GET' && pathname === '/api/sessions') {
      return json({ sessions: [{ id: 'default', label: serverLabel, socket_path: '/tmp/herdr.sock' }] });
    }

    const assetListMatch = pathname.match(/^\/api\/sessions\/[^/]+\/assets$/);
    if (request.method === 'GET' && assetListMatch) {
      const kinds = (url.searchParams.get('kind') ?? '').split(',').filter(Boolean);
      const wanted = url.searchParams.get('path');
      const listed = mockAssets
        .filter((asset) => kinds.length === 0 || kinds.includes(asset.kind))
        .filter((asset) => !wanted || asset.path === wanted);
      return json({ assets: listed });
    }

    const assetContentMatch = pathname.match(/^\/api\/assets\/([^/]+)\/content$/);
    if (request.method === 'GET' && assetContentMatch) {
      const content = assetContent(decodeURIComponent(assetContentMatch[1]));
      if (!content) return json({ error: 'asset not found' }, 404);
      // The stall is here rather than at the top of `fetch`, so everything the
      // app needs in order to REACH a file still answers at once. See
      // `assetDelayMs`.
      if (assetDelayMs > 0) {
        console.log(`[mock] stalling ${pathname} for ${assetDelayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, assetDelayMs));
      }
      // `.buffer`, because the RN DOM lib this project typechecks against does
      // not count a typed array as a `BodyInit`; an ArrayBuffer it does.
      return new Response(content.bytes.buffer as ArrayBuffer, {
        headers: {
          'Content-Type': content.mime,
          'Content-Length': String(content.bytes.byteLength),
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const collection = entityCollection(pathname);
    if (collection && request.method === 'GET') return json(collection);

    if (collection && request.method === 'POST') {
      const data = await body(request);
      const prefix = entityPrefix(pathname);
      const created = {
        id: nextId(prefix, collection),
        label: String(data.label ?? `New ${prefix}`),
        ...data,
      };
      collection.push(created);
      // herdr answers a workspace or tab create with the new container's root
      // pane, and the app selects that pane rather than guessing from the next
      // refresh. A mock that answered with the bare container handed it an
      // empty pane id, so every create looked like it had done nothing.
      if (prefix === 'tab') return json({ ...created, root_pane: rootPaneFor(created) }, 201);
      if (prefix === 'workspace') {
        const tab: Entity = { id: nextId('tab', tabs), label: 'Main', workspace_id: created.id };
        tabs.push(tab);
        return json({ ...created, root_pane: rootPaneFor(tab) }, 201);
      }
      return json(created, 201);
    }

    const entityMatch = pathname.match(/^\/api\/sessions\/[^/]+\/(workspaces|tabs|panes)\/([^/]+)$/);
    if (entityMatch) {
      const [, kind, id] = entityMatch;
      const items = kind === 'workspaces' ? workspaces : kind === 'tabs' ? tabs : panes;
      const index = items.findIndex((item) => item.id === id);
      if (request.method === 'DELETE') {
        if (index >= 0) items.splice(index, 1);
        return json({ ok: true });
      }
      if (request.method === 'PATCH') {
        if (index < 0) return json({ error: 'entity not found' }, 404);
        Object.assign(items[index], await body(request));
        return json(items[index]);
      }
      if (request.method === 'GET') return index >= 0 ? json(items[index]) : json({ error: 'not found' }, 404);
    }

    const shortcutMatch = pathname.match(/^\/api\/sessions\/[^/]+\/panes\/([^/]+)\/shortcuts$/);
    if (request.method === 'GET' && shortcutMatch) {
      const pane = panes.find((item) => item.id === shortcutMatch[1]);
      const agent = String(pane?.agent ?? '');
      const title = String(pane?.terminal_title_stripped ?? '');
      const base = [
        { label: '↵', key: 'enter', description: 'Enter' },
        { label: '⇧↵', key: 'shift+enter', description: 'Newline without sending' },
        { label: 'esc', key: 'esc', description: 'Escape' },
        { label: 'tab', key: 'tab', description: 'Tab' },
        { label: '⌃C', key: 'ctrl+c', description: 'Interrupt' },
        { label: '⌫', key: 'backspace', description: 'Backspace' },
      ];
      const navigation = [
        { label: '←', key: 'left', description: 'Left' },
        { label: '↓', key: 'down', description: 'Down' },
        { label: '↑', key: 'up', description: 'Up' },
        { label: '→', key: 'right', description: 'Right' },
        { label: 'home', key: 'home', description: 'Start of line' },
        { label: 'end', key: 'end', description: 'End of line' },
        { label: 'pg↑', key: 'pageup', description: 'Page up' },
        { label: 'pg↓', key: 'pagedown', description: 'Page down' },
      ];
      const claude = [
        { label: '⇧tab', key: 'shift+tab', description: 'Cycle permission mode' },
        { label: '⌃O', key: 'ctrl+o', description: 'Expand output' },
        { label: '⌃T', key: 'ctrl+t', description: 'Toggle tasks' },
        { label: '⌃B', key: 'ctrl+b', description: 'Run in background' },
        { label: '⌃R', key: 'ctrl+r', description: 'Transcript' },
        { label: '⌃L', key: 'ctrl+l', description: 'Clear screen' },
      ];
      const editor = [
        { label: '⌃W', key: 'ctrl+w', description: 'Window prefix' },
        { label: '⌃D', key: 'ctrl+d', description: 'Half page down' },
        { label: '⌃U', key: 'ctrl+u', description: 'Half page up' },
        { label: '⌃O', key: 'ctrl+o', description: 'Jump back' },
        { label: '⌃R', key: 'ctrl+r', description: 'Redo' },
        { label: '⌃V', key: 'ctrl+v', description: 'Visual block' },
      ];
      const shell = [
        { label: '⌃D', key: 'ctrl+d', description: 'End of input' },
        { label: '⌃A', key: 'ctrl+a', description: 'Start of line' },
        { label: '⌃K', key: 'ctrl+k', description: 'Clear to end of line' },
        { label: '⌃U', key: 'ctrl+u', description: 'Clear line' },
        { label: '⌃W', key: 'ctrl+w', description: 'Delete word' },
        { label: '⌃R', key: 'ctrl+r', description: 'Reverse search' },
        { label: '⌃L', key: 'ctrl+l', description: 'Clear screen' },
      ];
      const isEditor = /^(?:n?vim|helix|hx|emacs|nano)\b/.test(title);
      const profile = agent.includes('claude') ? 'claude' : isEditor ? 'editor' : 'shell';
      const specific = profile === 'claude' ? claude : profile === 'editor' ? editor : shell;
      return json({
        version: 1,
        profile,
        agent,
        keys: [...base, ...specific, ...navigation],
        commands:
          profile === 'claude'
            ? [
                ['/add-dir', 'Add a working directory', '[path]'],
                ['/agents', 'Manage agents', null],
                ['/bug', 'Report a bug to Anthropic', null],
                ['/clear', 'Start a new conversation', null],
                ['/compact', 'Compact the conversation', '[instructions]'],
                ['/config', 'Open settings', null],
                ['/context', 'Show context usage', null],
                ['/cost', 'Show token cost', null],
                ['/doctor', 'Diagnose the installation', null],
                ['/export', 'Export the conversation', null],
                ['/help', 'Show help', null],
                ['/hooks', 'Manage hooks', null],
                ['/ide', 'Connect to an IDE', null],
                ['/init', 'Create an AGENTS.md', null],
                ['/mcp', 'Manage MCP servers', null],
                ['/memory', 'Edit memory files', null],
                ['/model', 'Switch model', '[model]'],
                ['/permissions', 'Manage tool permissions', null],
                ['/resume', 'Resume a past conversation', null],
                ['/review', 'Review the current changes', '[target]'],
                ['/status', 'Show session status', null],
                ['/usage', 'Show usage limits', null],
                ['/vim', 'Toggle vim mode', null],
              ].map(([command, description, argument_hint]) => ({
                command,
                description,
                argument_hint,
                source: 'builtin',
              }))
            : [],
      });
    }

    // A minimal event stream so the app's SSE path can be exercised against the
    // mock: emit a pane_updated with a rising revision every second, which is
    // what drives an output read in the client.
    if (request.method === 'GET' && pathname.endsWith('/events')) {
      let revision = 100;
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          };
          send('herdr', { event: 'subscription_started', data: { type: 'subscription_started' } });
          // One clock, so streaming cannot drift from the events that announce
          // it. The rows are appended here rather than on a timer of their own
          // because a pane nobody is subscribed to has no reason to grow -- and
          // it keeps the two intervals from being two things to keep in sync.
          const timer = setInterval(() => {
            if (streamIntervalMs > 0) appendStreamedRows();
            revision += 1;
            send('herdr', {
              event: 'pane_updated',
              data: { type: 'pane_updated', pane: { pane_id: 'pane-1', revision, tab_id: 'tab-1', workspace_id: 'workspace-1' } },
            });
          }, streamIntervalMs > 0 ? streamIntervalMs : eventIntervalMs);
          request.signal.addEventListener('abort', () => {
            clearInterval(timer);
            controller.close();
          });
        },
      });
      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (request.method === 'GET' && pathname.endsWith('/output')) {
      // Point MOCK_GATEWAY_CAPTURE at a file captured from a real pane to see
      // the app render exactly what the gateway returns, rather than a fixture.
      if (capturePath) {
        return json({ text: Bun.file(capturePath).text ? await Bun.file(capturePath).text() : '' });
      }
      outputReadCount += 1;
      // The ANSI/CJK/Nerd-Font fixture, for looking at the renderer rather than
      // at pagination. Off by default so the numbered scrollback below is what
      // a page read returns.
      if (process.env.MOCK_GATEWAY_FIXTURE === '1') {
        return json({ text: `$ bun run dev\nserver: ${serverLabel}\n${terminalOutput}\nMuqun mock gateway is ready.\n` });
      }
      // Honour `lines` the way the real gateway does: a row limit counted from
      // the bottom. Without this every page read returns the same window and
      // pagination cannot be told apart from a no-op.
      const requestedLines = Number(url.searchParams.get('lines') ?? '');
      const lineLimit =
        Number.isFinite(requestedLines) && requestedLines > 0
          ? Math.min(syntheticHistory.length, Math.round(requestedLines))
          : 240;
      const window = syntheticHistory.slice(-lineLimit);
      // Only a page read is slowed, so the "Loading earlier output…" pill stays
      // up long enough to look at without making the ordinary refresh crawl.
      const pageDelayMs = Number(process.env.MOCK_GATEWAY_PAGE_DELAY_MS ?? 0);
      if (pageDelayMs > 0 && lineLimit > 240) {
        await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
      }
      console.log(
        `[mock] output lines=${lineLimit} (asked ${url.searchParams.get('lines') ?? '-'}) `
          + `source=${url.searchParams.get('source') ?? '-'} format=${url.searchParams.get('format') ?? '-'} `
          + `first=${window[0]?.slice(0, 12)} read#${outputReadCount} ${new Date().toISOString()}`
      );
      return json({ text: `${window.join('\n')}\n` });
    }

    // The normalized transcript, which is what the chat view draws. It honours
    // `lines` the way `/output` does, so a pull in the chat view returns more
    // of the transcript instead of the same window again -- and the transcript
    // is deliberately noisy (rules, spent status banners, long runs of tool
    // calls), because folding that noise is the thing being looked at.
    if (request.method === 'GET' && pathname.endsWith('/parts')) {
      partsReadCount += 1;
      const paneId = pathname.split('/').at(-2) ?? '';
      // Every pane running an agent has a transcript, and each draws it in its
      // own dialect: the chat view has to be checked against all four, not
      // against whichever one the fixture happened to be written from.
      const paneAgent = String(panes.find((pane) => pane.id === paneId)?.agent ?? '');
      if (!paneAgent) {
        return json({
          schema_version: '1.4.0',
          capabilities: { parts: false, assets: true, image_upload: true, composer: false },
          data: { pane: { pane_id: paneId }, parts: [] },
        });
      }
      const requested = Number(url.searchParams.get('lines') ?? '');
      const lineLimit =
        Number.isFinite(requested) && requested > 0
          ? Math.min(TRANSCRIPT_ROWS, Math.round(requested))
          : 240;
      const pageDelayMs = Number(process.env.MOCK_GATEWAY_PAGE_DELAY_MS ?? 0);
      if (pageDelayMs > 0 && lineLimit > 240) {
        await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
      }
      const parts = syntheticParts(TRANSCRIPT_ROWS - lineLimit, paneAgent);
      console.log(
        `[mock] parts lines=${lineLimit} (asked ${url.searchParams.get('lines') ?? '-'}) `
          + `agent=${paneAgent} parts=${parts.length} firstRow=${TRANSCRIPT_ROWS - lineLimit} `
          + `read#${partsReadCount} ${new Date().toISOString()}`
      );
      return json({
        schema_version: '1.4.0',
        capabilities: { parts: 'dictionary', assets: true, image_upload: true, composer: false },
        data: { pane: { pane_id: paneId, agent: paneAgent, parts: 'dictionary' }, parts },
      });
    }

    if (request.method === 'POST' && pathname.endsWith('/split')) {
      const created = { id: nextId('pane', panes), label: 'Split pane', tab_id: 'tab-1' };
      panes.push(created);
      return json(created, 201);
    }

    if (request.method === 'POST' && /\/(send-text|send-keys)$/.test(pathname)) {
      const data = await body(request);
      console.log(`[mock] ${pathname.split('/').at(-1)} ${JSON.stringify(data)}`);
      return json({ ok: true });
    }

    if (
      request.method === 'POST' &&
      (/\/(focus|send|send-text|send-keys)$/.test(pathname) ||
        pathname === '/api/devices/push-token' ||
        pathname === '/api/notifications/test')
    ) {
      return json({ ok: true });
    }

    return json({ error: `No mock route for ${request.method} ${pathname}` }, 404);
  },
});

const qrPayload = `muqun://pair?u=${encodeURIComponent(publicUrl)}&s=${serverId}`;
console.log(`[mock] gateway ${server.url}`);
console.log(`[mock] public URL ${publicUrl}`);
console.log(`[mock] pairing code ${pairingCode}`);
console.log(`[mock] QR payload ${qrPayload}`);
