import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

/**
 * User-facing notes for the current bundle, shown once after an over-the-air
 * update applies. The `eas update --message` text lives server-side and is not
 * delivered in the client manifest, so the changelog has to ride inside the
 * bundle. Bump `RELEASE_NOTES` every time you ship an OTA worth announcing;
 * leave `items` empty to suppress the card for a silent fix.
 *
 * `msg` descriptors rather than strings, so the card reads in the active
 * locale. The seen-fingerprint in `whats-new-card` keys on the English source
 * text, which is the one form that does not change when the phone's language
 * does.
 *
 * These are the 3.1.0 notes. `whats-new-card` returns early on
 * `Updates.isEmbeddedLaunch`, so a fresh store install shows nothing, and they
 * first appear on the first bundle update published on top of the 3.1.0 binary,
 * which is the honest place for them: the store listing has already said all of
 * this to anyone updating.
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
