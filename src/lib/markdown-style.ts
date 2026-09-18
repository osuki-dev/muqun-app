/**
 * The app's one markdown theme, and the code palette inside it.
 *
 * It lived at the bottom of `agent-markdown-output.tsx` while that file drew the
 * reflowed reading of a pane. Card #841 removed that reading -- the quick
 * actions row was the only switch that reached it -- and this is what the file
 * was still worth: two pure functions over the theme's colours, read by the
 * chat transcript's blocks and by the asset viewer, neither of which is a
 * terminal. In `lib` rather than `components` because there is no component
 * here, and nothing in it touches React.
 */
import type { Colors } from '@osuki-dev/ui';
import { StyleSheet } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { AGENT_TYPE } from '@/constants/agent-type';

/**
 * The code palette, from the app's palette.
 *
 * `react-native-enriched-markdown` highlights a fenced code block natively, via
 * tree-sitter, and takes its colours as fourteen token types. The theme has six
 * things it can say about a colour -- `primary`, `success`, `warning`, `info`,
 * and two grades of muted text -- so several token types share one token. That
 * is the same six-way split the old JavaScript highlighter's roles used, for the
 * same reason: a finer palette would be a precision the theme cannot express,
 * and it would drift the moment a theme pack changed.
 *
 * `variable` and `embedded` are the ordinary code colour on purpose. tree-sitter
 * captures every identifier as a variable, so tinting it tints most of the file.
 */
function syntaxColors(colors: Colors): NonNullable<MarkdownStyle['codeBlock']>['syntaxColors'] {
  return {
    keyword: colors.primary,
    operator: colors.textMuted,
    punctuation: colors.textMuted,
    string: colors.success,
    number: colors.warning,
    constant: colors.warning,
    comment: colors.textSubtle,
    function: colors.info,
    type: colors.info,
    variable: colors.text,
    property: colors.info,
    tag: colors.primary,
    attribute: colors.info,
    embedded: colors.text,
  };
}

/**
 * The app's one markdown theme. Shared with the asset viewer so a document read
 * from a file looks the same as the transcript it was mentioned in.
 */
/**
 * The answer's markdown, at the size the surface's chrome is set in.
 *
 * Everything in the transcript that is neither the answer nor a terminal reads
 * through this: a thought, a notice, a skill's text, a permission's note, a
 * form's description, a checklist item. All of it is markdown for the same
 * reason the answer is -- a model numbers its plans and backticks its
 * identifiers wherever it is writing -- and all of it is set at the meta size
 * so it stays chrome beside the answer rather than a second answer.
 *
 * `ink` is the one thing that varies, and it comes from the palette at the call
 * site: muted for a note, the body colour for something that is content in its
 * own right, danger for a failure. Every block that carries its own colour goes
 * with it; code and quote fills stay the answer's, they are what make a
 * fragment legible. There is no thematic break: a rule drawn across a card is
 * the card's own edge again.
 */
export function createCompactMarkdownStyle(colors: Colors, ink: string): MarkdownStyle {
  const base = createMarkdownStyle(colors);
  const size = AGENT_TYPE.meta.size;
  const lineHeight = AGENT_TYPE.mono.lineHeight;
  const quiet = { color: ink, fontSize: size, lineHeight, marginBottom: 6 };
  return {
    ...base,
    paragraph: { ...base.paragraph, ...quiet },
    h1: { ...base.h1, ...quiet, fontSize: size + 1, lineHeight: lineHeight + 1 },
    h2: { ...base.h2, ...quiet },
    h3: { ...base.h3, ...quiet },
    h4: { ...base.h4, ...quiet },
    h5: { ...base.h5, ...quiet },
    h6: { ...base.h6, ...quiet },
    strong: { color: ink },
    em: { color: ink },
    strikethrough: { color: ink },
    list: { ...base.list, ...quiet },
    blockquote: { ...base.blockquote, ...quiet },
    code: { ...base.code, color: ink, fontSize: AGENT_TYPE.micro.size },
    codeBlock: {
      ...base.codeBlock,
      color: ink,
      fontSize: AGENT_TYPE.micro.size,
      lineHeight: AGENT_TYPE.micro.lineHeight,
      marginBottom: 8,
    },
    table: { ...base.table, ...quiet, headerTextColor: ink },
    thematicBreak: { color: 'transparent', height: 0, marginTop: 0, marginBottom: 0 },
  };
}

