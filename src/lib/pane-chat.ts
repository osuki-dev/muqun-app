import type { PanePart, PanePartStatus } from './pane-parts';

/**
 * The conversation model behind the chat view: the gateway's ordered parts,
 * arranged as the rows a chat list actually draws.
 *
 * Two jobs:
 *
 * 1. **Simplification.** `simplified` mode draws a conversation, and a
 *    conversation is two things: what the user said, and what the agent said
 *    back. Everything else a pane emits is machinery, and machinery is not
 *    hidden here as a matter of taste -- a transcript is overwhelmingly
 *    machinery, so folding it is also what keeps the list short enough to
 *    render. Concretely, in `simplified`:
 *
 *    - a run of adjacent **work** -- tool calls, the diffs they produced, the
 *      checklists they wrote -- collapses into one row that says how many steps
 *      it was. The parts are not built into rows at all until it is opened, so
 *      the view mounts none of their bodies;
 *    - **rules** drawn in text (`────`) are dropped, line by line rather than
 *      part by part, because a part is a span of source rows and a divider
 *      routinely shares one with the paragraph under it. A rule with a heading
 *      in it (`──── Analysis ──`) keeps the heading and loses the drawing. A
 *      rule between two batches does not split them: it is scenery, not a
 *      subject change;
 *    - of the **progress banners** only the newest survives, because a banner
 *      says what the pane is doing *now* and every earlier one is a sentence
 *      about a moment that has passed;
 *    - a **prompt** the pane echoed back is drawn once, not twice.
 *
 *    All of it matters far more above the fold than below it: the live tail
 *    carries one rule and one banner, while a page of earlier history carries
 *    dozens of each -- which is what made loading history read as the folding
 *    having been switched off.
 * 2. **Identity.** A pane streams by appending to its tail, but the gateway
 *    answers with a whole new array of freshly parsed parts every time. Rebuilt
 *    naively, every row would be a new object and the entire list would
 *    re-render on each poll. `buildPaneChatItems` is therefore incremental: it
 *    is handed the items it produced last time and returns the *same objects*
 *    for every row whose content has not moved, which is what lets a memoized
 *    row skip its render and turns a poll into "re-render the tail".
 *
 * Free of React and of transport, so both of those properties are testable as
 * plain functions.
 */
export type PaneChatDetail = 'simplified' | 'detailed';

export type PaneChatToolBlock = Extract<PanePart, { type: 'tool-block' }>;

/**
 * A part that is the agent working rather than the agent talking.
 *
 * A diff and a checklist are the *output* of the call above them -- the patch
 * an edit produced, the list a todo write submitted -- so they belong inside
 * the step that produced them, not as cards of their own between two sentences.
 */
export type PaneChatActivityPart = Extract<
  PanePart,
  { type: 'tool-block' } | { type: 'diff' } | { type: 'todo' }
>;

function isActivityPart(part: PanePart): part is PaneChatActivityPart {
  return part.type === 'tool-block' || part.type === 'diff' || part.type === 'todo';
}

interface PaneChatItemCommon {
  /** Stable across rebuilds, and unique within one list: the React key. */
  id: string;
  /**
   * A cheap stand-in for "the content of this row". Two rebuilds that produce
   * the same id and the same signature reuse the previous object.
   */
  signature: string;
}

export type PaneChatItem = PaneChatItemCommon &
  (
    | { kind: 'prompt'; text: string; part: PanePart }
    | { kind: 'part'; part: PanePart }
    /**
     * A heading the pane drew out of rule characters -- `──── Analysis ────`.
     * The rule around it is chrome, but the words between are a section title,
     * so the row keeps the words and drops the drawing.
     */
    | { kind: 'label'; text: string; part: PanePart }
    | {
        kind: 'activity';
        /** The work this row stands for, in the order it happened. */
        steps: PaneChatActivityPart[];
        /** Distinct step names, in the order they were first used. */
        tools: string[];
        status: PanePartStatus;
        summary: string;
      }
  );

export interface PaneChatOptions {
  detail: PaneChatDetail;
}

/**
 * How many tool blocks one collapsed row may stand for. A cap at all is the
 * point: without one, a long batch of shell calls is a single list row that
 * becomes a hundred cards the moment it is opened, and a virtualized list can
 * do nothing about a row that tall. Twenty keeps the collapsed view short and
 * the expanded view survivable.
 */
