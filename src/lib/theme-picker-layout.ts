/**
 * How wide the theme surfaces are allowed to grow.
 *
 * One number now, and it used to be a grid: the picker laid its packs out as
 * two to four columns of tiles measured from the sheet's own content width.
 * The picker is a column of scene rows on a form sheet, so there are no tiles
 * to size -- what is left is the cap that stops a row on a Pad running a canvas
 * wide between a pack's name and its swatches.
 */
export const THEME_PICKER_MAX_CONTENT_WIDTH = 1040;
