/**
 * The gateway's unified content model: a pane transcript normalized into an
 * ordered list of parts, so that adding an agent to the gateway never changes
 * the app.
 *
 * Three rules from the model govern everything here, and the app is only stable
 * as long as it keeps them:
 *
 * 1. Every part carries `fallback_text`, and a part whose `type` this build does
 *    not know is rendered as that text. New part types therefore reach old
 *    clients as plain prose instead of as a hole in the transcript.
 * 2. The envelope declares `schema_version`. A minor bump is additive, so it is
 *    read as usual; a major bump is not understood at all, and every part in it
 *    is demoted to its fallback rather than guessed at.
 * 3. Nothing here names an agent. Per-agent extraction is the gateway's job.
 *
 * Kept free of transport and of React so the whole contract can be tested as a
 * pure function of one JSON envelope.
 */
import { terminalScrollbackRows } from '@/terminal/history';

import { paneComposerFromResponse, type PaneComposer } from './pane-composer';

export const PANE_PARTS_SCHEMA_MAJOR = 1;

export type PanePartStatus = 'ok' | 'error' | 'running';

/** Source row span, so a part can be correlated with the raw terminal view. */
export interface PanePartRange {
  start: number;
  end: number;
}

export interface PaneTodoItem {
  text: string;
  done: boolean;
}

interface PanePartCommon {
  /** Assigned here, not by the gateway: the list needs a key per row. */
  id: string;
  /** What this part looks like with no renderer for it. Never empty. */
  fallback_text: string;
  range?: PanePartRange;
}

/**
 * `unknown` is not a wire type. It is where a part lands when this build has no
 * renderer for its `type`, or when a known type arrives without the payload it
 * needs -- either way the answer is the same, so both take the same shape.
 */
export type PanePart = PanePartCommon &
  (
    | { type: 'text'; markdown: string }
    | {
        type: 'tool-block';
        tool: string;
        input: string;
        result: string[];
        status: PanePartStatus;
        truncated: boolean;
      }
    | { type: 'todo'; items: PaneTodoItem[] }
    | { type: 'diff'; file?: string; hunks: string[] }
    | { type: 'table'; rows: string[][] }
    | { type: 'status'; text: string; spinner: boolean }
    | { type: 'prompt'; text: string }
    | { type: 'asset-ref'; asset_id: string }
    | { type: 'unknown'; declaredType: string }
  );

/** What the connected gateway says it can do, as declared in the envelope. */
export interface GatewayCapabilities {
  parts: boolean;
  assets: boolean;
  imageUpload: boolean;
  /**
   * The gateway knows how to describe a pane's composer. Only ever a hint that
   * the field may be there -- what actually gates the picker is the per-pane
   * descriptor below, since a gateway with the capability still answers `null`
   * for an agent it has no table for.
   */
  composer: boolean;
}

/**
 * How this particular pane was read, as the gateway reports it under
 * `data.pane.parts`.
 *
 * The distinction `capabilities.parts` cannot make. That flag is a fact about
 * the *gateway* -- a build that knows how to normalize at all answers `true`
 * for every pane it is asked about -- while this says whether anything actually
 * normalized *this* pane:
 *
 * - `native`: the agent's own protocol answered, so a tool's exit code, the
 *   patch an edit produced and any pending permission arrive as data.
 * - `dictionary`: typed parts read off the screen through the marker table for
 *   whichever agent Herdr reports.
 * - `text`: no table covers this pane, so everything degraded to prose. The
 *   parts are real and still render, but a conversation built out of them is
 *   one undifferentiated block of screen scrapings.
 * - `none`: the gateway never said, which is every gateway older than the
 *   field. Read as `text`, because a client must not invent a capability.
 */
export type PanePartsSource = 'native' | 'dictionary' | 'text' | 'none';

