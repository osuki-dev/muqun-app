/**
 * Whether a listed command still needs something typed before it can be sent.
 *
 * The catalogue follows the usual convention: `<path>` is required, `[report]`
 * is optional. Treating every hint as mandatory handed the whole catalogue to
 * the composer and closed the sheet, which reads as the command having done
 * nothing -- and most of an agent's commands carry an optional hint.
 *
 * A hint that mixes both, like `<name> [note]`, is required: the caller cannot
 * supply the part that is not optional.
 */
export function slashArgumentRequired(hint?: string | null): boolean {
  if (!hint) return false;
  // Strip optional groups first; anything angle-bracketed left over is required.
  return /<[^<>]+>/.test(hint.replace(/\[[^[\]]*\]/g, ''));
}
