/**
 * The machines sheet's old address, kept pointing at the sheet that absorbed it.
 *
 * `/sessions` opened "Machines and sessions" from the header's monitor button.
 * There is no monitor button any more and no second sheet to open: machines,
 * backends, workspaces and panels are one column on `/panels` now.
 *
 * The route stays anyway. Every route in `src/app` is also a deep link, so
 * `muqun://sessions` is an address that has been handed out -- to a shortcut, a
 * notification, a browser -- and deleting the file turns those into a
 * not-found rather than into the sheet they were always asking for. It renders
 * the very same screen rather than redirecting to it, so a link lands on the
 * sheet directly instead of watching one sheet open and another replace it; the
 * machines rail is the first thing in that sheet, so a reader arriving this way
 * arrives at what they came for.
 *
 * The screen reads `paneId` and `label` as optional for exactly this reason:
 * the machines link never carried them.
 */
export { default } from './panels';