export interface PaneParts {
  schemaVersion: string;
  capabilities: GatewayCapabilities;
  /** What normalized this pane, if anything did. */
  source: PanePartsSource;
  /**
   * Whether this pane has a transcript worth reading as a conversation. This,
   * and not `capabilities.parts`, is the gate on the chat view: the flag is
   * `true` on every pane a modern gateway serves, so gating on it offered a
   * "chat" made of screen scrapings for every agent the gateway has no table
   * for. Keyed on what the pane reports, never on the agent's name.
   */
  structured: boolean;
  parts: PanePart[];
  /**
   * What this pane's composer can offer, or `null`. Carried on the same
   * envelope as the transcript, so the picker costs no extra request; see
   * `pane-composer.ts`.
   */
  composer: PaneComposer | null;
}

export const NO_GATEWAY_CAPABILITIES: GatewayCapabilities = {
  parts: false,
  assets: false,
  imageUpload: false,
  composer: false,
};

export function panePartsFromResponse(value: unknown): PaneParts {
  const envelope = (value ?? {}) as Record<string, unknown>;
  const schemaVersion = typeof envelope.schema_version === 'string' ? envelope.schema_version : '';
  const capabilities = capabilitiesFromResponse(envelope.capabilities);
  // A major version this build has never seen may mean anything, so no payload
  // in it is interpreted -- only the fallback each part is required to carry.
  const understood = schemaMajor(schemaVersion) === PANE_PARTS_SCHEMA_MAJOR;
  const data = (envelope.data ?? envelope) as Record<string, unknown>;
  const entries = Array.isArray(data.parts) ? data.parts : [];

  const parts: PanePart[] = [];
  for (const [index, entry] of entries.entries()) {
    const part = normalizePanePart(entry, index, understood);
    if (part) parts.push(part);
  }
  const source = understood ? panePartsSource(data.pane) : 'none';
  return {
    schemaVersion,
    capabilities,
    source,
    // A gateway too old to declare a per-pane source is not a gateway with no
    // panes worth reading, so its envelope-level flag is still honoured -- but
    // a gateway that *does* declare one is taken at its word, `text` included.
    structured:
      source === 'native' || source === 'dictionary' || (source === 'none' && capabilities.parts),
    parts,
    composer: paneComposerFromResponse(envelope, understood),
  };
}

function panePartsSource(pane: unknown): PanePartsSource {
  if (!pane || typeof pane !== 'object' || Array.isArray(pane)) return 'none';
  const declared = (pane as Record<string, unknown>).parts;
  if (declared === 'native' || declared === 'dictionary' || declared === 'text') return declared;
  // Older builds sent a boolean here rather than the strategy that answered.
  if (declared === true) return 'dictionary';
  if (declared === false) return 'text';
  return 'none';
}

/**
 * Whether this pane has transcript above the window these parts were read at.
 *
 * Same question the raw view asks, answered from the same gateway metric, so
 * the two views cannot disagree about where history ends. Parts cannot be
 * merged the way raw lines can -- a part is a claim about a span of source rows,
 * not a line -- so paging the transcript means re-reading it at a wider limit,
 * and this is what decides whether a wider limit would return anything.
 *
 * Without the metric the fallback is the rows the parts themselves cover: a
 * transcript that reaches the top of its window is one the window cut off.
 */
export function hasEarlierPaneParts(
  parts: readonly PanePart[],
  requestedLines: number,
  maximumLines: number,
  scroll: unknown
): boolean {
  if (requestedLines >= maximumLines) return false;

  const totalRows = terminalScrollbackRows(scroll);
  if (totalRows !== null) return totalRows > requestedLines;

  return coveredRows(parts) >= Math.max(1, requestedLines - 1);
}

/**
 * The same question, asked again once a wider read has actually come back.
 *
 * The raw view's twin (`hasEarlierAfterPage`), for the same measured reason:
 * the gateway's row metric overstates what a wider limit returns, so a
 * transcript can go on being offered history that re-reads to exactly the span
 * it already had. A re-read covering no more rows than the last one did not
 * reach any further back. See card #646.
 */