/**
 * The style a thought block reads its reasoning in: the compact style, muted.
 *
 * Named because a thought is the one of these the reader knows by name, and
 * because `agent-reasoning-block.tsx` asks for the thought's ink rather than
 * for a colour.
 */
export function createThoughtMarkdownStyle(colors: Colors): MarkdownStyle {
  return createCompactMarkdownStyle(colors, colors.textMuted);
}

export function createMarkdownStyle(colors: Colors): MarkdownStyle {
  const text = colors.text;
  const muted = colors.textMuted;
  const border = colors.border;
  const codeBackground = colors.surfaceRaised;
  const quoteBackground = colors.primarySubtle;
  const link = colors.info;
  const base = {
    color: text,
    fontSize: AGENT_TYPE.prose.size,
    lineHeight: AGENT_TYPE.prose.lineHeight,
    marginTop: 0,
    marginBottom: 10,
  };

  return {
    paragraph: base,
    // Headings step by one point from the prose size, never a display size:
    // a reply's "## Objective" is a paragraph heading, not a page title.
    h1: {
      ...base,
      fontSize: AGENT_TYPE.prose.size + 2,
      lineHeight: AGENT_TYPE.prose.lineHeight + 2,
      fontWeight: '700',
      marginTop: 12,
      marginBottom: 6,
    },
    h2: {
      ...base,
      fontSize: AGENT_TYPE.prose.size + 1,
      lineHeight: AGENT_TYPE.prose.lineHeight + 1,
      fontWeight: '700',
      marginTop: 10,
      marginBottom: 4,
    },
    h3: { ...base, fontWeight: '700', marginTop: 8, marginBottom: 4 },
    h4: { ...base, fontWeight: '600', marginTop: 6, marginBottom: 4 },
    h5: { ...base, fontWeight: '600', marginTop: 6, marginBottom: 4 },
    h6: { ...base, color: muted, fontWeight: '600', marginTop: 6, marginBottom: 4 },
    strong: { color: text },
    em: { color: text },
    link: { color: link, underline: false },
    list: {
      ...base,
      bulletColor: link,
      markerColor: muted,
      markerMinWidth: 20,
      gapWidth: 6,
      marginLeft: 2,
    },
    blockquote: {
      ...base,
      color: muted,
      borderColor: link,
      borderWidth: 3,
      gapWidth: 10,
      backgroundColor: quoteBackground,
    },
    // Inline code is the body ink in the monospace face and nothing more: no
    // chip, no border. Models backtick file names, numbers and half their
    // nouns, and a tinted box behind every one of them turned a paragraph
    // into confetti.
    code: {
      fontFamily: 'monospace',
      fontSize: AGENT_TYPE.mono.size,
      color: text,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    codeBlock: {
      color: text,
      fontFamily: 'monospace',
      fontSize: AGENT_TYPE.mono.size,
      lineHeight: AGENT_TYPE.mono.lineHeight,
      backgroundColor: codeBackground,
      borderColor: border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 14,
      padding: 12,
      marginTop: 4,
      marginBottom: 12,
      syntaxColors: syntaxColors(colors),
    },
    // A formula is the one other block the renderer paints a fill behind, and
    // without these two it paints its own: a light grey slab under the display
    // block and a light-page grey for the inline span, in both themes. It sits
    // on the code-block fill and is inked with the body colour for the same
    // reason a code block is. Size, padding and alignment stay the renderer's
    // defaults, which is what the light theme has always shown.
    math: {
      color: text,
      backgroundColor: codeBackground,
    },
    inlineMath: { color: text },
    thematicBreak: { color: border, height: StyleSheet.hairlineWidth, marginBottom: 12 },
    table: {
      ...base,
      borderColor: border,
      // A hairline disappears on the emulator and the cells read as one blob;
      // a full pixel keeps the grid visible at every density.
      borderWidth: 1,
      borderRadius: 10,
      headerBackgroundColor: codeBackground,
      headerTextColor: text,
      rowEvenBackgroundColor: codeBackground,
      rowOddBackgroundColor: colors.surface,
      cellPaddingHorizontal: 12,
      cellPaddingVertical: 8,
      // A wide table scrolls, and it scrolls to the edge of the screen rather
      // than inside the plate's 12pt padding: a phone-width column of a
      // four-column table is unreadable with a gutter on each side of it.
      horizontalOverflow: 12,
    },
    taskList: {
      checkedColor: link,
      borderColor: border,
      checkmarkColor: colors.onPrimary,
      checkedTextColor: muted,
    },
  };
}