export const MAX_ACTIVITY_RUN = 20;

/**
 * The characters an agent draws a horizontal rule out of: the box-drawing
 * horizontals and the corners and joins that cap them, the long dashes and the
 * block elements used as underlines, and the ASCII four.
 *
 * A class rather than a list of agents, and that is the whole design. Four
 * agents draw four kinds of divider today and the fifth one is not going to ask
 * permission; a table keyed on the agent's name would also be the app's first
 * violation of the parts contract, whose third rule is that nothing here names
 * one. What every divider has in common is not who drew it, it is what it is
 * made of.
 */
const RULE_CHARACTERS = new Set([
  // Box drawing: the horizontals, and the corners and joins that terminate a
  // drawn rule. A corner only ever appears at the end of one.
  '─',
  '━',
  '┄',
  '┅',
  '┈',
  '┉',
  '═',
  '╌',
  '╍',
  '╴',
  '╶',
  '╸',
  '╺',
  '┌',
  '┐',
  '└',
  '┘',
  '├',
  '┤',
  '┬',
  '┴',
  '┼',
  '╭',
  '╮',
  '╰',
  '╯',
  '╔',
  '╗',
  '╚',
  '╝',
  '╠',
  '╣',
  '╦',
  '╩',
  '╬',
  // Blocks and half-lines agents underline with. `▀` is not decoration: one
  // agent ends every prompt block with a 226-character run of it.
  '▔',
  '▁',
  '▬',
  '‾',
  '▀',
  '▄',
  '╹',
  '╻',
  // The long dashes, including the full-width and small forms.
  '—',
  '–',
  '‒',
  '―',
  '⎯',
  '⏤',
  '﹘',
  '﹣',
  '－',
  // ASCII: the three markdown thematic breaks, plus the equals sign.
  '-',
  '_',
  '=',
  '*',
]);

/**
 * Rule characters that may not *anchor* a heading, though they still count
 * towards one being a rule.
 *
 * `*` and `_` have to be in the class, because `***` and `___` are thematic
 * breaks and a line of them is a rule. They must not anchor, because
 * `**bold**` is a line framed by two runs of two rule characters and is
 * therefore a perfect forgery of `── heading ──`. Emphasis can draw a rule; it
 * cannot draw the ends of one.
 *
 * The blocks are here for the same reason from the other direction: a run of
 * them is an underline, but they are also what a progress bar and a sparkline
 * are made of, and `████░░ 80%` must not be read as a heading called `░░ 80%`.
 */
const NON_ANCHOR_CHARACTERS = new Set(['*', '_', '▀', '▄', '▬', '█']);

/** Below this a run of dashes is punctuation ("--") rather than a rule. */
const MINIMUM_RULE_LENGTH = 3;

/**
 * How much of a line has to be rule characters before the line is scenery.
 *
 * Occupancy, not homogeneity. The old test asked that every non-space character
 * be the *same* character, which is true of `────` and false of `═══ ─── ═══`,
 * of a rule with one stray glyph in it, and of every mixed divider the agents
 * actually print. A share instead says the honest thing: a line that is ninety
 * percent drawing is a drawing.
 */
const RULE_DOMINANCE = 0.9;

/**
 * What it takes for the rule characters at the ends of a line to be read as the
 * frame around a heading rather than as part of the sentence.
 *
 * Either one long run at *an* end, or short runs at both. Which end has to be
 * left open, because the agents disagree and there is no majority: one writes
 * `───────── title ──`, the next writes `─ title ─────────`, the third boxes it
 * as `╭─ title ──────╮`. A rule with a word in it is a heading whichever side
 * the word sits on.
 *
 * Four characters, or two on each side. A list bullet (`- item`, one character)
 * and an aside (`-- ok`, two and nothing to close them) fail both tests and
 * stay prose, which is the direction the whole file fails in: a sentence
 * swallowed as scenery is far worse than a divider that survived.
 */
const STRONG_ANCHOR = 4;
const FRAMED_ANCHOR = 2;

/** Past this a "heading" is a paragraph that opened with a dash. */
const MAX_LABEL_LENGTH = 80;

type RuleVerdict =
  /** Left exactly as it was. */
  | { kind: 'prose' }
  /** Nothing but drawing. Dropped. */
  | { kind: 'rule' }
  /** A heading with its frame removed. */
  | { kind: 'label'; text: string };