export function hasEarlierPartsAfterPage(
  parts: readonly PanePart[],
  requestedLines: number,
  maximumLines: number,
  scroll: unknown,
  previousRows: number
): boolean {
  if (paneTranscriptRows(parts) <= previousRows) return false;
  return hasEarlierPaneParts(parts, requestedLines, maximumLines, scroll);
}

/** Source rows the transcript spans, as far as the parts declare them. */
export function paneTranscriptRows(parts: readonly PanePart[]): number {
  return coveredRows(parts);
}

function coveredRows(parts: readonly PanePart[]): number {
  let first = Number.POSITIVE_INFINITY;
  let last = -1;
  for (const part of parts) {
    if (!part.range) continue;
    if (part.range.start < first) first = part.range.start;
    if (part.range.end > last) last = part.range.end;
  }
  if (last < 0 || !Number.isFinite(first)) return 0;
  return last - first + 1;
}

function capabilitiesFromResponse(value: unknown): GatewayCapabilities {
  if (!value || typeof value !== 'object') return NO_GATEWAY_CAPABILITIES;
  const raw = value as Record<string, unknown>;
  return {
    // Per-pane capabilities name the extraction strategy ("dictionary") where
    // the envelope carries a plain boolean; both mean the same thing here.
    parts: isCapabilityEnabled(raw.parts),
    assets: isCapabilityEnabled(raw.assets),
    imageUpload: isCapabilityEnabled(raw.image_upload),
    composer: isCapabilityEnabled(raw.composer),
  };
}

function isCapabilityEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' && value.length > 0 && value !== 'none';
}

function schemaMajor(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : -1;
}

function normalizePanePart(value: unknown, index: number, understood: boolean): PanePart | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const declaredType = typeof raw.type === 'string' ? raw.type : '';
  const range = normalizePartRange(raw.range);
  // Keyed by source rows where the gateway reports them, so output appended to
  // the transcript does not renumber the rows already on screen.
  const id = range ? `r${range.start}-${range.end}` : `i${index}`;
  const fallbackText = typeof raw.fallback_text === 'string' ? raw.fallback_text : '';
  const common = { id, fallback_text: fallbackText, ...(range ? { range } : {}) };
  // Rule 1, applied before any payload is read: a part with neither a known
  // type nor a fallback carries nothing that can be shown, so it is dropped.
  const unknown = fallbackText ? { ...common, type: 'unknown' as const, declaredType } : null;
  if (!understood) return unknown;

  switch (declaredType) {
    case 'text': {
      const markdown = typeof raw.markdown === 'string' ? raw.markdown : fallbackText;
      return markdown ? { ...common, type: 'text', markdown } : unknown;
    }
    case 'tool-block': {
      const tool = typeof raw.tool === 'string' ? raw.tool : '';
      if (!tool) return unknown;
      return {
        ...common,
        type: 'tool-block',
        tool,
        input: typeof raw.input === 'string' ? raw.input : '',
        result: stringList(raw.result),
        status:
          raw.status === 'ok' || raw.status === 'error' || raw.status === 'running'
            ? raw.status
            : 'ok',
        truncated: raw.truncated === true,
      };
    }
    case 'todo': {
      const items = normalizeTodoItems(raw.items);
      return items.length > 0 ? { ...common, type: 'todo', items } : unknown;
    }
    case 'diff': {
      const hunks = stringList(raw.hunks);
      if (hunks.length === 0) return unknown;
      const file = typeof raw.file === 'string' && raw.file ? raw.file : undefined;
      return { ...common, type: 'diff', hunks, ...(file ? { file } : {}) };
    }
    case 'table': {
      const rows = normalizeTableRows(raw.rows);
      return rows.length > 0 ? { ...common, type: 'table', rows } : unknown;
    }
    case 'status': {
      const text = typeof raw.text === 'string' ? raw.text : fallbackText;
      return text ? { ...common, type: 'status', text, spinner: raw.spinner === true } : unknown;
    }
    case 'prompt': {
      const text = typeof raw.text === 'string' ? raw.text : fallbackText;
      return text ? { ...common, type: 'prompt', text } : unknown;
    }
    case 'asset-ref': {
      const assetId = typeof raw.asset_id === 'string' ? raw.asset_id : '';
      return assetId ? { ...common, type: 'asset-ref', asset_id: assetId } : unknown;
    }
    default:
      return unknown;
  }
}

