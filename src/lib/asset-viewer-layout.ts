/**
 * Which body the file viewer draws for a file, and what that body stands on.
 *
 * Pure, so the decision is tested rather than read off a chain of `if`s in a
 * component. There are two grounds and only two:
 *
 *  * **The lightbox**, for a picture: black, full bleed, its own pinch and
 *    pan. A photograph is judged against a neutral matte, never against the
 *    theme's wallpaper, so this is the one body that does not sit on the
 *    sheet's ground.
 *  * **The frosted sheet ground**, for everything else: the same veil every
 *    sheet wears (`SheetFrame frosted`), which follows the reader's opacity
 *    slider down to its 0.82 floor. Text -- prose, code, a table of CSV, the
 *    details of a file there is no preview for -- is never drawn straight onto
 *    a wallpaper.
 *
 * Every frosted body keeps the sheet's gutter on both sides. Code is the one
 * thing that does not wrap: a source listing, a JSON document or a CSV keeps
 * each line whole and pans sideways, like the diff viewer, because a re-wrapped
 * line no longer agrees with its column or its line number.
 */
import type { SessionAsset } from './session-assets';
import { HIGHLIGHT_MAX_CHARS, MAX_ASSET_TEXT_BYTES } from './text-preview';

export type AssetPresentation =
  /** A previewable image: the lightbox. */
  | 'lightbox'
  /** Audio uses the shared sheet with an explicit native playback control. */
  | 'audio'
  /** Markdown, as a document a block at a time. */
  | 'document'
  /** Text inside the highlighting budget: one fenced, coloured listing. */
  | 'code'
  /** Text past the highlighting budget: virtualized plain rows. */
  | 'lines'
  /** Text past the size the app will hold; nothing is read. */
  | 'too-large'
  /** A PDF, a video, a binary -- anything with no preview: what it is and where. */
  | 'details';

/**
 * The body for `asset`.
 *
 * `contentLength` is the text in hand, in characters, once it has arrived; the
 * highlighter's budget is in characters because glyphs are what it lays out.
 * Before it arrives a text file is presumed to fit, which is what the loading
 * state is shaped like.
 */
export function assetPresentation(
  asset: Pick<SessionAsset, 'kind' | 'previewable' | 'size'>,
  contentLength?: number
): AssetPresentation {
  if (!asset.previewable) return 'details';
  if (asset.kind === 'image') return 'lightbox';
  if (asset.kind === 'audio') return 'audio';
  if (asset.kind !== 'markdown' && asset.kind !== 'text') return 'details';
  if (asset.size > MAX_ASSET_TEXT_BYTES) return 'too-large';
  if (asset.kind === 'markdown') return 'document';
  return contentLength !== undefined && contentLength > HIGHLIGHT_MAX_CHARS ? 'lines' : 'code';
}
