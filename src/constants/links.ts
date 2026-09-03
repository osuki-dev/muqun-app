/**
 * Every address the app hands to the outside world, in one file.
 *
 * These five values are the whole of Muqun's outbound surface: four links and
 * the source repository, all of them reachable from two screens. They used to
 * live as string constants next to the screens that opened them, which was fine
 * while nothing moved. Two things moved at once -- the site to `muqun.dev`, and
 * the source to `github.com/osuki-dev/muqun-app` -- and a rename spread across
 * two files is a rename that gets half done.
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
 * 404s in front of App Review costs a release -- 1.3.0 already came back once,
 * because these values were moved to `muqun.dev` while that domain had no DNS
 * record at all.
 *
 * That is why step 1 is written down as a check rather than a belief. It was
 * run again on 2026-09-03, unauthenticated, before the values below changed:
 * `muqun.dev/`, `muqun.dev/privacy`, `muqun.dev/gateway.sh` and the GitHub
 * repository and its issue form each answered 200, and the repository reports
 * `private: false`, so the Feedback button resolves for a reader with no push
 * access. Only then were these edited.
 *
 * `osuki.dev` is no longer this app's home: Muqun is its own product on its own
 * domain from 2.0.0. The old addresses stay alive as redirects for the 1.3.0
 * binaries already installed, which is step 4 and has no end date.
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
 * The privacy policy, opened from Settings -> About, and the first URL App
 * Review opens.
 *
 * No trailing slash: `muqun.dev/privacy` and `muqun.dev/privacy/` both answer
 * 200, and the form without it is the one this app has always sent.
 */
export const PRIVACY_POLICY_URL = 'https://muqun.dev/privacy';

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
 * The site root rather than a deeper page: only `/` and `/privacy` are known
 * to answer, and a link that 404s in review is worse than no link at all.
 */
export const GATEWAY_SETUP_URL = 'https://muqun.dev/';

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
 * stays live as a redirect for the builds already installed.
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
 * The source, opened from Settings -> About.
 *
 * Muqun is open source from 2.0.0, and this is the repository that Feedback
 * above files into -- the same tree, so a reader who wants to read the code
 * that produced a bug and a reader who wants to report it end up in one place.
 *
 * ── WHY THERE IS NO SUPPORT EMAIL ANY MORE ──────────────────────────────────
 * There was a `muqun@osuki.dev` mailbox here, shown and mailto'd from a
 * "Contact us" row. It went with the domain. A mailbox is also the wrong
 * instrument for an open-source app: a bug reported by mail is invisible to
 * everyone else who has it, cannot be linked to the commit that fixes it, and
 * dies if nobody is reading that inbox. Both of the things it was used for --
 * report something, ask something -- are the issue tracker now.
 *
 * The 1.3.0 binaries still show the old address. That is harmless in a way a
 * dead link is not: an address that no longer receives mail bounces, rather
 * than presenting a 404 to someone who is already having a bad time.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const SOURCE_URL = 'https://github.com/osuki-dev/muqun-app';