function normalizePartRange(value: unknown): PanePartRange | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.start !== 'number' || typeof raw.end !== 'number') return undefined;
  return { start: Math.round(raw.start), end: Math.round(raw.end) };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function normalizeTodoItems(value: unknown): PaneTodoItem[] {
  if (!Array.isArray(value)) return [];
  const items: PaneTodoItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.text !== 'string' || !raw.text) continue;
    items.push({ text: raw.text, done: raw.done === true });
  }
  return items;
}

function normalizeTableRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  const rows: string[][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    rows.push(entry.map((cell) => (typeof cell === 'string' ? cell : String(cell ?? ''))));
  }
  return rows;
}

/**
 * The smallest run of parts that counts as a block the gateway wrote down twice.
 *
 * Four parts, all four different and carrying text -- the parts twin of
 * `REPEAT_BLOCK_ROWS` in `terminal/history.ts`. Below it a repeat is the agent's
 * own output: Claude Code prints `✻ Waiting for 2 background agents to finish`
 * into its transcript every time the count changes, and a turn that ends the
 * way the previous one did -- a reply, that banner, a one-line summary -- is
 * three parts that can recur verbatim with the user's message between them. A
 * copy the gateway wrote is a screen, which is many times this.
 */
const REPEAT_RUN_PARTS = 4;

/** What a part says, as one comparable string. */
function partKey(part: PanePart): string {
  return `${part.type}\u0001${part.fallback_text}`;
}

function carriesText(part: PanePart): boolean {
  return part.fallback_text.trim() !== '';
}

/** The first line of a part's text, trimmed. */
function firstLineOf(part: PanePart): string {
  const text = part.fallback_text;
  const newline = text.indexOf('\n');
  return (newline === -1 ? text : text.slice(0, newline)).trim();
}

/**
 * A line drawn entirely out of horizontal rule characters. Only the characters
 * a terminal composer frames itself with; the chat view's own rule judgement
 * (`pane-chat.ts`) is wider, and is about prose rather than about furniture.
 */
function isRuleLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= 3 && /^[─━═╌╍┄┅┈┉\-_]+$/.test(trimmed);
}

/** The last line of a part's text that carries anything, trimmed. */
function lastLineOf(part: PanePart): string {
  const lines = part.fallback_text.split('\n').filter((line) => line.trim() !== '');
  return (lines[lines.length - 1] ?? '').trim();
}

/** A text part that is nothing but rule lines. */
function isRulePart(part: PanePart): boolean {
  if (part.type !== 'text') return false;
  const lines = part.fallback_text.split('\n').filter((line) => line.trim() !== '');
  return lines.length > 0 && lines.every(isRuleLine);
}

/**
 * Whether the prompt at `index` is drawn as a composer box: a part ending in a
 * rule above it (the rule, sometimes with a notice drawn over it) and a part
 * opening with a rule below it. A prompt the user sent sits
 * in the transcript without that frame, which is what tells a frozen composer
 * from a turn.
 */
function isComposerBox(parts: readonly PanePart[], index: number): boolean {
  const prompt = parts[index];
  const above = parts[index - 1];
  const below = parts[index + 1];
  return Boolean(
    prompt?.type === 'prompt' &&
    above?.type === 'text' &&
    isRuleLine(lastLineOf(above)) &&
    below &&
    isRuleLine(firstLineOf(below))
  );
}

/** The first non-space character of each line of a part that carries any. */
function lineMarkers(part: PanePart): Set<string> {
  const markers = new Set<string>();
  for (const line of part.fallback_text.split('\n')) {
    const marker = line.trim()[0];
    if (marker) markers.add(marker);
  }
  return markers;
}