const PROSE: RuleVerdict = { kind: 'prose' };
const RULE: RuleVerdict = { kind: 'rule' };

function isAnchorCharacter(character: string): boolean {
  return RULE_CHARACTERS.has(character) && !NON_ANCHOR_CHARACTERS.has(character);
}

/**
 * What one line of a text part is: prose, a rule, or a rule with a heading in
 * it. Indentation is irrelevant -- a divider the CLI printed inside a panel
 * arrives with leading spaces and is still a divider.
 */
function classifyRuleLine(raw: string): RuleVerdict {
  const line = raw.trim();
  if (!line) return PROSE;

  let ruleCount = 0;
  let contentCount = 0;
  for (const character of line) {
    if (character === ' ' || character === '\t') continue;
    if (RULE_CHARACTERS.has(character)) ruleCount += 1;
    else contentCount += 1;
  }
  if (ruleCount === 0) return PROSE;

  // The heading is looked for *before* the line is written off as a drawing,
  // and that order is load-bearing. A 220-character rule with `Worked for 1m
  // 13s` in it is 94% rule characters -- more than dominant -- so asking "is
  // this a rule?" first answers yes and throws the words away with it. The
  // longer the rule, the more certainly it would have swallowed its own title.
  //
  // The runs at the two ends, spaces included: `──── Analysis ──` is anchored
  // by four characters on the left and two on the right, and the space between
  // the frame and the word belongs to the frame.
  let coreStart = 0;
  let leading = 0;
  while (coreStart < line.length) {
    const character = line[coreStart] as string;
    if (character === ' ' || character === '\t') {
      coreStart += 1;
      continue;
    }
    if (!isAnchorCharacter(character)) break;
    leading += 1;
    coreStart += 1;
  }

  let coreEnd = line.length - 1;
  let trailing = 0;
  while (coreEnd >= coreStart) {
    const character = line[coreEnd] as string;
    if (character === ' ' || character === '\t') {
      coreEnd -= 1;
      continue;
    }
    if (!isAnchorCharacter(character)) break;
    trailing += 1;
    coreEnd -= 1;
  }

  // A "heading" made of nothing but more rule characters is not a heading --
  // it is the rest of the rule, reached because the characters that drew it
  // are not allowed to anchor one (`***`, `╹▀▀▀…`). Such a line has no words
  // to rescue, so it falls through to the drawing test below.
  const core = line.slice(coreStart, coreEnd + 1).trim();
  let coreContent = 0;
  for (const character of core) {
    if (character === ' ' || character === '\t') continue;
    if (!RULE_CHARACTERS.has(character)) coreContent += 1;
  }
  if (
    coreContent > 0 &&
    (leading >= STRONG_ANCHOR ||
      trailing >= STRONG_ANCHOR ||
      (leading >= FRAMED_ANCHOR && trailing >= FRAMED_ANCHOR))
  ) {
    return { kind: 'label', text: core };
  }

  // Nothing to keep. Occupancy, not homogeneity: a line that is overwhelmingly
  // drawing is a drawing, however many different characters drew it.
  if (
    ruleCount >= MINIMUM_RULE_LENGTH &&
    ruleCount >= RULE_DOMINANCE * (ruleCount + contentCount)
  ) {
    return RULE;
  }
  return PROSE;
}

/**
 * Whether any line of this markdown could possibly be a rule, answered without
 * looking at the words.
 *
 * Reading every byte of every text part on every poll is exactly the cost this
 * file exists to avoid, and the normalization below does read every byte. It is
 * only ever reached through here, because every line the normalization would
 * touch -- a rule, or a heading inside one -- *begins* with a rule character
 * once its indentation is skipped. So the question is only ever asked of the
 * first character of each line, and `indexOf` finds the next one natively.
 *
 * A paragraph of prose therefore costs one native scan for newlines and one
 * lookup per line, and comes back untouched and un-split.
 */
function hasRuleLineCandidate(markdown: string): boolean {
  let lineStart = 0;
  for (;;) {
    let cursor = lineStart;
    while (cursor < markdown.length) {
      const character = markdown[cursor];
      if (character !== ' ' && character !== '\t' && character !== '\r') break;
      cursor += 1;
    }
    const character = markdown[cursor];
    if (character !== undefined && RULE_CHARACTERS.has(character)) return true;
    const newline = markdown.indexOf('\n', lineStart);
    if (newline === -1) return false;
    lineStart = newline + 1;
  }
}

