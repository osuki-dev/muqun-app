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
    fontSize: 14,
    lineHeight: 21,
    marginTop: 0,
    marginBottom: 10,
  };

  return {
    paragraph: base,
    h1: { ...base, fontSize: 22, lineHeight: 28, fontWeight: '700', marginTop: 8 },
    h2: { ...base, fontSize: 19, lineHeight: 25, fontWeight: '700', marginTop: 8 },
    h3: { ...base, fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: 6 },
    h4: { ...base, fontWeight: '700', marginTop: 4 },
    h5: { ...base, fontWeight: '700', marginTop: 4 },
    h6: { ...base, color: muted, fontWeight: '700', marginTop: 4 },
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
    code: {
      fontFamily: 'monospace',
      fontSize: 13,
      color: link,
      backgroundColor: codeBackground,
      borderColor: border,
    },
    codeBlock: {
      color: text,
      fontFamily: 'monospace',
      fontSize: 12.5,
      lineHeight: 18,
      backgroundColor: codeBackground,
      borderColor: border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      padding: 12,
      marginTop: 2,
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
    },
    taskList: {
      checkedColor: link,
      borderColor: border,
      checkmarkColor: colors.onPrimary,
      checkedTextColor: muted,
    },
  };
}