/**
 * A frozen roster with the roster taken off its head.
 *
 * The rows under a composer -- the agent roster, `● main`, `◯ general-purpose
 * …` -- arrive as one part, and when the screen after a frozen one starts with
 * no blank row between, its first rows are glued onto that part: the tail of a
 * tool block, `⎿ 1 file changed…`. Those are transcript. So the roster's lines
 * come off the front -- every line opening with a character the live roster's
 * lines open with -- and whatever follows stays, as the same part. `null` when
 * nothing follows.
 */
function withoutRoster(part: PanePart, markers: ReadonlySet<string>): PanePart | null {
  const lines = part.fallback_text.split('\n');
  let cut = 0;
  while (cut < lines.length) {
    const marker = (lines[cut] as string).trim()[0];
    if (marker !== undefined && !markers.has(marker)) break;
    cut += 1;
  }
  const rest = lines.slice(cut).join('\n');
  if (!rest.trim()) return null;
  if (part.type === 'text') return { ...part, fallback_text: rest, markdown: rest };
  return { ...part, fallback_text: rest };
}

/**
 * What to take out of a transcript for the composer boxes frozen screens left
 * in it: indices to drop, and parts to replace with what is left of them.
 *
 * The live tail ends in the agent's composer -- a rule, the prompt being typed,
 * a rule and a mode line, sometimes an agent roster under that. A screen the
 * gateway committed to history while it was frozen carries a box of its own, so
 * one turns up mid-transcript with the status line that was spinning above it
 * at that moment. Every box but the last one is such a leftover, whatever was
 * typed in it then -- usually nothing, an empty `❯`. Recognised by shape alone:
 * a prompt the user sent sits in the transcript without rules around it, so a
 * real turn cannot be taken for one. A `Waiting for N` line is transcript, not
 * the spinner, and stays.
 */
function frozenComposerParts(parts: readonly PanePart[]): {
  dropped: Set<number>;
  trimmed: Map<number, PanePart>;
} {
  const dropped = new Set<number>();
  const trimmed = new Map<number, PanePart>();
  let tail = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isComposerBox(parts, index)) {
      tail = index;
      break;
    }
  }
  if (tail < 0) return { dropped, trimmed };

  const liveRoster = parts[tail + 2];
  const rosterHead = liveRoster ? firstLineOf(liveRoster) : '';
  const rosterMarkers = liveRoster ? lineMarkers(liveRoster) : new Set<string>();
  for (let index = 1; index < tail - 1; index += 1) {
    if (!isComposerBox(parts, index)) continue;
    dropped.add(index - 1);
    dropped.add(index);
    dropped.add(index + 1);
    const roster = parts[index + 2];
    if (roster && rosterHead && firstLineOf(roster) === rosterHead) {
      const rest = withoutRoster(roster, rosterMarkers);
      if (rest) trimmed.set(index + 2, rest);
      else dropped.add(index + 2);
    }
    // The spinner that was turning above the box: past any blank or drawn parts
    // between them, and only a status that is not transcript -- prose there is
    // the conversation, and Claude Code prints `Waiting for N background agents`
    // into it on purpose.
    for (let above = index - 2; above >= 0; above -= 1) {
      const candidate = parts[above] as PanePart;
      if (candidate.type === 'status') {
        if (!/Waiting for \d+/.test(candidate.fallback_text)) dropped.add(above);
        break;
      }
      if (carriesText(candidate) && !isRulePart(candidate)) break;
    }
  }
  return { dropped, trimmed };
}

