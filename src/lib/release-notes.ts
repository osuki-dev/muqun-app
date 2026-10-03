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
    msg`Muqun now works with several coding agents on one computer. OpenCode, DeepSeek and T3 Code each get their own tile on Home, with their own mark.`,
    msg`Continue and the offline and empty-state messages now name the agent they mean, and a new session asks which agent when more than one is ready.`,
    msg`Approvals and status changes for every session now arrive over one live connection per computer, not only for the session you have open.`,
    msg`Each agent's screen shows only what it supports, and the model picker groups models by provider and greys out the ones you are not signed in to.`,
    msg`On a tablet, Continue rows now open their terminal panes. An older Gateway keeps working with OpenCode as before.`,
  ],
};
