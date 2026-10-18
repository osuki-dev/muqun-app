/**
 * The app's `Text`: the design system's, plus the one thing a reader's own
 * font file makes it need.
 *
 * Reader-facing strings use this wrapper around `@osuki-dev/ui` to apply the
 * selected interface font.
 *
 * ## The bug
 *
 * Android lays a line out as the sum of its glyph *advances*, and an italic or
 * oblique face draws its final letter past that sum. `TextView.onDraw` then
 * clips the canvas to its own content box -- `clipRight = width -
 * compoundPaddingRight`, which after Yoga has added the padding back is exactly
 * the advance width -- so the overhang has nowhere to go and the last glyph is
 * shaved. A reader on a wide italic face saw the settings heading read
 * APPEARANC, the server row say 未連, and the timestamp on their own message
 * lose the corner of 前.
 *
 * ## What does not fix it
 *
 * Measured on the device, on the reader's own face, at 11pt and at 20pt:
 *
 *  - **Padding.** `paddingRight` grows the view and the clip rectangle by the
 *    same amount, because the clip is computed from the padding. A box with
 *    `paddingRight: 24` and a box with none clip their ink at the identical x.
 *    This is worth stating plainly because it is the obvious fix and this file
 *    used to believe in it.
 *  - **`letterSpacing`.** Android spends the whole of the tracking *before*
 *    each glyph, so the trailing edge gains nothing: at 2, 10 and 20 points of
 *    tracking the ink still ran to the last pixel of the box.
 *  - **`textShadowRadius`.** `TextView` *does* widen its clip by its own shadow
 *    radius -- but React Native does not set one. It draws text shadows with a
 *    `ShadowStyleSpan` on the paint (`TextLayoutManager.kt:333`), so
 *    `TextView.mShadowRadius` stays 0 and the clip never moves.
 *  - **`overflow: 'visible'`.** That prop only governs React Native's *extra*
 *    clip (`ReactTextView.java:210`); `TextView`'s own clip in `super.onDraw`
 *    is unconditional.
 *
 * ## What does fix it
 *
 * Making the *line* wider than the glyphs, which on Android means putting
 * something in the line. A trailing thin space is that something: the layout
 * width grows by its advance, the clip rectangle grows with it, and the
 * overhang lands inside. Trailing whitespace is not trimmed on the last line of
 * a layout (`Layout.getLineVisibleEnd` returns early for it), so it counts
 * towards the width that Yoga is given -- which is the whole trick.
 *
 * Measured: at 11pt the ink recovered 3px with 3px to spare, at 13pt 4px with
 * 4px to spare, for 6 and 8 points of extra box. Where a box already had room
 * -- a constrained row, a centred segment -- the space changed nothing at all,
 * because the ink was never against the edge.
 *
 * ## Why only for a reader's file
 *
 * The system UI face on both platforms is upright and overhangs nothing, so
 * under the default font this component is the kit's `Text` and no string in
 * the app changes by a single character. The app cannot ask a registered
 * `Typeface` whether it leans -- React Native exposes advances and never ink
 * bounds -- so the rule is the honest one it *can* apply: a face the reader
 * supplied gets the room, whether or not it turns out to need it. A thin space
 * on an upright face is a fifth of an em of trailing air on a shrink-wrapped
 * label, which reads as the pill's own padding.
 */
import { Text as KitText, useThemeTokens, type TextProps } from '@osuki-dev/ui';
import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, type TextStyle } from 'react-native';

import { useAppSettings } from '@/stores/app-settings';
import {
  numericFontWeight,
  registryWeightAxis,
  variableWeightStyle,
} from '@/theme/interface-font-registry';

export type { TextProps };

/**
 * The character the slack is made of: U+2009 THIN SPACE.
 *
 * A fifth of an em in most faces and half of one in a monospaced grid, which in
 * both cases clears an ordinary oblique's overhang several times over while
 * staying small enough to read as air rather than as a gap. A plain space was
 * measured too: it works and is five times wider than it needs to be, which on
 * a hugging chip is a visible hole. A no-break space is narrower than a space
 * in some faces and wider in others -- an em fraction is the one that is
 * defined rather than drawn.
 *
 * It must be a space rather than a zero-width character: the point is the
 * advance, and U+200B has none.
 */
export const HUG_SLACK = '\u2009';