/**
 * A transcript with the screens the gateway wrote down twice taken back out.
 *
 * The gateway keeps history for panes that repaint an alternate screen (Claude
 * Code, opencode) by placing each read against the end of what it holds. A read
 * that places nowhere -- the screen jumped further than a poll can follow, which
 * is also what a reader scrolling the agent's own transcript back looks like --
 * is appended whole, and when the screen comes back down the newest screen is
 * appended after it again. The buffer is then `[history][an older screen][the
 * newest screen]`, and every block on both of those screens is on the list twice
 * for as long as the gateway is up. A screen committed while it was frozen also
 * leaves the composer box it was showing in the middle of history.
 *
 * Three repairs, all made only where the evidence is a block and never a line:
 *
 * - a frozen composer box -- a prompt framed by rules, with its mode line,
 *   roster and the spinner above it -- that is not the last one is dropped,
 *   whatever was typed in it (see {@link frozenComposerParts});
 * - a run of {@link REPEAT_RUN_PARTS} or more parts that is, part for part, a
 *   run anywhere above it in what arrived is dropped. Matched against the
 *   incoming list rather than against what was kept: copies stack (an older
 *   screen, a frozen one, the newest), and once the middle of the first copy
 *   has been folded against an even older one, what is left of it no longer
 *   lines up with the next copy -- whose head then survived on its own. The
 *   first rendering stays where it was, so a streaming transcript keeps its
 *   rows and only ever grows at the tail;
 * - where such a run was dropped there is a seam, and the parts right after it
 *   that re-send the tail of what was kept are dropped too. That is the screen
 *   that followed the jump re-sending the rows the buffer already ends with --
 *   the same `already_held` rule the gateway applies, and only ever at a seam,
 *   so two genuine adjacent `Waiting for` banners elsewhere are never touched.
 *
 * Genuinely new blocks are distinct by construction: a different agent name, a
 * different elapsed time, a different count all change the part's text.
 */
export function collapseRepeatedParts(incoming: readonly PanePart[]): PanePart[] {
  const frozen = frozenComposerParts(incoming);
  const parts =
    frozen.dropped.size > 0 || frozen.trimmed.size > 0
      ? incoming.flatMap((part, index) =>
          frozen.dropped.has(index) ? [] : [frozen.trimmed.get(index) ?? part]
        )
      : incoming;
  const keys = parts.map(partKey);
  const kept: PanePart[] = [];
  const keptKeys: string[] = [];
  const positions = new Map<string, number[]>();
  let atSeam = false;
  let index = 0;

  while (index < parts.length) {
    if (atSeam) {
      atSeam = false;
      const widest = Math.min(keptKeys.length, parts.length - index);
      let resent = 0;
      for (let count = widest; count > 0; count -= 1) {
        const from = keptKeys.length - count;
        let same = true;
        for (let step = 0; step < count; step += 1) {
          if (keptKeys[from + step] !== keys[index + step]) {
            same = false;
            break;
          }
        }
        if (same) {
          resent = count;
          break;
        }
      }
      if (resent > 0) {
        index += resent;
        continue;
      }
    }

    const key = keys[index] as string;
    let repeat = 0;
    if (carriesText(parts[index] as PanePart)) {
      for (const start of positions.get(key) ?? []) {
        let run = 0;
        const distinct = new Set<string>();
        // The earlier copy must end before this one begins: a run may not be
        // matched against itself.
        while (
          index + run < parts.length &&
          start + run < index &&
          keys[start + run] === keys[index + run]
        ) {
          if (carriesText(parts[index + run] as PanePart))
            distinct.add(keys[index + run] as string);
          run += 1;
        }
        if (run >= REPEAT_RUN_PARTS && distinct.size >= REPEAT_RUN_PARTS && run > repeat) {
          repeat = run;
        }
      }
    }

    // Every position is remembered, kept or not: the next copy is compared with
    // what arrived, not with what survived.
    for (let step = 0; step < Math.max(repeat, 1); step += 1) {
      const at = index + step;
      const seen = positions.get(keys[at] as string);
      if (seen) seen.push(at);
      else positions.set(keys[at] as string, [at]);
    }
    if (repeat > 0) {
      index += repeat;
      atSeam = true;
      continue;
    }

    kept.push(parts[index] as PanePart);
    keptKeys.push(key);
    index += 1;
  }

  return parts === incoming && kept.length === incoming.length ? (incoming as PanePart[]) : kept;
}

