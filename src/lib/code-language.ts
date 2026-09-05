/**
 * A file, as one fenced code block.
 *
 * The asset viewer has one renderer -- `EnrichedMarkdownText` -- and this is
 * how a source file reaches it. Nothing here highlights anything: the fence's
 * info string names a language and the package's tree-sitter highlighter does
 * the colouring natively, off the JS thread. This file only has to name the
 * language the way the package spells it, and to build a fence the file cannot
 * escape from.
 */

/**
 * Extension to fence info string.
 *
 * The names are the package's, not ours: `cpp/highlight/CodeBlockLanguages.cpp`
 * holds the table that maps a fence word to a grammar and to the display name
 * the block's header shows, and a word that is not in it is neither. So `ts`
 * and `typescript` both work, `rs` is Rust, and a word we invented would be
 * capitalised and shown uncoloured.
 *
 * Two tiers, deliberately mixed:
 *
 *   * words with a grammar compiled into this app -- typescript, tsx,
 *     javascript, python, rust, go, java, c, json, yaml, bash, markdown, html,
 *     css -- which are highlighted.
 *   * words the package knows the name of but has no grammar for -- toml, xml,
 *     sql, dockerfile, and `diff`, which is not in its table at all and comes
 *     back title-cased. These render as plain code under a header that still
 *     says what the file is, which is strictly more than a bare fence gives.
 *
 * Nothing distinguishes the two here on purpose. The grammar set is a build
 * option (`codeHighlightLanguages` in `package.json`); if it changes, this map
 * should not have to.
 */
const FENCE_LANGUAGES: Record<string, string> = {
  bash: 'bash',
  sh: 'bash',
  zsh: 'bash',
  fish: 'bash',
  c: 'c',
  h: 'c',
  css: 'css',
  diff: 'diff',
  patch: 'diff',
  rej: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  htm: 'html',
  html: 'html',
  java: 'java',
  cjs: 'javascript',
  js: 'javascript',
  mjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  sql: 'sql',
  toml: 'toml',
  cts: 'typescript',
  mts: 'typescript',
  ts: 'typescript',
  tsx: 'tsx',
  plist: 'xml',
  svg: 'xml',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

/** Names with no extension that still say what they are. */
const FENCE_FILENAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'bash',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.gitconfig': 'toml',
};

/**
 * The fence word for a file, or null when we have nothing to say about it.
 *
 * Null is a real answer and not a failure: an unnamed fence renders as plain
 * monospaced code, which is what a `.log` or a `.txt` should look like.
 */
export function fenceLanguageForFile(name: string): string | null {
  const lower = name.toLowerCase();
  const byName = FENCE_FILENAMES[lower];
  if (byName) return byName;
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return FENCE_LANGUAGES[lower.slice(dot + 1)] ?? null;
}

/** CommonMark's shortest fence. Anything longer is also a fence. */
const MIN_FENCE = 3;

/**
 * The file, wrapped in a fence it cannot break out of.
 *
 * A file that contains ```` ``` ```` -- every README in every repository an
 * agent touches -- would close a three-backtick fence early and render its own
 * second half as markdown. CommonMark lets an opening fence be any run of three
 * or more backticks and only a run *at least as long* closes it, so the fence
 * is one longer than the longest run anywhere in the file. There is no escaping
 * to do beyond that: fenced content is literal.
 */
export function fencedFile(text: string, language: string | null): string {
  const fence = '`'.repeat(Math.max(MIN_FENCE, longestBacktickRun(text) + 1));
  // A file that does not end in a newline would otherwise put the closing fence
  // on the last line of code, where it is not a fence at all.
  const body = text.endsWith('\n') ? text : `${text}\n`;
  return `${fence}${language ?? ''}\n${body}${fence}`;
}

/** The longest run of consecutive backticks in the text. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  let run = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '`') {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}
