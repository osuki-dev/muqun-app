import type { ToolCallLanguage } from './tool-call-detail';

/**
 * One line of code, cut into coloured runs.
 *
 * The app's real highlighter is tree-sitter inside the native fenced block of
 * `react-native-enriched-markdown`, and it only ever sees a whole document: it
 * cannot be asked for the tokens of line 412, and a fence is its own scroller
 * with its own height, so it cannot sit in a fixed-height row beside a pinned
 * line number (`text-preview.ts` has the measurements and the argument). The
 * tool sheet needs exactly that row, so it colours a line at a time here, in
 * the highlighter's own palette (`markdownStyle.codeBlock.syntaxColors`) so the
 * two never disagree about what a string looks like.
 *
 * Deliberately small: one line, no state carried between lines, three
 * grammars -- JSON, shell, and a C-family/Python "code" that covers what Code
 * Mode and the agents actually write. A block comment or a string that spans
 * lines is coloured on its first line only, which is the honest cost of a
 * per-line lexer and still far better than no colour at all.
 */

/** The `syntaxColors` keys a run can take; `plain` is the line's own colour. */
export type CodeTokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'constant'
  | 'comment'
  | 'function'
  | 'property'
  | 'punctuation'
  | 'variable'
  | 'attribute';

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

const CODE_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'def',
  'default',
  'del',
  'do',
  'elif',
  'else',
  'export',
  'extends',
  'finally',
  'fn',
  'for',
  'from',
  'func',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'interface',
  'lambda',
  'let',
  'match',
  'new',
  'not',
  'of',
  'or',
  'and',
  'pass',
  'pub',
  'raise',
  'return',
  'static',
  'struct',
  'switch',
  'throw',
  'try',
  'type',
  'typeof',
  'use',
  'var',
  'while',
  'with',
  'yield',
]);

const CODE_CONSTANTS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'None',
  'True',
  'False',
  'nil',
  'this',
  'self',
]);

const SHELL_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  'function',
  'return',
  'export',
  'local',
  'set',
  'unset',
  'source',
  'exit',
]);

const PUNCTUATION = /[{}[\]();,.:=<>+\-*/%!&|^~?@]/;
const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/** Appends a run, merging it into the last one when the kind is the same. */
function push(out: CodeToken[], text: string, kind: CodeTokenKind) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ text, kind });
}

/** The end of a quoted string starting at `start`, or the end of the line. */
function stringEnd(line: string, start: number): number {
  const quote = line[start];
  let index = start + 1;
  while (index < line.length) {
    const char = line[index];
    if (char === '\\' && quote !== "'") {
      index += 2;
      continue;
    }
    if (char === '\\' && quote === "'" && line[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return line.length;
}

function numberEnd(line: string, start: number): number {
  let index = start;
  if (line[index] === '-') index += 1;
  while (index < line.length && /[0-9a-fA-FxX._eE+-]/.test(line[index])) {
    // A sign is part of a number only straight after an exponent.
    if ((line[index] === '+' || line[index] === '-') && !/[eE]/.test(line[index - 1] ?? '')) break;
    index += 1;
  }
  return index;
}

function identEnd(line: string, start: number): number {
  let index = start + 1;
  while (index < line.length && IDENT.test(line[index])) index += 1;
  return index;
}

function nextNonSpace(line: string, from: number): string {
  let index = from;
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) index += 1;
  return line[index] ?? '';
}

function tokenizeJson(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === '"') {
      const end = stringEnd(line, index);
      // A key is a string followed by a colon.
      push(out, line.slice(index, end), nextNonSpace(line, end) === ':' ? 'property' : 'string');
      index = end;
    } else if (DIGIT.test(char) || (char === '-' && DIGIT.test(line[index + 1] ?? ''))) {
      const end = numberEnd(line, index);
      push(out, line.slice(index, end), 'number');
      index = end;
    } else if (IDENT_START.test(char)) {
      const end = identEnd(line, index);
      const word = line.slice(index, end);
      push(out, word, CODE_CONSTANTS.has(word) ? 'constant' : 'plain');
      index = end;
    } else if (PUNCTUATION.test(char)) {
      push(out, char, 'punctuation');
      index += 1;
    } else {
      push(out, char, 'plain');
      index += 1;
    }
  }
  return out;
}

