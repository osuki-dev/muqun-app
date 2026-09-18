// Nothing the model or the engine wrote gets a plain `<Text>` again.
//
// The transcript now has one markdown pipeline -- `BoundedMarkdown` over the
// styles in `markdown-style.ts` -- and the reason it did not have one before is
// that every card grew its own reading of its own field, one `<Text>` at a
// time, each defensible on its own. This test is what stops that: it reads the
// agent surface's sources, finds every `<Text>` whose *content* is an
// expression ending in one of the accessors engine text arrives on, and fails
// unless that exact expression is listed below with a reason.
//
// Adding a row here is not a defeat -- a path, a command, a count and a
// one-line label are all correct as plain text. Adding one without a reason is.
//
// Sources rather than a render: these components pull in Reanimated, Expo and
// the native markdown view, none of which parse outside Metro, and what
// matters is not one rendered tree but that no file has quietly grown a new
// flat reading of the engine's prose.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components');

/**
 * Every plain `<Text>` in the agent surface that draws an expression off one
 * of these accessors, and why it is right that it does.
 *
 * Keyed `file → expression`, because a line number is a number that changes
 * every time someone above it adds a comment.
 */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'agent-message-block.tsx': {
    preview:
      'the two-line preview under a closed notice, with the markdown syntax taken off by plainFromMarkdown; opened, the note is BoundedMarkdown',
  },
  'agent-tool-card.tsx': {
    'capped.text': 'raw stdout/stderr, monospace so the output keeps its own alignment',
    command: 'the shell command as it was run, monospace and in the accent ink',
    'match.text': 'one matched line from grep, monospace and never re-wrapped',
    'option.label':
      'one answer a question offered, drawn inside the pill it labels, so it stays one line with its markdown syntax stripped',
    'option.description':
      "an option's own one-line gloss, clipped to one line beside the label it explains",
  },
  'agent-permission-card.tsx': {
    subject: 'the path or command the permission is about, monospace',
    res: 'one more resource path, monospace',
    'option.label': "the decision's own wording, from @/i18n/labels rather than from the wire",
  },
  'agent-form-card.tsx': {
    'field.title':
      'a field title labels a control and stays one line beside it; its block syntax comes off with plainFromMarkdown instead',
    'opt.label':
      'an option label lives inside the pressable it selects, so it stays one line, syntax stripped',
  },
  'agent-mode-menu.tsx': {
    'ag.description':
      "an agent's one-line summary in a menu row, clipped to one line beside its name",
  },
  'agent-composer.tsx': {
    'contextPill.label': "the composer's own pill wording, not the engine's",
  },
  'agent-context-sheet.tsx': {
    'tokens?.output': 'a token count, formatted as a number',
  },
  'agent-action-menu.tsx': {
    'item.label':
      "a menu action's own wording (Rename, Delete, Send now), from the app, never the engine",
  },
  'agent-workbench.tsx': {
    'screenNotice.title': "the app's own banner title",
    'statusNotice.label': "the app's own status wording",
  },
};

/** The accessors engine- and model-authored text arrives on. */
const ENGINE_ACCESSOR =
  /\b[\w$]+(?:\??\.[\w$]+)*\??\.(?:text|message|description|label|title|prompt|summary|output|content)\b/g;

/** Bare locals that hold the same thing, named rather than guessed at. */
const ENGINE_LOCAL = /\b(?:outputText|preview|command|errorLine|subject|calls|res)\b/g;

/**
 * Comments and template literals, out of the way.
 *
 * A doc comment in these files says `<Text>` when it is talking about one, and
 * a `t` macro's backticks hold English prose -- "detach a long command from its
 * tool card" is not a variable named `command`.
 */
function withoutProseRuns(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, '``');
}

/** The children of every non-self-closing `<Text>` element in a source file. */
function textChildren(raw: string): string[] {
  const source = withoutProseRuns(raw);
  const out: string[] = [];
  const open = /<Text[\s>]/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(source)) !== null) {
    let cursor = match.index + 5;
    let depth = 0;
    let selfClosing = false;
    for (; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) {
        selfClosing = source[cursor - 1] === '/';
        break;
      }
    }
    if (selfClosing) continue;
    let end = cursor + 1;
    let nested = 0;
    while (end < source.length) {
      if (source.startsWith('</Text>', end)) {
        if (nested === 0) break;
        nested -= 1;
        end += 7;
        continue;
      }
      if (/^<Text[\s>]/.test(source.slice(end, end + 6))) {
        nested += 1;
        end += 5;
        continue;
      }
      end += 1;
    }
    out.push(source.slice(cursor + 1, end));
  }
  return out;
}

/** The `{…}` expressions inside a run of JSX children. */
function expressions(children: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < children.length; i += 1) {
    if (children[i] !== '{') continue;
    let depth = 0;
    let j = i;
    for (; j < children.length; j += 1) {
      if (children[j] === '{') depth += 1;
      else if (children[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(children.slice(i + 1, j));
    i = j;
  }
  return out;
}

function engineTextIn(source: string): string[] {
  const found = new Set<string>();
  for (const expression of textChildren(source).flatMap(expressions)) {
    for (const pattern of [ENGINE_ACCESSOR, ENGINE_LOCAL]) {
      pattern.lastIndex = 0;
      let hit: RegExpExecArray | null;
      while ((hit = pattern.exec(expression)) !== null) found.add(hit[0]);
    }
  }
  return [...found].sort();
}

const FILES = readdirSync(COMPONENTS)
  .filter(
    (name) =>
      name.endsWith('.tsx') &&
      (name.startsWith('agent-') ||
        name === 'embedded-terminal-tool-block.tsx' ||
        name === 'engine-failure-text.tsx')
  )
  .sort();

describe('the agent surface draws engine prose through one markdown pipeline', () => {
  test('there is something to read', () => {
    // A scanner that matches nothing passes everything.
    expect(FILES.length).toBeGreaterThan(10);
    expect(
      engineTextIn(readFileSync(join(COMPONENTS, 'agent-tool-card.tsx'), 'utf8')).length
    ).toBeGreaterThan(0);
  });

  for (const file of FILES) {
    test(`${file}: every plain <Text> of engine text is one that should be`, () => {
      const source = readFileSync(join(COMPONENTS, file), 'utf8');
      const allowed = ALLOWED[file] ?? {};
      const unexplained = engineTextIn(source).filter((expression) => !(expression in allowed));
      // A new one means either the text belongs in `BoundedMarkdown` with a
      // style from `markdown-style.ts`, or it is a label, a path or a payload
      // and belongs in `ALLOWED` above with the sentence that says which.
      expect(unexplained).toEqual([]);
    });

    test(`${file}: nothing is allow-listed that is no longer there`, () => {
      const source = readFileSync(join(COMPONENTS, file), 'utf8');
      const drawn = new Set(engineTextIn(source));
      const stale = Object.keys(ALLOWED[file] ?? {}).filter((expression) => !drawn.has(expression));
      expect(stale).toEqual([]);
    });
  }

  test('every allow-listed file is one the scan actually reads', () => {
    expect(Object.keys(ALLOWED).filter((file) => !FILES.includes(file))).toEqual([]);
  });

  test('every reason is a sentence, not a shrug', () => {
    const terse: string[] = [];
    for (const [file, entries] of Object.entries(ALLOWED)) {
      for (const [expression, reason] of Object.entries(entries)) {
        if (reason.trim().length < 24) terse.push(`${file}: ${expression}`);
      }
    }
    expect(terse).toEqual([]);
  });
});