export interface NormalizedText {
  /** The markdown to draw. Empty means the part was all scenery. */
  markdown: string;
  /** Set when what is left is one heading the pane drew, and nothing else. */
  label: string | null;
}

/**
 * A text part with the drawing taken out of it.
 *
 * Line by line rather than part by part, which is the fix: a part is a span of
 * source rows, not a sentence, so a rule and the paragraph after it routinely
 * arrive as one `text`. Judged as a whole that part is not "all one rule
 * character" and every hairline in it survived -- which is what a page of chat
 * mode was made of.
 *
 * Runs of rules collapse for free, since each is dropped and the blank line a
 * dropped rule leaves behind is only kept when it separates two things that are
 * still there. Without that a swallowed divider leaves a hole in the markdown
 * the same height as the line it replaced.
 */
export function normalizeRuleLines(markdown: string): NormalizedText {
  if (!hasRuleLineCandidate(markdown)) return { markdown, label: null };

  const kept: string[] = [];
  let labels = 0;
  let lastLabel = '';
  let pendingBlank = false;
  for (const line of markdown.split('\n')) {
    const verdict = classifyRuleLine(line);
    if (verdict.kind === 'rule') continue;
    if (verdict.kind === 'prose' && !line.trim()) {
      // Held rather than written: a blank line only earns its place once
      // something follows it, which is what collapses the gaps.
      pendingBlank = kept.length > 0;
      continue;
    }
    if (pendingBlank) kept.push('');
    pendingBlank = false;
    if (verdict.kind === 'label') {
      kept.push(verdict.text);
      labels += 1;
      lastLabel = verdict.text;
      continue;
    }
    kept.push(line);
  }

  const cleaned = kept.join('\n');
  const label =
    labels === 1 && kept.length === 1 && lastLabel.length <= MAX_LABEL_LENGTH ? lastLabel : null;
  return { markdown: cleaned, label };
}

/**
 * Whether this part is nothing but rules.
 *
 * Now a corollary of the line judgement rather than a rule of its own: a part
 * is a separator when every line of it was drawing. Strictly more than the old
 * test caught -- a part of three differently-drawn rules is one too -- and
 * prose that merely contains a dash still keeps its row.
 */
export function isSeparatorPart(part: PanePart): boolean {
  if (part.type !== 'text') return false;
  return normalizeRuleLines(part.markdown).markdown.trim() === '';
}

/**
 * Where the newest progress banner is, or -1.
 *
 * A `status` part says what the pane is doing *now*, so every earlier one is a
 * sentence about a moment that has passed. Found by walking back from the end
 * and stopping at the first hit: in a live transcript that is the last part or
 * close to it, and even the worst case is a pass of type checks with no string
 * work, which is the budget this file is written to.
 */
function lastStatusIndex(parts: readonly PanePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === 'status') return index;
  }
  return -1;
}

/**
 * Build the rows for a transcript. Pass the previous result to keep unchanged
 * rows referentially stable; omit it and every row is new, which is the right
 * answer when the pane itself changed.
 */
