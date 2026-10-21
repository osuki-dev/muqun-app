/**
 * The agent's latest words, read off its terminal pane.
 *
 * A pane has no transcript: all Home can read is what the agent drew. This
 * picks the agent's last prose out of a capture of the pane -- Claude Code,
 * Codex and agents drawn like them -- and drops everything else: the composer
 * and what sits under it, box chrome, spinners, tool calls and their output,
 * token counters. The turn ends at the reader's own message, so a reply from
 * before it is never shown as the answer to it. When nothing reads as prose,
 * nothing is returned: the line is never made up.
 */

/** CSI, OSC and other escape sequences, as a `text` read may still carry them. */
// oxlint-disable-next-line no-control-regex -- terminal escapes are control characters
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
// oxlint-disable-next-line no-control-regex -- the remaining C0 controls, tab kept
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** A line of nothing but box drawing, rules, blocks and filler. */
const CHROME = /^[\s─-▟⠀-⣿\-_=~*·.:+|]*$/;
/** A boxed panel's sides. */
const BOX_SIDES = /^\s*[│┃║]\s?|\s*[│┃║]\s*$/g;
/** The reader's line: the composer, or a message already sent. */
const PROMPT = /^\s?(?:>|›|❯|▌)(?:\s|$)/;
/** An agent block's bullet: Claude Code `⏺`/`●`, Codex `•`/`◦`. */
const BULLET = /^(?:⏺|●|•|◦)\s?/;
/** A tool's output under its call: Claude Code `⎿`, Codex `└`/`│`. */
const TOOL_OUTPUT = /^\s+(?:⎿|└|├)/;
/** A spinner: a glyph, then a gerund with an ellipsis (`✻ Cogitating… (12s)`). */
const SPINNER = /^(?:[✻✢✳✶✽✺✹✸✷✦*·◐◓◑◒⠁-⣿]\s*)?\S+(?:…|\.\.\.)(?:\s*\(.*\))?$/;
/** Status and footer text, wherever it is drawn. */
const STATUS =
  /esc to (?:interrupt|cancel)|ctrl\+[a-z] to (?:interrupt|expand|cycle)|shift\+tab to cycle|\?\s*for shortcuts|context left|\btokens? used\b|[↑↓]\s*[\d.,]+\s*[km]?\s*tokens?|\b[\d.,]+\s*[km]?\s+tokens\b|accept edits|bypass permissions|plan mode on|auto-accept|IDE (?:dis)?connected|⏎ send|press ctrl-c again|update available|auto-?updat|run:? [\w-]+ (?:upgrade|update|install)\b|new version (?:of|is) available/i;
/** A Claude Code tool call (`Bash(git diff)`, `Read(src/a.ts)`, `Update Todos`). */
const CLAUDE_TOOL = /^(?:[A-Z][\w-]*(?:\s[\w-]+)?\(.*\)?|Update Todos|Read \d+ files?.*)$/;
/** A Codex tool call (`Ran git status`, `Explored`, `Edited src/a.ts (+3 -1)`). */
const CODEX_TOOL =
  /^(?:Ran|Running|Explored|Exploring|Edited|Editing|Added|Deleted|Searched|Listed|Called|Calling|Waited|Waiting for|Updated Plan|Proposed Change|Change Approved)\b(?![^.!?]*[.!?]$)/;

/** The longest line handed back: the bar shows two lines of it. */
const MAX_LINE = 280;

type Line = { text: string; prompt: boolean; noise: boolean };

function classify(raw: string): Line {
  const boxed = /^\s*[│┃║]/.test(raw) && /[│┃║]\s*$/.test(raw);
  const text = boxed ? raw.replace(BOX_SIDES, '') : raw.replace(/\s+$/, '');
  const trimmed = text.trim();
  const prompt = PROMPT.test(text);
  // A boxed panel that is not the composer is a dialog or a banner.
  const noise =
    !trimmed ||
    (boxed && !prompt) ||
    CHROME.test(trimmed) ||
    STATUS.test(trimmed) ||
    SPINNER.test(trimmed.replace(BULLET, ''));
  return { text, prompt, noise: noise && !prompt };
}

function isTool(head: string, body: readonly string[]): boolean {
  return CLAUDE_TOOL.test(head) || CODEX_TOOL.test(head) || body.some((l) => TOOL_OUTPUT.test(l));
}

