/**
 * Where a panel sits, said the way the panels sheet says it.
 *
 * The app had two addressing languages. The panels sheet addresses rows the way
 * tmux does -- `1.2` is the second panel of the first tab, in a fixed
 * monospaced column -- and the two-finger switch answered with something else
 * entirely: a name and a fraction, `Review · 2/3`. Both are true and they teach
 * different vocabularies for the same place, which is one vocabulary too many
 * for a screen and a sheet a swipe apart.
 *
 * So the switch now speaks the sheet's language, with the workspace in front of
 * it because a switch can cross workspaces and the sheet only ever shows one:
 *
 *     2 · 1.3  nvim
 *
 * -- the second workspace, its first tab, that tab's third panel, and the name
 * the reader recognises. The numbers are monospaced and the name is not, which
 * is the sheet's own treatment: the address is a column to scan, the name is
 * prose.
 */
export type PaneAddress = {
  /** The workspace's 1-based place among the session's workspaces. */
  workspace: number;
  /** The tab's 1-based place in its workspace. */
  tab: number;
  /** The panel's 1-based place in its tab. */
  panel: number;
  /** The panel's name, as the header and the sheet both give it. */
  title: string;
};

/**
 * The monospaced half: `2 · 1.3`.
 *
 * The middot separates the two scopes and the dot joins tab to panel, exactly
 * as the sheet has it -- a tab header reads `1`, a panel row under it reads
 * `1.3`, and neither has ever carried a workspace because the sheet shows one
 * at a time. The name is not in here: it is set in the reading face beside it.
 */
export function paneAddressText(address: PaneAddress): string {
  return `${address.workspace} · ${address.tab}.${address.panel}`;
}