function tokenizeShell(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  let index = 0;
  // The first word of a command -- at the start, or after `|`, `;`, `&&` --
  // is the program, coloured as a function call is.
  let commandNext = true;
  while (index < line.length) {
    const char = line[index];
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
      push(out, line.slice(index), 'comment');
      break;
    }
    if (char === '"' || char === "'") {
      const end = stringEnd(line, index);
      push(out, line.slice(index, end), 'string');
      index = end;
      commandNext = false;
      continue;
    }
    if (char === '$') {
      let end = index + 1;
      if (line[end] === '{') {
        const close = line.indexOf('}', end);
        end = close < 0 ? line.length : close + 1;
      } else {
        while (end < line.length && /[A-Za-z0-9_?@#*!$-]/.test(line[end])) {
          end += 1;
          if (!/[A-Za-z0-9_]/.test(line[end - 1])) break;
        }
      }
      push(out, line.slice(index, end), 'variable');
      index = end;
      commandNext = false;
      continue;
    }
    if (char === '|' || char === ';' || char === '&' || char === '(' || char === ')') {
      push(out, char, 'punctuation');
      index += 1;
      commandNext = true;
      continue;
    }
    if (/\s/.test(char)) {
      push(out, char, 'plain');
      index += 1;
      continue;
    }
    let end = index;
    while (end < line.length && !/[\s|;&()"'$]/.test(line[end])) end += 1;
    const word = line.slice(index, end);
    if (SHELL_KEYWORDS.has(word)) {
      push(out, word, 'keyword');
      commandNext = true;
    } else if (commandNext && !word.includes('=')) {
      push(out, word, 'function');
      commandNext = false;
    } else if (word.startsWith('-')) {
      push(out, word, 'attribute');
    } else if (/^-?\d+(\.\d+)?$/.test(word)) {
      push(out, word, 'number');
    } else {
      push(out, word, 'plain');
    }
    index = end;
  }
  return out;
}

function tokenizeCode(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  let index = 0;
  let afterDot = false;
  while (index < line.length) {
    const char = line[index];
    const next = line[index + 1] ?? '';
    if ((char === '/' && next === '/') || (char === '#' && (index === 0 || next === ' '))) {
      push(out, line.slice(index), 'comment');
      break;
    }
    if (char === '/' && next === '*') {
      const close = line.indexOf('*/', index + 2);
      const end = close < 0 ? line.length : close + 2;
      push(out, line.slice(index, end), 'comment');
      index = end;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const end = stringEnd(line, index);
      push(out, line.slice(index, end), 'string');
      index = end;
      afterDot = false;
      continue;
    }
    if (DIGIT.test(char)) {
      const end = numberEnd(line, index);
      push(out, line.slice(index, end), 'number');
      index = end;
      continue;
    }
    if (IDENT_START.test(char)) {
      const end = identEnd(line, index);
      const word = line.slice(index, end);
      const called = nextNonSpace(line, end) === '(';
      const kind: CodeTokenKind = CODE_KEYWORDS.has(word)
        ? 'keyword'
        : CODE_CONSTANTS.has(word)
          ? 'constant'
          : called
            ? 'function'
            : afterDot
              ? 'property'
              : // An object literal's key: `{query: 'x'}`.
                nextNonSpace(line, end) === ':' && !afterDot
                ? 'property'
                : 'plain';
      push(out, word, kind);
      index = end;
      afterDot = false;
      continue;
    }
    if (PUNCTUATION.test(char)) {
      push(out, char, 'punctuation');
      afterDot = char === '.';
      index += 1;
      continue;
    }
    push(out, char, 'plain');
    index += 1;
  }
  return out;
}

/** `line` as coloured runs. `plain` text is one run of its own colour. */
export function tokenizeLine(line: string, language: ToolCallLanguage): CodeToken[] {
  if (!line) return [];
  switch (language) {
    case 'json':
      return tokenizeJson(line);
    case 'shell':
      return tokenizeShell(line);
    case 'code':
      return tokenizeCode(line);
    default:
      return [{ text: line, kind: 'plain' }];
  }
}