function readable(text: string): string | undefined {
  const line = text.replace(/\s+/g, ' ').trim();
  // Prose has words; a row of glyphs and digits is drawing.
  const letters = line.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 2 || letters < line.length / 4) return undefined;
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1).trimEnd()}…` : line;
}

/**
 * The agent's last prose in a pane capture (`text` format, the visible
 * screen), as one line; `undefined` when the capture has none.
 */
export function paneAgentLine(output: string): string | undefined {
  return paneAgentRead(output).line;
}

/** A spinner or an interrupt hint: the agent is at work on the screen itself. */
const AT_WORK = /esc to interrupt|ctrl\+c to interrupt/i;

/**
 * What a pane capture says about its agent's current turn: its last prose
 * (`line`), the reader's message that turn answers (`prompt`, as drawn), and
 * whether the screen shows the agent still at work (`busy`: a spinner or an
 * interrupt hint below that message).
 */
export function paneAgentRead(output: string): {
  line?: string;
  prompt?: string;
  busy: boolean;
} {
  const { lines, start, blocks, bulletedAgent } = readTurn(output);
  const prompt = start > 0 ? lines[start - 1]!.text.replace(PROMPT, '').trim() : undefined;
  const busy = lines.slice(start).some((line) => {
    const text = line.text.trim();
    return AT_WORK.test(text) || (text.length > 0 && SPINNER.test(text.replace(BULLET, '')));
  });
  const turn = { ...(prompt ? { prompt } : {}), busy };
  for (let at = blocks.length - 1; at >= 0; at -= 1) {
    const block = blocks[at]!;
    if (block.noise || isTool(block.head, block.body)) continue;
    const prose = blockProse(block, bulletedAgent);
    if (prose) return { ...turn, line: prose };
  }
  return turn;
}

type Block = {
  head: string;
  body: string[];
  bulleted: boolean;
  noise: boolean;
  /** The block's first line, as an index into the capture's lines. */
  at: number;
  /** Lines under it left out as noise (`ctrl+o to expand`): still something under it. */
  hidden: number;
};

/**
 * A capture split at its turn: the reader's last message and what the agent
 * drew under it, down to the composer, as blocks.
 */
function readTurn(output: string) {
  const lines = output
    .replace(ANSI, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw) => classify(raw.replace(CONTROL, '')));

  // The composer is the lowest prompt; what is drawn under it is footer. The
  // reader's last message is the prompt above it, and the turn starts there.
  let end = lines.length;
  for (let at = lines.length - 1; at >= 0; at -= 1)
    if (lines[at]!.prompt) {
      end = at;
      break;
    }
  let start = 0;
  for (let at = end - 1; at >= 0; at -= 1)
    if (lines[at]!.prompt) {
      start = at + 1;
      break;
    }

  // The turn as blocks, each a bullet line and what is indented under it. A
  // spinner or status bullet still opens a block, so its output is not
  // mistaken for the previous one's.
  const blocks: Block[] = [];
  for (let at = start; at < end; at += 1) {
    const line = lines[at]!;
    const head = BULLET.test(line.text);
    if (line.noise && !head) {
      const last = blocks[blocks.length - 1];
      // Only an indented line is under it; a spinner at the margin is not.
      if (last && /^\s{2,}\S/.test(line.text)) last.hidden += 1;
      continue;
    }
    if (head || blocks.length === 0)
      blocks.push({
        head: line.text.replace(BULLET, '').trim(),
        body: [],
        bulleted: head,
        noise: line.noise,
        at,
        hidden: 0,
      });
    else blocks[blocks.length - 1]!.body.push(line.text);
  }
  // An agent that marks its messages with bullets (Claude Code, Codex) says
  // everything it means to the reader in one: unbulleted text on its screen
  // is the TUI's own -- notices, hints, banners -- and never its answer.
  const bulletedAgent = lines.some((line) => BULLET.test(line.text));
  return { lines, start, end, blocks, bulletedAgent };
}

/** A prose block's words as one line, or nothing when it says nothing readable. */
function blockProse(block: Block, bulletedAgent: boolean): string | undefined {
  if (bulletedAgent && !block.bulleted) return undefined;
  // A bulleted message reads as one paragraph, its wrapped lines rejoined;
  // an agent drawn without bullets gives its last readable line.
  if (block.bulleted) return readable([block.head, ...block.body].join(' '));
  const rows = [block.head, ...block.body];
  for (let row = rows.length - 1; row >= 0; row -= 1) {
    const text = readable(rows[row]!);
    if (text) return text;
  }
  return undefined;
}

// -- What the agent is doing now ---------------------------------------------

/** A spinner glyph before a status word. */
const SPINNER_GLYPH = /^[✻✢✳✶✽✺✹✸✷✦*·◐◓◑◒⠁-⣿]\s*/;
/** A status line: a short phrase, then its counters in parentheses. */
const STATUS_PHRASE = /^(\p{L}[\p{L}'-]*(?:\s\p{L}[\p{L}'-]*){0,3}(?:…|\.\.\.)?)\s*(?:\((.*)\))?$/u;
/** The elapsed time among a status line's counters (`12s`, `1m 5s`). */
const ELAPSED = /\b(\d+h\s?\d+m|\d+m\s?\d+s|\d+[hms])\b/;
/** A tool's own "still going" line under its call. */
const STILL_RUNNING = /^(?:running|waiting|in progress)(?:…|\.\.\.)?$/i;
/** A Claude Code call: its tool and argument, `Bash(bun test src)`. */
const CLAUDE_CALL = /^([A-Z][\w-]*(?:\s[\w-]+)?)\((.*?)\)?$/;

/**
 * The agent's status line (`✻ Cogitating… (12s · ↑ 1.2k tokens · esc to
 * interrupt)`, Codex's `◦ Working (32s • esc to interrupt)`) as its phrase
 * and elapsed time: "Cogitating… 12s".
 */
function statusText(text: string): string | undefined {
  const line = text.trim().replace(BULLET, '').replace(SPINNER_GLYPH, '');
  const match = STATUS_PHRASE.exec(line);
  if (!match) return undefined;
  const phrase = match[1]!;
  const counters = match[2] ?? '';
  // A gerund with an ellipsis is a spinner; anything else must say it can be interrupted.
  if (!/(?:…|\.\.\.)$/.test(phrase) && !AT_WORK.test(counters)) return undefined;
  if (STATUS.test(phrase)) return undefined;
  const elapsed = ELAPSED.exec(counters)?.[1];
  return elapsed ? `${phrase} ${elapsed}` : phrase;
}

/** A tool call block as one line: "Bash: bun test src", "Ran bun test src". */
function toolText(block: Block): string | undefined {
  const call = CLAUDE_CALL.exec(block.head);
  let text: string;
  if (call && call[2]) text = `${call[1]}: ${call[2]}`;
  else if (call) text = call[1]!;
  else {
    text = block.head;
    // A one-word Codex group (`Explored`, `Waiting for`) says what in its body.
    if (!/\s/.test(text.trim())) {
      const detail = block.body
        .map((row) => row.replace(/^\s*(?:└|├|│)?\s*/, '').trim())
        .filter(Boolean)
        .at(-1);
      if (detail) text = `${text}: ${detail}`;
    }
  }
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1).trimEnd()}…` : line;
}