/**
 * The slack in force for the subtree, and the mechanism that stops it nesting.
 *
 * `''` is "no reader font, add nothing", and it is also what a `Text` publishes
 * to its own children. Nested text is one line, so a slack character inside it
 * would not be trailing at all -- it would be a gap in the middle of the
 * sentence, between two runs. Only the outermost `Text` in a nest adds one, and
 * it adds it after everything.
 *
 * A context rather than a store read because this is answered once per app
 * launch for hundreds of labels; the provider is mounted in `app/_layout.tsx`.
 * The default is `''`, so a component rendered in a test, or anywhere the
 * provider is not, is the kit's `Text` exactly.
 */
const HugSlackContext = createContext<string>('');

/** Publishes the reader's slack to every `Text` below. See `HugSlackContext`. */
export function HugSlackProvider({ children }: { children: ReactNode }) {
  const interfaceKind = useAppSettings((state) => state.interfaceFont.kind);
  return (
    <HugSlackContext.Provider value={interfaceKind === 'file' ? HUG_SLACK : ''}>
      {children}
    </HugSlackContext.Provider>
  );
}

/**
 * Whether there is anything to put slack after.
 *
 * `<Text>{maybe}</Text>` with nothing in it is a zero-width box, and a great
 * many rows rely on that to disappear. Giving it a thin space would give it a
 * width, so an empty `Text` is left exactly as empty as it was.
 */
function hasContent(children: ReactNode): boolean {
  if (children === null || children === undefined || children === false || children === '') {
    return false;
  }
  if (Array.isArray(children)) return children.some(hasContent);
  return true;
}

/**
 * The design system's `Text`, with room on the trailing edge for a face that
 * leans past its own advance. See the file comment for why that is needed and
 * for the four things that do not provide it.
 */
export type AppTextProps = TextProps & {
  /**
   * `false` for a glyph set in a box of its own size: a count in a round badge,
   * a digit in a key cap. The slack is a character, and a character has width:
   * in a 14pt circle it turned the circle into an oval and pushed the digit off
   * its centre. Such a box is sized by the app, not by the text, so there is no
   * advance edge for the overhang to be clipped at.
   */
  hugSlack?: boolean;
};

/**
 * The caller's style with a variable reader face's weight set on its `wght`
 * axis, or `null` when the kit's own resolution stands.
 *
 * The kit resolves weight through a ladder that never reports 700 for a
 * reader's file (`interface-font-registry.ts`), which is right for a static
 * face and needlessly caps a variable one at semibold. Layered after the
 * caller's style, so it takes the weight the kit would have used -- the
 * style's `fontWeight`, else `weight`, else the variant's -- and restates it as
 * the axis. A style that names another family or sets its own axes is left
 * alone.
 */
function useVariableWeight(props: TextProps): TextStyle | null {
  const { fonts, typeStyles } = useThemeTokens();
  const typeStyle = typeStyles[props.variant ?? 'body'];
  const axis = typeStyle ? registryWeightAxis(fonts, typeStyle.fontFamily) : null;
  const family = typeStyle ? fonts[typeStyle.fontFamily]?.family : undefined;
  if (!axis || !family) return null;
  const flat = StyleSheet.flatten(props.style);
  if (flat?.fontVariationSettings !== undefined) return null;
  if (flat?.fontFamily && flat.fontFamily !== family) return null;
  const weight = numericFontWeight(flat?.fontWeight) ?? props.weight ?? typeStyle.fontWeight;
  return { ...flat, ...variableWeightStyle(family, axis, weight) };
}

export function Text({ children, hugSlack = true, ...rest }: AppTextProps) {
  const slack = useContext(HugSlackContext);
  const variableStyle = useVariableWeight(rest);
  const props = variableStyle ? { ...rest, style: variableStyle } : rest;
  /*
   * `selectable` is the one exemption, and it is not about layout. The reader
   * selects this text in order to copy it -- a server URL, a session id, a
   * path -- and a trailing thin space rides along into the clipboard and
   * breaks whatever it is pasted into. A selectable string is also, for that
   * reason, one the app has already given room to.
   */
  if (!slack || !hugSlack || props.selectable || !hasContent(children)) {
    return <KitText {...props}>{children}</KitText>;
  }
  return (
    <KitText {...props}>
      <HugSlackContext.Provider value="">{children}</HugSlackContext.Provider>
      {slack}
    </KitText>
  );
}
