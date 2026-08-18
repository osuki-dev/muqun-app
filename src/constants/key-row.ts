/**
 * The height of every control in the terminal's key row (card #663).
 *
 * The row mixes two kinds of key -- icon circles the server screen draws, text
 * keys inside a horizontal scroll view, and the files button, which lives in
 * its own component -- and each of them was stating 36 for itself. They agreed
 * on the number and disagreed on where the 36 sat: the row hung its children
 * from the top, and the scroll view's content added two points of padding that
 * applied to the text keys and to nothing else, so the bottom edge came out
 * ragged by exactly that much.
 *
 * One number, imported by all four, and the row states it too. A second copy of
 * it is how this came apart the first time.
 */
export const KEY_ROW_HEIGHT = 36;
