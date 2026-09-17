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