/** How much of the window's tail stands for its content in {@link panePartsRefreshKey}. */
const REFRESH_KEY_TAIL = 2048;

/**
 * What decides that a pane's transcript has to be read again.
 *
 * This was the pane's `revision` wherever there was one, and the window
 * otherwise -- on the assumption that the revision counts content. It does not:
 * the `revision` on a Herdr pane counts the pane's *metadata* (title, agent
 * status). Measured on the owner's Claude pane `w17:p1`: revision 4 for hours
 * while the screen changed on every poll, and Herdr's own read revision is 0 on
 * every read. Keyed on that, the chat view read the transcript once and then
 * held it, so a reader kept looking at whatever the pane showed when they
 * opened it -- a screen frozen mid-turn, with the old gateway's duplicates in
 * it, long after the gateway had moved on (and been restarted).
 *
 * So the window's own content is always part of the key: its length and its
 * tail, which is where a pane changes -- new output, the spinner, the timer.
 * The revision stays in it, so a change of title or status still reads again.
 */
export function panePartsRefreshKey(revision: number, output: string): string {
  return `rev:${revision}|${output.length}|${output.slice(-REFRESH_KEY_TAIL)}`;
}

/** A transcript whose ids are stable across reads, and the shift that made them so. */
export interface ReconciledPaneParts {
  parts: PanePart[];
  /** Added to every source row to get the id, carried to the next read. */
  offset: number;
}

/**
 * The incoming transcript, deduplicated and keyed in the previous read's rows.
 *
 * A part's id is its source rows, and those rows are counted from the top of the
 * *window* the gateway served -- the last `lines` rows of its buffer. Once the
 * buffer is deeper than the window, every row of new output slides the window
 * down by one, so every part on screen comes back with a different id on every
 * poll. Measured against a live gateway: from the moment the window filled, not
 * one id survived from one read to the next. Every list key changed, so the chat
 * view unmounted and remounted every row it was showing, once a second, for as
 * long as the agent was printing -- the flicker -- and the reader's position had
 * nothing left to anchor to.
 *
 * So the window's slide is measured, not assumed: each part is matched to the
 * same text in the previous read, and the shift most of them agree on is the one
 * the window moved by. Ids are written in the previous read's coordinates, which
 * makes an unchanged part the same row it was, and lets the incremental builder
 * in `pane-chat.ts` hand back the same object for it.
 */
export function reconcilePaneParts(
  previous: readonly PanePart[],
  previousOffset: number,
  incoming: readonly PanePart[]
): ReconciledPaneParts {
  const parts = collapseRepeatedParts(incoming);

  const before = new Map<string, number[]>();
  for (const part of previous) {
    if (!part.range || !carriesText(part)) continue;
    const key = partKey(part);
    const start = part.range.start + previousOffset;
    const starts = before.get(key);
    if (starts) starts.push(start);
    else before.set(key, [start]);
  }

  let offset = previousOffset;
  if (before.size > 0) {
    const votes = new Map<number, number>();
    for (const part of parts) {
      if (!part.range || !carriesText(part)) continue;
      for (const start of before.get(partKey(part)) ?? []) {
        const shift = start - part.range.start;
        votes.set(shift, (votes.get(shift) ?? 0) + 1);
      }
    }
    let best = 0;
    for (const [shift, count] of votes) {
      if (
        count > best ||
        (count === best && Math.abs(shift - previousOffset) < Math.abs(offset - previousOffset))
      ) {
        best = count;
        offset = shift;
      }
    }
  }

  if (offset === 0) return { parts, offset };
  return {
    parts: parts.map((part) =>
      part.range
        ? {
            ...part,
            id: `r${part.range.start + offset}-${part.range.end + offset}`,
          }
        : part
    ),
    offset,
  };
}