export function buildPaneChatItems(
  parts: readonly PanePart[],
  options: PaneChatOptions,
  previous?: readonly PaneChatItem[]
): PaneChatItem[] {
  const reusable = indexById(previous);
  const items: PaneChatItem[] = [];
  const seen = new Set<string>();
  const simplify = options.detail === 'simplified';
  const newestStatus = simplify ? lastStatusIndex(parts) : -1;
  // The prompt drawn immediately above, so a pane that echoes what the user
  // typed does not put it on screen twice. Cleared by anything else being
  // drawn: an echo is adjacent, while the same words after an answer are the
  // user saying them again, and swallowing that would lose a turn.
  let echoedPrompt = '';

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;

    if (simplify) {
      if (part.type === 'text') {
        const signature = `text|${signatureOfPart(part)}`;
        // Answered from last time's row before the markdown is read at all.
        // Cleaning is a pure function of the part, so a part that has not moved
        // cleans to what it cleaned to before -- and that row is already built,
        // already cleaned, and is what `reuse` would hand back anyway. Without
        // this the steady-state poll re-reads every byte of every text part in
        // order to rebuild a row it then throws away, which is precisely the
        // cost this file exists to avoid.
        //
        // The `seen` check keeps it equivalent to the long way round: an id
        // already taken is one `reuse` would have suffixed, so that case is
        // left to it.
        const cached = reusable.get(part.id);
        if (cached && cached.signature === signature && !seen.has(part.id)) {
          seen.add(part.id);
          // Not an echo of anything, so a repeated prompt below is a real turn.
          echoedPrompt = '';
          items.push(cached);
          continue;
        }
        const cleaned = normalizeRuleLines(part.markdown);
        // All scenery: the row never existed as far as the list is concerned.
        if (!cleaned.markdown.trim()) continue;
        echoedPrompt = '';
        items.push(reuse(reusable, seen, textItem(part, cleaned, signature)));
        continue;
      }
      if (part.type === 'status' && index !== newestStatus) continue;
      if (part.type === 'prompt') {
        const text = part.text.trim();
        if (text && text === echoedPrompt) continue;
        echoedPrompt = text;
      } else {
        echoedPrompt = '';
      }

      if (isActivityPart(part)) {
        // Swallow the whole adjacent run in one step, so a hundred Bash calls
        // between two sentences cost the list one row rather than a hundred.
        const steps: PaneChatActivityPart[] = [part];
        let scan = index + 1;
        while (steps.length < MAX_ACTIVITY_RUN) {
          const next = parts[scan];
          if (!next) break;
          // A rule between two batches is not a change of subject, and it is
          // about to be dropped anyway -- so the batches on either side of it
          // are one run, not two. Without this a page of earlier history comes
          // back as alternating dividers and one-step rows.
          if (isSeparatorPart(next)) {
            scan += 1;
            continue;
          }
          if (!isActivityPart(next)) break;
          steps.push(next);
          scan += 1;
        }
        index = scan - 1;
        items.push(reuse(reusable, seen, activityItem(steps)));
        continue;
      }
    }

    items.push(reuse(reusable, seen, partItem(part)));
  }

  return items;
}

function partItem(part: PanePart): PaneChatItem {
  const signature = `${part.type}|${signatureOfPart(part)}`;
  if (part.type === 'prompt') {
    return { kind: 'prompt', id: part.id, signature, text: part.text, part };
  }
  return { kind: 'part', id: part.id, signature, part };
}

/**
 * A text row built from the part as it arrived and the normalization of it.
 *
 * The signature is handed in, computed from the *original* part and before the
 * markdown was read -- which is what lets the caller answer from last time's
 * row without cleaning at all. It carries no trace of whether this came out a
 * label or a paragraph, and it does not need to: which of the two a part
 * becomes is a function of its content, and its content is what the signature
 * samples. A part that has not moved produces the signature it produced before,
 * so it comes back as the row it was, already cleaned.
 */
function textItem(
  part: PanePart & { type: 'text' },
  cleaned: NormalizedText,
  signature: string
): PaneChatItem {
  if (cleaned.label !== null) {
    return { kind: 'label', id: part.id, signature, text: cleaned.label, part };
  }
  // Untouched markdown keeps the original object rather than a copy of it, so
  // the common case allocates nothing.
  const drawn = cleaned.markdown === part.markdown ? part : { ...part, markdown: cleaned.markdown };
  return { kind: 'part', id: part.id, signature, part: drawn };
}

function activityItem(steps: PaneChatActivityPart[]): PaneChatItem {
  const tools: string[] = [];
  let status: PanePartStatus = 'ok';
  let signature = `activity|${steps.length}`;
  for (const step of steps) {
    const name = activityStepName(step);
    if (!tools.includes(name)) tools.push(name);
    // Worst news wins: one failed step in a run of twenty is the thing worth
    // seeing from a collapsed row. A diff or a checklist carries no status of
    // its own -- it is the result of the call above it, which does.
    if (step.type === 'tool-block') {
      if (step.status === 'error') status = 'error';
      else if (step.status === 'running' && status !== 'error') status = 'running';
    }
    signature += `|${signatureOfPart(step)}`;
  }
  return {
    kind: 'activity',
    // Keyed by where the run starts, so appending a step to a running batch
    // does not renumber the batch.
    id: `act:${steps[0]?.id ?? '0'}`,
    signature,
    steps,
    tools,
    status,
    summary: summarizeActivity(steps, tools),
  };
}

/** What one step of a run is called, for the chip and for its card's header. */
export function activityStepName(step: PaneChatActivityPart): string {
  if (step.type === 'tool-block') return step.tool;
  if (step.type === 'diff') return 'Diff';
  return 'Todo';
}

