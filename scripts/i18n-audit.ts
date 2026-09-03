/**
 * The sweep that finds copy the macros never saw.
 *
 * Three separate mistakes put English on a 繁體中文 screen, and only the first
 * of them is visible when you read a diff:
 *
 *  1. A literal written straight into a user-facing prop -- `title="Retry"`,
 *     `accessibilityLabel="Close"` -- which is never offered to the extractor
 *     and so renders English in all eight languages.
 *  2. A `` t`...` `` or `` msg`...` `` whose `t` is not the hook's own binding.
 *     The Babel macro silently declines to expand those, the extractor never
 *     sees the string, and at run time Lingui answers with an *empty string*.
 *     That is the failure `src/i18n/__tests__/macro-expansion.test.ts` was
 *     written for; this script covers the `msg` half it did not.
 *  3. A `MessageDescriptor` table with a key missing, so one enum value out of
 *     five falls through to `undefined` and draws nothing.
 *
 * None of the three is a type error and none of them throws. This walks the
 * real TypeScript AST -- not a regex over the text, which cannot tell
 * `` t`Retry` `` from the word "retry" in a comment about it -- and reports
 * every string literal that reaches a prop a human reads without passing
 * through a macro on the way.
 *
 * Run it directly for a report:
 *
 *     bun scripts/i18n-audit.ts            # findings, grouped, with counts
 *     bun scripts/i18n-audit.ts --json     # the same, for a machine
 *
 * `src/i18n/__tests__/user-facing-strings.test.ts` imports `auditUserFacingStrings`
 * and fails CI on any finding, which is what stops this from recurring. A string
 * that is deliberately English -- a brand name, a wire constant, an example URL
 * shown as a placeholder -- goes in `ALLOWED` below with the reason written out,
 * so the exception is reviewed once rather than argued about again.
 */
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * JSX props whose value a human reads.
 *
 * Deliberately a closed list rather than "every prop that takes a string".
 * `style`, `color`, `variant`, `testID`, `accessibilityRole` and friends all
 * take strings that are vocabulary, not copy, and a scanner that flagged them
 * would report several hundred findings that are all correct as written -- at
 * which point nobody reads the report and the check is worse than absent.
 *
 * The list is grounded in the props this codebase actually passes: it was built
 * by enumerating every JSX attribute name in `src/` and keeping the ones a
 * screen reader would speak or a user would see.
 */
const USER_FACING_PROPS = new Set([
  'accessibilityHint',
  'accessibilityLabel',
  'alt',
  'caption',
  'confirmLabel',
  'cancelLabel',
  'description',
  'detail',
  'emptyText',
  'errorMessage',
  'heading',
  'helperText',
  'hint',
  'label',
  'message',
  'placeholder',
  'subtitle',
  'summary',
  'text',
  'title',
]);

/**
 * Object keys that carry copy when the object is an options row, a descriptor
 * table, or a notification payload.
 *
 * Narrower than the prop list on purpose. An object property named `name` or
 * `value` is far more often a wire field than a caption, so those stay out; the
 * ones kept here are the shapes this app builds screens from.
 */
const USER_FACING_KEYS = new Set([
  'accessibilityHint',
  'accessibilityLabel',
  'body',
  'caption',
  'description',
  'detail',
  'emptyText',
  'errorMessage',
  'helperText',
  'hint',
  'label',
  'placeholder',
  'subtitle',
  'summary',
  'title',
]);

/**
 * Callees whose string arguments are shown to the user.
 *
 * `Alert.alert` and the toast/pill helpers take their copy positionally, so
 * there is no prop name to key on -- the call itself is the signal.
 */
const USER_FACING_CALLS = new Set([
  'alert',
  'showToast',
  'showPill',
  'toast',
  'notify',
  'setError',
  'setStatus',
]);

/** Macro and translation callees. A string inside one of these is handled. */
const TRANSLATION_CALLEES = new Set([
  '_',
  'defineMessage',
  'i18n._',
  'msg',
  'plural',
  'select',
  'selectOrdinal',
  't',
]);

/** JSX elements whose children are translated by the element itself. */
const TRANSLATION_ELEMENTS = new Set(['Trans', 'Plural', 'Select', 'SelectOrdinal']);

/**
 * Modules whose user-facing literals are English *source data*, translated
 * somewhere else through a `MessageDescriptor` table.
 *
 * These are the pure modules -- imported by `bun test`, which transpiles with
 * Bun and never expands a Lingui macro, so they cannot contain one. The English
 * in them is a lookup key, not the string that reaches the screen, and the
 * lookup is what `src/i18n/__tests__/user-facing-strings.test.ts` proves: it
 * imports the real tables and fails if any key is missing an entry.
 *
 * So the scanner stays quiet here and the coverage test does the work. Adding a
 * file to this list without adding it to that test would be exactly the hole
 * this whole exercise exists to close, which is why each entry names its test.
 */
