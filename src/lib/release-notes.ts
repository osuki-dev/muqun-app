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
 * These are the 2.0.0 notes, and the one launch nobody will see them at is
 * 2.0.0's own. `whats-new-card` returns early on `Updates.isEmbeddedLaunch`, so
 * a fresh store install shows nothing; and `runtimeVersion` follows
 * `appVersion`, so no 1.3.0 install can ever be handed this bundle. They first
 * appear on the first bundle update published on top of the 2.0.0 binary —
 * which is the honest place for them, since a store listing has already said
 * all of this to anyone updating.
 */
export const RELEASE_NOTES: { title: MessageDescriptor; items: MessageDescriptor[] } = {
  title: msg`What's new`,
  items: [
    msg`Muqun speaks SSH. Save a host, tap it on the home screen, and you are in a real shell — password, key or a code from your authenticator.`,
    msg`That shell is the terminal you already know: the same keyboard, the same key row, the same colours, and your phone's own keyboard for anything you would rather type.`,
    msg`A server's key is remembered the first time and checked every time after, and a key that changed stops the connection until you say otherwise.`,
    msg`Keys are generated on the device and never leave it.`,
  ],
};
