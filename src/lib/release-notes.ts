import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

/**
 * User-facing notes bundled with this native release, available manually in
 * About. OTA downloads display their own localized server Markdown, with the
 * English Hot Updater catalog message as a fallback;
 * these notes must never stand in for an unknown OTA changelog.
 *
 * `msg` descriptors rather than strings, so the card reads in the active
 * locale.
 *
 * These are the 3.1.0 notes. They do not automatically open at startup.
 */
export const RELEASE_NOTES: { title: MessageDescriptor; items: MessageDescriptor[] } = {
  title: msg`What's new`,
  items: [
    msg`Several coding agents on one computer: OpenCode, DeepSeek and T3 Code each get their own tile on Home, with their own sessions and workbench.`,
    msg`Approvals and status changes for every session arrive over one live connection per computer, not only for the session you have open.`,
    msg`The terminal, the opening and Home artwork draw with a new GPU renderer, and theme and font changes have transitions of their own.`,
    msg`One Changes sheet for terminals and agent sessions: the changed files as a tree with line totals, the branch under the title, and Discard on a file's menu.`,
    msg`On a tablet, Home is a two-page spread, work sheets fill the screen, and the on-screen keyboard is a whole keyboard with F-keys and sticky modifiers.`,
    msg`Cover Courier is built in and worn until you pick a theme, and Interface background opacity now reaches every sheet and notice.`,
    msg`Fixes for terminals that stayed on their loading logo, flickered under full-screen programs or froze under a sheet.`,
  ],
};