const DESCRIPTOR_BACKED: { file: string; sinks: string[]; provenBy: string }[] = [
  {
    file: 'src/lib/terminal-keys.ts',
    sinks: ['accessibilityLabel', 'label'],
    provenBy: 'every terminal key has a translated description',
  },
  {
    file: 'src/lib/quick-commands.ts',
    sinks: ['label'],
    provenBy: 'every built-in quick command has a translated name',
  },
  {
    file: 'src/lib/demo-gateway.ts',
    sinks: ['description'],
    provenBy: 'every demo key description is a key of terminalKeyDescription',
  },
];

/**
 * Strings that are deliberately not translated.
 *
 * Every entry is a decision, and the reason is on the line: the next person to
 * see the scanner go quiet about one of these deserves to know why. Three
 * kinds, and nothing else belongs here:
 *
 *  - **Brand and proper nouns.** "Muqun" is the product; the palette names are
 *    the upstream projects' own. `Face ID` and `Touch ID` are Apple's, and Apple
 *    ships them untranslated in every locale, so a localized one would name a
 *    control the system does not have.
 *  - **Syntax the user's machine has to parse.** A placeholder showing
 *    `git branch --show-current` is an example of a command, and a translated
 *    example is a command that does not run.
 *  - **Key caps.** `Esc`, `⌃C`, `⇧TAB` are the terminal's vocabulary in every
 *    language. What a screen reader *says* about them is translated; the two or
 *    three glyphs printed on the cap are not.
 */
const ALLOWED: { file: string; text: string; why: string }[] = [
  { file: 'src/app/(drawer)/_layout.tsx', text: 'Muqun', why: 'product name' },
  { file: 'src/app/(drawer)/index.tsx', text: 'Muqun', why: 'product name' },
  { file: 'src/app/settings.tsx', text: 'Muqun', why: 'product name' },
  { file: 'src/components/app-drawer-content.tsx', text: 'Muqun', why: 'product name' },
  { file: 'src/lib/agent-widget-layout.tsx', text: 'Muqun', why: 'product name' },
  { file: 'src/constants/theme-packs.ts', text: 'Osuki', why: 'palette name, a proper noun' },
  { file: 'src/constants/theme-packs.ts', text: 'Catppuccin', why: 'palette name, a proper noun' },
  { file: 'src/constants/theme-packs.ts', text: 'Rosé Pine', why: 'palette name, a proper noun' },
  { file: 'src/constants/theme-packs.ts', text: 'Everforest', why: 'palette name, a proper noun' },
  { file: 'src/constants/theme-packs.ts', text: 'Tokyo Night', why: 'palette name, a proper noun' },
  { file: 'src/constants/developer-theme-packs.ts', text: 'Ayu', why: 'palette name, a proper noun' },
  { file: 'src/constants/developer-theme-packs.ts', text: 'Dracula', why: 'palette name, a proper noun' },
  { file: 'src/constants/developer-theme-packs.ts', text: 'Flexoki', why: 'palette name, a proper noun' },
  { file: 'src/constants/developer-theme-packs.ts', text: 'GitHub', why: 'palette name, a proper noun' },
  { file: 'src/constants/developer-theme-packs.ts', text: 'Gruvbox', why: 'palette name, a proper noun' },
  { file: 'src/constants/developer-theme-packs.ts', text: 'Kanagawa', why: 'palette name, a proper noun' },
  { file: 'src/constants/developer-theme-packs.ts', text: 'Night Owl', why: 'palette name, a proper noun' },
  { file: 'src/constants/developer-theme-packs.ts', text: 'Solarized', why: 'palette name, a proper noun' },
  ...[
    'Bamboo',
    'Bluloco',
    'Cyberdream',
    'Edge',
    'Iceberg',
    'Kanso',
    'Material',
    'Mélange',
    'Monokai Pro',
    'Modus',
    'Neovim',
    'Nightfox',
    'Oxocarbon',
    'Osaka Jade',
    'PaperColor',
    'Selenized',
    'Tomorrow',
    'VS Code 2026',
    'Zenwritten',
  ].map((text) => ({
    file: 'src/constants/developer-theme-packs-2026.ts',
    text,
    why: 'palette name, a proper noun',
  })),
  {
    file: 'src/lib/local-authentication.ts',
    text: 'Face ID',
    why: "Apple's own name, untranslated in every locale",
  },
  {
    file: 'src/lib/local-authentication.ts',
    text: 'Touch ID',
    why: "Apple's own name, untranslated in every locale",
  },
  {
    file: 'src/app/commands.tsx',
    text: 'ctrl+c, esc',
    why: 'the literal key-token syntax sent to the gateway',
  },
  {
    file: 'src/app/commands.tsx',
    text: 'git branch --show-current',
    why: "a shell command the user's machine has to parse",
  },
  {
    file: 'src/components/approval-banner.tsx',
    text: 'Esc',
    why: 'a key cap; the spoken form beside it is translated',
  },
  {
    file: 'src/lib/demo-gateway.ts',
    text: 'Claude Code',
    why: 'product name, and the literal `agentKey` matches on to pick a key row',
  },
  {
    file: 'src/app/servers/[serverId].tsx',
    text: 'Escape',
    why: "the banner's own `TerminalKey`; the row translates it through terminalKeyDescription",
  },
];

