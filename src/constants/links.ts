/**
 * Every address the app hands to the outside world, in one file.
 *
 * These four values are the whole of Muqun's outbound surface: three links and
 * an email, all of them reachable from two screens. They used to live as string
 * constants next to the screens that opened them, which was fine while nothing
 * moved. Two things are about to move at once -- the marketing site to
 * `muqun.dev`, and the source to `github.com/osuki-dev/muqun` -- and a rename
 * spread across two files is a rename that gets half done.
 *
 * ## The constraint, and it is the point of this file
 *
 * A URL in a store binary is not a deploy. It ships, and then it is on the
 * phone for as long as that build is installed -- which, for someone who does
 * not auto-update, is years. There is no rollback. So the order is fixed and it
 * only runs one way:
 *
 *   1. The new destination answers 200.
 *   2. The value here changes.
 *   3. A build carrying the new value ships.
 *   4. The old destination keeps redirecting, forever, for the builds already
 *      out there.
 *
 * Never step 2 before step 1. A link that 404s in the hand of a reader who has
 * just failed to pair is worse than the dead end it replaced, and a link that
 * 404s in front of App Review costs a release -- 1.3.0 already came back once.
 *
 * That rule has already been broken once here, which is why it is written down.
 * These three values were changed to `muqun.dev` while that site existed only as
 * a repository: the domain had no DNS record, so `muqun.dev/privacy/` -- the URL
 * App Review opens first -- resolved to nothing at all. They are back on
 * `www.osuki.dev/muqun`, which answers 200 today, and they stay there until
 * `muqun.dev` is serving. The new site being *finished* is not the trigger; the
 * trigger is a 200 from the live domain.
 *
 * ## What is not in this file
 *
 * `store.config.json` carries the same site under `marketingUrl`,
 * `supportUrl` and `privacyPolicyUrl`, once per locale, plus the review notes.
 * Those are read by the submission tooling, not by the app, and they are
 * governed by the opposite clock: they must be correct for as long as the
 * listing is *live*, and they can be corrected the same day. They are
 * deliberately not imported from here -- JSON cannot import, and pretending the
 * two sets move together is how one of them ends up pointing somewhere real
 * while the other does not. When the site moves, change both, in this order:
 * this file first (it needs a build), the store config when that build ships.
 */

/**
 * The privacy policy, opened from Settings -> About.
 *
 * No trailing slash, unlike the `privacyPolicyUrl` in `store.config.json`.
 * That is not tidiness waiting to happen: this exact string is what 1.3.0
 * shipped and what the site is known to answer. Normalising it is a change to
 * a live URL for no gain.
 */
export const PRIVACY_POLICY_URL = 'https://www.osuki.dev/muqun/privacy';

/**
 * Where a reader with no Gateway is sent, from the pairing screen.
 *
 * That screen used to be a dead end for exactly the person most likely to
 * reach it. It says "run the Gateway on your machine and scan the QR code it
 * prints" and then offers a camera and an address field, neither of which is
 * any use until that machine exists -- and it never said where to get it. An
 * App Store reviewer landed in the same place, which is part of why 1.3.0 came
 * back.
 *
 * The marketing page rather than a deeper one: `/muqun/setup` and
 * `/muqun/gateway` are both 404 today, and a link that 404s in review is worse
 * than no link at all.
 */
export const GATEWAY_SETUP_URL = 'https://www.osuki.dev/muqun/';

/**
 * The one command that installs the Gateway, printed on the pairing screen.
 *
 * The screen above sends a reader to a web page; this is the page's answer,
 * inlined. Someone holding a phone in front of a laptop should not have to
 * open a browser on the phone to find out what to type on the laptop -- and
 * that detour is most of why the pairing screen reads as a dead end.
 *
 * `muqun.dev/gateway.sh` is the canonical 302 to the script in the Gateway's
 * own repository, so this address survives the repository moving and the
 * script has exactly one copy. The old `osuki.dev/muqun/gateway.sh` address
 * stays live for released builds, while new builds and documentation publish
 * the product domain consistently.
 *
 * It is a `| sh` pipeline because the reader is on a phone, and the two-step
 * download-read-run form is three lines nobody will retype from a 390pt
 * screen. The site carries the inspectable form for anyone who wants it.
 */
export const GATEWAY_INSTALL_COMMAND = 'curl -fsSL https://muqun.dev/gateway.sh | sh';

/**
 * The issue tracker, opened from Settings -> About.
 *
 * This is `muqun-app`, the repository you are reading, because from the next
 * release the app's source and the app's bug reports are the same place: a
 * report that can be answered with a commit, in the tree that commit lands in.
 *
 * ── WHAT THIS MOVED FROM ────────────────────────────────────────────────────
 * It was `osuki-dev/muqun-feedback`, a tracker with no code in it, opened
 * before this repository existed. An earlier note here argued the move needed
 * a migration rather than an edit, because it would strand the issues already
 * filed. It would have -- both trackers were checked on 2026-08-18 and both
 * held zero issues, so there was nothing to strand and the edit is the whole
 * move. That repository is being retired.
 *
 * ── THE 1.3.0 BINARY STILL POINTS AT THE OLD ONE ────────────────────────────
 * Every installed 1.3.0 copy has the old address compiled in, so deleting
 * `muqun-feedback` turns its Feedback button into a 404 -- for a paying user,
 * on the one screen they reach when something is already wrong.
 *
 * This constant is JavaScript, not native config, and `runtimeVersion` follows
 * `appVersion`, so an `eas update --channel production` on the 1.3.0 runtime
 * moves every one of those installs onto this address. Ship that bundle first,
 * give it time to reach people, and only then delete the old repository.
 * Deleting it before that is the one ordering that cannot be undone.
 *
 * ── AND THIS REPOSITORY HAS TO BE PUBLIC FIRST ──────────────────────────────
 * Same reason, other direction: while `muqun-app` is private the Feedback
 * button is a 404 for everyone without push access. Public first, then the
 * bundle, then retire the old tracker.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const FEEDBACK_URL = 'https://github.com/osuki-dev/muqun-app/issues/new/choose';

/**
 * The support address, shown and mailto'd from Settings -> About.
 *
 * A mailbox, not a page: it survives the site move on its own MX records and
 * has no reason to change with the domain. It is also the address in
 * `store.config.json`'s review contact, so the two should stay the same string.
 */
export const SUPPORT_EMAIL = 'muqun@osuki.dev';