/**
 * What a collapsed run says about itself.
 *
 * A single step reads like the thing it is, because one line naming one command
 * is not noise and hiding it behind a count would only make it harder to reach.
 * A run reads as a bare count: the chip's job is to say "the agent did some
 * work here, it is fine, move on", and a list of tool names is the beginning of
 * a terminal rather than the end of one. The names are still there for whoever
 * opens it.
 */
export function summarizeActivity(
  steps: readonly PaneChatActivityPart[],
  tools: readonly string[]
): string {
  if (steps.length === 1) {
    const only = steps[0];
    if (!only) return '';
    const name = activityStepName(only);
    const detail = activityStepDetail(only);
    return detail ? `${name} · ${detail}` : name;
  }
  // `tools` is deliberately unread here: see above. It stays a field on the row
  // because the expanded body and the accessibility label both want it.
  void tools;
  return `${steps.length} steps`;
}

/** The one line of a step worth putting on the chip beside its name. */
function activityStepDetail(step: PaneChatActivityPart): string {
  if (step.type === 'tool-block') return firstLine(step.input);
  if (step.type === 'diff') return step.file ?? '';
  const done = step.items.filter((item) => item.done).length;
  return `${done}/${step.items.length}`;
}

export function firstLine(value: string): string {
  return (value.split('\n', 1)[0] ?? '').trim();
}

/**
 * Reuse the previous object for a row whose id and signature both match, and
 * keep ids unique while we are here: the model derives an id from a part's
 * source rows, and two parts reported on the same rows would otherwise collide
 * as list keys.
 */
function reuse(
  reusable: Map<string, PaneChatItem>,
  seen: Set<string>,
  item: PaneChatItem
): PaneChatItem {
  let candidate = item;
  if (seen.has(candidate.id)) {
    let suffix = 2;
    while (seen.has(`${item.id}#${suffix}`)) suffix += 1;
    candidate = { ...item, id: `${item.id}#${suffix}` };
  }
  seen.add(candidate.id);
  const previous = reusable.get(candidate.id);
  return previous && previous.signature === candidate.signature ? previous : candidate;
}

function indexById(items: readonly PaneChatItem[] | undefined): Map<string, PaneChatItem> {
  const map = new Map<string, PaneChatItem>();
  if (!items) return map;
  // By id rather than by position, so loading earlier output -- which pushes
  // every row down -- still reuses the rows that were already on screen.
  for (const item of items) map.set(item.id, item);
  return map;
}

/**
 * A part's content, cheaply.
 *
 * Reading every byte of a long transcript on every poll is exactly the cost
 * this file exists to avoid, so the signature samples instead: the length, the
 * head, and the tail of the text the part already carries for fallback
 * rendering, plus whichever fields change without changing that text.
 *
 * The tail matters more than it looks. A transcript is append-only, so a length
 * that has not changed almost always means content that has not changed -- but
 * a *running* tool block rewrites its last line in place ("Encoded 115/300" ->
 * "Encoded 300/300"), same type, same length. Sampling the tail catches that;
 * sampling only the length would freeze a live block on screen.
 */
export function signatureOfPart(part: PanePart): string {
  const base = sample(part.fallback_text);
  switch (part.type) {
    case 'text':
      return `${base}~${part.markdown.length}`;
    case 'tool-block':
      return `${base}~${part.status}${part.truncated ? 't' : ''}~${part.result.length}~${sample(
        part.result[part.result.length - 1] ?? ''
      )}`;
    case 'status':
      return `${base}~${part.spinner ? 's' : ''}`;
    case 'todo':
      return `${base}~${part.items.map((item) => (item.done ? '1' : '0')).join('')}`;
    case 'diff':
      return `${base}~${part.hunks.length}`;
    case 'table':
      return `${base}~${part.rows.length}`;
    case 'asset-ref':
      return `${base}~${part.asset_id}`;
    default:
      return base;
  }
}

const HEAD_SAMPLE = 32;
const TAIL_SAMPLE = 96;

function sample(value: string): string {
  const head = hash(value.slice(0, HEAD_SAMPLE));
  const tail = value.length > HEAD_SAMPLE ? hash(value.slice(-TAIL_SAMPLE)) : head;
  return `${value.length}.${head}.${tail}`;
}

/** FNV-1a, over at most 128 characters. Not a checksum -- a change detector. */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}