/** A call with nothing under it yet, or only its own "Running…": it is running now. */
function toolRunning(block: Block): boolean {
  return (
    block.hidden === 0 &&
    block.body.every((row) => {
      const text = row
        .trim()
        .replace(/^(?:⎿|└|├|│)\s*/, '')
        .trim();
      return !text || STILL_RUNNING.test(text);
    })
  );
}

/**
 * What the agent in a pane capture is doing right now, as one line: whichever
 * is newest on its screen in the current turn of its tool call ("Bash: bun
 * test src", "Ran bun test src"), its status line ("Cogitating… 12s") and its
 * latest words. A call still running is what it is doing, even with the
 * status line drawn under it. Box chrome, footers and notices ("Update
 * available") are never it; `undefined` when the turn shows nothing.
 */
export function paneAgentActivity(output: string): string | undefined {
  const { lines, start, end, blocks, bulletedAgent } = readTurn(output);
  let status: { at: number; text: string } | undefined;
  for (let at = end - 1; at >= start && !status; at -= 1) {
    const text = lines[at]!.text;
    // Drawn at the margin: an indented line is a tool's output, not the agent's status.
    if (!/^\s?\S/.test(text)) continue;
    const found = statusText(text);
    if (found) status = { at, text: found };
  }
  for (let at = blocks.length - 1; at >= 0; at -= 1) {
    const block = blocks[at]!;
    if (block.noise) continue;
    if (isTool(block.head, block.body)) {
      if (toolRunning(block)) return toolText(block) ?? status?.text;
      if (status && status.at > block.at) return status.text;
      return toolText(block);
    }
    const prose = blockProse(block, bulletedAgent);
    if (!prose) continue;
    if (status && status.at > block.at) return status.text;
    return prose;
  }
  return status?.text;
}