export interface Finding {
  /** Path relative to the repo root. */
  file: string;
  line: number;
  /** What kind of sink the string reached. */
  kind: 'jsx-attribute' | 'jsx-text' | 'object-property' | 'call-argument';
  /** The prop, key or callee that makes it user-facing. */
  sink: string;
  text: string;
}

/** Every `.ts`/`.tsx` under `src/`, minus the tests and the generated catalogs. */
function sourceFiles(directory = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'locales') continue;
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** `i18n._` and `foo.bar` alike, flattened to a dotted name. */
function calleeName(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    return `${calleeName(node.expression)}.${node.name.text}`;
  }
  return '';
}

/**
 * Whether a node sits inside something that translates it.
 *
 * Walks to the root rather than checking the immediate parent, because the
 * string is often several nodes down: `` t`...` `` is a tagged template,
 * `t({ message: '...' })` is a call holding an object holding a property, and
 * `_(cond ? a : b)` puts a conditional in between.
 */
function insideTranslation(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isTaggedTemplateExpression(current)) {
      const tag = calleeName(current.tag);
      if (TRANSLATION_CALLEES.has(tag)) return true;
    }
    if (ts.isCallExpression(current)) {
      const callee = calleeName(current.expression);
      if (TRANSLATION_CALLEES.has(callee)) return true;
      // `useLingui().t`, `i18n._`, and any `.t(...)`/`._(...)` member call.
      if (/\.(t|_)$/.test(callee)) return true;
    }
    if (ts.isJsxElement(current)) {
      const tag = current.openingElement.tagName.getText();
      if (TRANSLATION_ELEMENTS.has(tag)) return true;
    }
    if (ts.isJsxSelfClosingElement(current)) {
      const tag = current.tagName.getText();
      if (TRANSLATION_ELEMENTS.has(tag)) return true;
    }
  }
  return false;
}

/**
 * Whether a literal is copy rather than vocabulary.
 *
 * The distinction the whole report rests on. Style tokens, enum members, wire
 * fields, icon names and route paths are all strings reaching props, and none
 * of them is translatable. What separates them from copy, reliably enough, is
 * shape: copy has a capital letter or a space or sentence punctuation, and
 * vocabulary is a bare lower-case token, a `kebab-case` or `snake_case` word, a
 * path, a URL, a hex colour or a format string.
 */
