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
 * Three parts, at least three of them different and carrying text -- the parts
 * twin of `REPEAT_BLOCK_ROWS` and `SANITIZE_MIN_DISTINCT` in
 * `terminal/history.ts`. Below it a repeat is the agent's own output: Claude Code
 * prints `✻ Waiting for 2 background agents to finish` into its transcript every
 * time the count changes, and the same count twice in one session is history.
 */
const REPEAT_RUN_PARTS = 3;

/** What a part says, as one comparable string. */
function partKey(part: PanePart): string {
  return `${part.type}\u0001${part.fallback_text}`;
}

function carriesText(part: PanePart): boolean {
  return part.fallback_text.trim() !== '';
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
 * for as long as the gateway is up.
 *
 * Two repairs, both made only where the evidence is a block and never a line:
 *
 * - a run of {@link REPEAT_RUN_PARTS} or more parts that is, part for part, a
 *   run already kept above it is dropped. The first rendering stays where it
 *   was, so a streaming transcript keeps its rows and only ever grows at the
 *   tail;
 * - where such a run was dropped there is a seam, and the parts right after it
 *   that re-send the tail of what was kept are dropped too. That is the screen
 *   that followed the jump re-sending the rows the buffer already ends with --
 *   the same `already_held` rule the gateway applies, and only ever at a seam,
 *   so two genuine adjacent `Waiting for` banners elsewhere are never touched.
 *
 * Genuinely new blocks are distinct by construction: a different agent name, a
 * different elapsed time, a different count all change the part's text.
 */
export function collapseRepeatedParts(parts: readonly PanePart[]): PanePart[] {
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

    const part = parts[index] as PanePart;
    let repeat = 0;
    if (carriesText(part)) {
      for (const start of positions.get(keys[index] as string) ?? []) {
        let run = 0;
        const distinct = new Set<string>();
        while (
          index + run < parts.length &&
          start + run < keptKeys.length &&
          keptKeys[start + run] === keys[index + run]
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
    if (repeat > 0) {
      index += repeat;
      atSeam = true;
      continue;
    }

    const key = keys[index] as string;
    const seen = positions.get(key);
    if (seen) seen.push(kept.length);
    else positions.set(key, [kept.length]);
    kept.push(part);
    keptKeys.push(key);
    index += 1;
  }

  return kept.length === parts.length ? (parts as PanePart[]) : kept;
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
