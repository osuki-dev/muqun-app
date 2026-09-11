# In-app notifications

## Scope

Foreground Expo push notifications use a themed in-app banner instead of an OS
banner. This is a presentation layer for existing push delivery, not a new local
event bus, notification inbox, or proof that an agent finished its task. It does
not introduce a Gateway polling loop or change push registration requirements.

`src/lib/in-app-notifications.ts` owns pure queue, conversion, and presentation
rules. The Zustand store keeps the queue in memory. `InAppNotificationHost` renders
the first notice inside `AppLockGate`; `src/lib/notifications.ts` connects the Expo
notification handler to that store.

## Interaction

- New events wait behind the currently visible notice instead of replacing it
- Open navigates only after an explicit press, then dismisses the notice
- Close dismisses without navigating or answering an agent approval
- Notices without a destination have no Open action
- The pending count includes the currently visible notice
- There is no automatic dismissal timer, task progress percentage, or automatic
  terminal navigation
- The card uses existing color tokens, a top safe area, 44-point action targets,
  and a maximum width of 480 points for larger displays

The title is limited to two visible lines and the body to four. The body is
selectable; the notice is not a full transcript viewer. Opening the destination
is the way to inspect the relevant workspace.

## Content and bounded storage

Push conversion requires a nonempty receipt identifier of at most 512 code units
and at least one readable text field. Server text sanitization removes control
and invisible formatting characters. Titles become one line and are limited to
120 Unicode code points; bodies retain line breaks and are limited to 320.
Notification text is plain text, not executable markup.

The queue contains at most 20 notices. When full, the visible notice stays in
place, the oldest waiting notice is dropped, and the newest notice is appended.
The last 200 receipt identifiers suppress duplicate callbacks, including after
dismissal. Deduplication is bounded rather than permanent: sufficiently old
identifiers can be accepted again. Neither bodies nor receipt history is written
to persistent storage. Disabling notifications clears pending notices while
retaining this bounded, in-memory receipt history.

Server/session/pane destinations reuse `notificationRoute` and remain structured
router parameters. Without a server destination, only its existing internal-route
fallback is accepted. This layer does not introduce arbitrary external URL actions
or automatic approval responses.

## Lifecycle and lock boundary

When notifications are enabled and the app is active, the handler queues the
notice and suppresses system banner/list presentation. When inactive or in the
background, its presentation policy delegates banner/list visibility to the OS
instead. Actual background push delivery is still platform-controlled. The
handler requests neither sound nor a badge; existing receipt feedback behavior is
separate and unchanged.

The host renders nothing while inactive. Previously queued notices are retained
in memory and can reappear after returning to the foreground; there is no expiry
or background reconciliation. The host is unmounted while `AppLockGate` displays
the lock screen, so its own text and buttons are not available behind that gate.
Notifications received during a locked foreground session may remain queued until
unlocking.

Existing OS notification response handling is outside `AppLockGate`. Its approval
actions and deep-link callbacks are not made lock-aware by this banner change.
Do not describe the new host as a security gate for all notification actions.

## Verification boundaries

Pure tests cover queue order and overflow, immutable updates, bounded duplicate
history, dismissal, malformed content, Unicode limits, route conversion, and the
foreground/background presentation matrix.

Native checks are still required for foreground receipt, no duplicate OS banner,
explicit Open/Close behavior, keyboard overlap, accessibility announcements,
rotation and iPad sizing, background/resume, app lock/unlock, and disabled settings.
A root React Native sibling with a high z-index does not establish visibility
above native iOS modal or form-sheet presentations. Verify those routes on device
before claiming app-wide modal coverage; preserve the queue if a modal covers it.

The required full `agent-device` suite remains the feature gate. Pure tests do not
prove Expo delivery, native layering, or real paired Gateway-to-agent behavior.