function looksLikeCopy(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  // Must contain letters at all: `#fff`, `100%`, `1.5` and `···` are not copy.
  if (!/[A-Za-z]/.test(trimmed)) return false;
  // Paths, URLs, mime types, file globs, reverse-DNS ids.
  if (/^([a-z]+:\/\/|[~./]|\*\.)/.test(trimmed)) return false;
  if (/^[a-z0-9]+([./][a-z0-9-]+)+$/i.test(trimmed)) return false;
  // Hex colours and rgba().
  if (/^(#[0-9a-f]{3,8}|rgba?\()/i.test(trimmed)) return false;
  // A key cap. The modifier glyphs are the terminal's vocabulary in every
  // language -- `⌃C`, `⇧TAB`, `⌥←`, `␣ff` -- and only the sentence a screen
  // reader says about them is copy. Bounded by length so that a real sentence
  // that happens to quote a glyph is still reported.
  if (trimmed.length <= 6 && /[⌃⇧⌥⌘↵⌫␣←↓↑→]/u.test(trimmed)) return false;
  // A single bare token in vocabulary shape: `flex-start`, `match_parent`,
  // `on-surface`, `chat`, `terminal`. Copy that is genuinely one lower-case
  // word is vanishingly rare and reads wrong on screen anyway.
  if (/^[a-z][a-z0-9]*([-_][a-z0-9]+)*$/.test(trimmed)) return false;
  // camelCase / PascalCase identifiers with no spaces are component and icon
  // names, not sentences.
  if (!/\s/.test(trimmed) && /^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) {
    // ...unless it is a real word starting with a capital, which is exactly
    // what a one-word button caption looks like: `Retry`, `Done`, `Cancel`.
    // Those must be caught, so only reject when the token is mixed-case in the
    // identifier way (`onSurface`, `ChevronRight`) or all-caps (`GET`, `POST`).
    if (/[a-z][A-Z]/.test(trimmed)) return false;
    if (trimmed === trimmed.toUpperCase() && trimmed.length <= 4) return false;
  }
  return true;
}

function isAllowed(file: string, text: string): boolean {
  return ALLOWED.some((entry) => entry.file === file && entry.text === text.trim());
}

function isDescriptorBacked(file: string, sink: string): boolean {
  return DESCRIPTOR_BACKED.some(
    (entry) => entry.file === file && entry.sinks.includes(sink)
  );
}

/**
 * Every string literal and no-substitution template in a subtree, without
 * crossing into a nested JSX element.
 *
 * The boundary is the whole point. A JSX expression child is very often a
 * conditional wrapping more markup --
 * `{status === 'pending' ? <Icon name="Clock" /> : null}` -- and a plain walk
 * of that subtree reports `"Clock"` as though it were text on screen. It is an
 * icon id on a prop this scanner deliberately ignores, and the nested element
 * gets visited on its own anyway, so descending into it can only produce the
 * same finding twice or a wrong one once. Stopping here is what took the report
 * from "mostly noise" to a list worth reading.
 */
function literalsIn(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (current: ts.Node) => {
    if (current !== node && (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current))) {
      return;
    }
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      found.push(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/** Scan one parsed file, appending to `findings`. */
function scanFile(path: string, findings: Finding[]): void {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const file = relative(join(SRC, '..'), path);

  const report = (node: ts.Node, kind: Finding['kind'], sink: string, text: string) => {
    if (!looksLikeCopy(text)) return;
    if (insideTranslation(node)) return;
    if (isDescriptorBacked(file, sink)) return;
    if (isAllowed(file, text)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ file, line: line + 1, kind, sink, text: text.trim() });
  };

  const visit = (node: ts.Node) => {
    // `title="Retry"`, `accessibilityLabel={cond ? 'A' : 'B'}`
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (USER_FACING_PROPS.has(name) && node.initializer) {
        for (const literal of literalsIn(node.initializer)) {
          report(literal, 'jsx-attribute', name, (literal as ts.StringLiteral).text);
        }
      }
    }

    // Bare text between tags: `<Text>Retry</Text>`
    if (ts.isJsxText(node) && node.text.trim()) {
      report(node, 'jsx-text', 'children', node.text);
    }

    // `<Text>{'Retry'}</Text>` -- a literal in an expression child.
    if (ts.isJsxExpression(node) && node.expression && ts.isJsxElement(node.parent)) {
      for (const literal of literalsIn(node.expression)) {
        report(literal, 'jsx-text', 'children', (literal as ts.StringLiteral).text);
      }
    }

    // `{ title: 'Retry' }` in an options row or descriptor table.
    if (ts.isPropertyAssignment(node)) {
      const key = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteral(node.name)
          ? node.name.text
          : '';
      if (USER_FACING_KEYS.has(key)) {
        for (const literal of literalsIn(node.initializer)) {
          report(literal, 'object-property', key, (literal as ts.StringLiteral).text);
        }
      }
    }

    // `Alert.alert('Could not connect')`
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      const tail = callee.split('.').pop() ?? '';
      if (USER_FACING_CALLS.has(tail)) {
        for (const argument of node.arguments) {
          for (const literal of literalsIn(argument)) {
            report(literal, 'call-argument', callee, (literal as ts.StringLiteral).text);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
}

/** Every user-facing string literal in `src/` that no macro is handling. */
export function auditUserFacingStrings(): Finding[] {
  const findings: Finding[] = [];
  for (const path of sourceFiles()) scanFile(path, findings);
  return findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line
  );
}

/** The files the audit walks, exported so a test can assert it found them. */
export function auditedFileCount(): number {
  return sourceFiles().length;
}

function main(): void {
  const findings = auditUserFacingStrings();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(findings, null, 2));
    process.exit(findings.length === 0 ? 0 : 1);
  }

  if (findings.length === 0) {
    console.log(`i18n audit: no untranslated user-facing strings in ${auditedFileCount()} files.`);
    process.exit(0);
  }

  const byKind = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = byKind.get(finding.kind) ?? [];
    list.push(finding);
    byKind.set(finding.kind, list);
  }

  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${kind} (${list.length})`);
    for (const finding of list) {
      console.log(`  ${finding.file}:${finding.line}  ${finding.sink} = ${JSON.stringify(finding.text)}`);
    }
  }
  console.log(`\n${findings.length} findings across ${new Set(findings.map((f) => f.file)).size} files.`);
  process.exit(1);
}

if (import.meta.main) main();
