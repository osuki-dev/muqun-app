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
 * These are the 1.2.0 notes, and the one launch nobody will see them at is 1.2.0's
 * own. `whats-new-card` returns early on `Updates.isEmbeddedLaunch`, so a fresh
 * store install shows nothing; and `runtimeVersion` follows `appVersion`, so no
 * 1.1.0 install can ever be handed this bundle. They first appear on the first
 * bundle update published on top of the 1.2.0 binary — which is the honest place for them,
 * since a store listing has already said all of this to anyone updating.
 */
export const RELEASE_NOTES: { title: MessageDescriptor; items: MessageDescriptor[] } = {
  title: msg`What's new`,
  items: [
    msg`Five theme packs — Osuki, Catppuccin, Rosé Pine, Everforest, Tokyo Night — repaint the app and the terminal together.`,
    msg`Long-press the terminal to select output, drag to extend the selection, and copy it.`,
    msg`The on-screen keyboard is laid out like a keyboard, and every key sends the moment you press it.`,
    msg`Editor terminals get vim’s own key row, LazyVim leader combos included, and keep the colours the program asked for.`,
    msg`Muqun speaks eight languages. It follows your phone, or you can choose one in Settings.`,
    msg`Home, Settings and the server screen are redesigned — every server lists the agents it was last running, with their status.`,
    msg`When an agent asks permission, Muqun redraws the question as a card and clears the composer until you answer it.`,
    msg`Approve or deny that request straight from the notification, without opening the app.`,
    msg`New terminal now splits the group you are in, and the phone goes straight to what it made.`,
  ],
};
