# Task workflow validation record

## Environment

Local Android testing uses the existing Omarchy AVD, `emulator-5554`, with
secondary Android user 10. Original user 0 and its pairing data are preserved.
The implementation worktree runs Metro on port 8085. iOS runtime validation is
deferred to the user and is not claimed here.

Available local tools verified on 2026-09-14: Herdr 0.9.0, tmux 3.7c,
Codex 0.154.0, Claude Code 2.1.270, Gemini 0.56.0 and OpenCode 1.18.30.
Codex and Claude reported authenticated status; Gemini/OpenCode authentication
has not been verified. No credentials are included in this record.

## Real paired check in progress

A new Herdr session `muqun-echo-20260914-0529` and a Gateway with isolated
XDG config/data roots were created for this check. The App paired through the
manual address/code flow with application transport encryption required.

The App sent `echo MUQUN_SHELL_$((2700+29))` to its isolated shell terminal.
Both the native pane read and the App screenshot showed the evaluated result
`MUQUN_SHELL_2729`. This verifies real App-to-Gateway-to-Herdr shell delivery and
returned output. It does not establish AI delivery or completion.

Codex startup revealed a real safety issue: Herdr reported `idle` and
`interactive_ready: true` while the terminal displayed its directory-trust
question. The App correctly displayed the approval options. No approval was
answered; user confirmation was requested as required by AGENTS.md. AI prompt,
follow-up and App-created assistant success checks remain pending.

Gateway now has a regression fixture from the real trust screen. Its shared
prompt path reads the visible screen and refuses detected approvals before
native input; legacy delayed Enter also refuses detected approvals. This is
an additional denial check, not an atomic launch-identity guarantee.

The real Android Tasks entry also opens against the isolated Gateway without
answering the pending trust prompt. With no managed-task capability advertised,
creation is disabled and Refresh remains available. This check exposed duplicate
compatibility text and an inappropriate creation hint beside the disabled action;
both were corrected and rechecked on Android. The updated screen has one
compatibility explanation, a neutral unavailable state, disabled creation and
an available Refresh action.

Gateway task-event tests now cover scoped replay, cursor reset/stream close,
revocation before a page is emitted, and authenticated encrypted event payloads.
The native Herdr implementation now includes launch-bound startup, observation,
and prompt delivery, with no reusable shell after the owned process exits.
Its full `just lint` and `just test` gates passed: 3,281 Rust tests passed and two
were skipped; the prescribed supporting suites also passed. An isolated native
smoke verified a 22-byte UTF-8 prompt, returned fixture output, wrong-owner
refusal, and post-exit refusal. The smoke used an explicitly simulated native
assistant executable and stopped its private session afterward. It is not
evidence of a completed real AI conversation.

## Android suite status

The first dedicated `task-workflow` device run failed at the assertion for the
initial instruction's acknowledgment. Its captured output showed the demo
instruction had been delivered, while task detail displayed only the startup
receipt. This is a UI receipt-state defect, not a reason to weaken the assertion.
Evidence is under `dist/e2e-reports/task-workflow-1789366978904/`.

The next run passed that receipt assertion but exposed Android sheet dismissal
while scrolling toward the task header. Tasks now uses a full-screen modal; the
following run passed that navigation and reached result review. Its remaining
failure was an exact-text fixture mismatch: the repository deliberately normalizes
trailing punctuation from translated English, while the new flow expected source
punctuation. The flow now uses the intended catalog text while retaining exact
result IDs and semantic review assertions. A fresh complete task-flow run remains
required; these intermediate runs are not a passing feature gate.

The subsequent task workflow passed in full on Android:
`dist/e2e-reports/task-workflow-1789369685957/` (1/1 flow passed). It covers startup
and delivery receipts, explicit recipient selection, reviewing the exact selected
submission, preserving another submission's unreviewed state, and uncertain/refused
operation handling. Safe-area insets now bound the full-screen scroll viewport
instead of scrolling away with content. This is offline demo coverage, not a real
AI conversation.

The checked App snapshot passed the first four repository gates: TypeScript,
strict lint, formatting, and 3,837 unit tests (two existing skips). The subsequent
full Android run completed with **17/18 flows passing**, including collaboration
and task workflow: `dist/e2e-reports/full-1789370120204/`. Airplane mode and disabled
Wi-Fi supplied offline conditions; Metro used localhost:8085 through ADB reverse.
The runner restored network state and QA-user development preferences afterward,
and the restored airplane/Wi-Fi values were verified as 0/1.

The sole failing flow was `custom-themes`: it asserted reset visibility before
its existing guarded scroll. Evidence showed both requested switches changed
correctly. The flow now checks reset after scrolling, then scrolls back to the
terminal opacity control and verifies that exact control is 100%. A generic 100%
text check could otherwise pass on the unrelated interface opacity. Native syntax
and runner checks must pass, followed by another full suite after the remaining
App integration changes. The 17/18 run is not a passing feature gate.

The isolated QA Gateway pairing was explicitly removed through the App before
this offline run. Android user 0 and its data were not changed. The original
isolated Codex process still awaits its directory trust decision.

The added collaboration flow exercised starting a demo assistant, retaining
reviewed history, and removing that local history. It passed during the full
suite attempt. This is offline UI evidence only.

The full suite has not passed. One initial attempt was blocked by the QA tool
session still owning the device. After closing that session, a second attempt
reached a theme-catalogue offline assertion while the emulator was online and
displaying real catalogue results. That suite was interrupted to fix newly
found collaboration lifetime/caching races before the next full run.

Future full-suite runs must preserve the same offline conditions and restore
network access before real paired testing. Do not weaken the catalogue assertion
to make an online catalogue count as an offline failure.

## Remaining feature gates

Review found an additional execution blocker: current reservations are not
reconciled after an acknowledged assistant exits, or after a definitive startup
refusal leaves workspace resources. A replacement lead can therefore remain
blocked permanently. The next implementation must distinguish reservation
lifecycle from operation outcome, retain historical resources, and release only
from durable no-start proof or authoritative evidence for the exact exited
generation. Missing aliases, idle status, timeouts, and ambiguous native absence
cannot establish that proof. Records-only behavior is unaffected.

The managed task UI is wired to scoped records, launch and delivery receipts,
bounded history pages, immutable result/review reads, and pending-request recovery.
Gateway execution uses the new native launch-bound API, and agent result reporting
uses an attempt-scoped local authority. The selected session advertises execution
only when the native methods and local reporting service are available; record
access remains available independently. End-to-end integration still needs the
real paired AI checks and Android process-termination recovery proof. Wider
delegation, dependencies, and managed tmux remain separate implementation work.
No iOS runtime coverage is claimed. Keep implementation PRs draft until the
applicable repository and real paired gates are satisfied.

Independent review found and led to fixes for recovery and lifetime defects:
creation acknowledgment followed by a failed detail read could invite a duplicate
task; memory-only pending state did not survive pairing-record replacement or
App restart; lost responses needed read-only request-key receipt lookup; and a
failed explicit output refresh could remain armed for later polling. Gateway
now offers scoped receipt reads and bounded, revision-consistent history pages.
The App consumes both, pins historical selections, and blocks execution until
required attempt/operation history is complete. SecureStore writes and readback
finish before dispatch; recovery performs receipt reads without retrying mutations.
The explicit demo journal shares its fixture's process lifetime and never provides
a fallback for real SecureStore failures. Unit and separate-JavaScript-process
tests cover these invariants; actual Android kill/relaunch proof remains pending.

## Encrypted Android restart recovery and transport replay finding

On 2026-09-14, the dedicated Android user paired normally with a fresh isolated
Gateway through a local fault-injection proxy. The proxy dropped the successful
create response after Gateway committed it. Android displayed `Operation not
confirmed` and disabled a second submission. After an explicit force-stop and
relaunch, opening Tasks recovered the original task through the persisted
SecureStore journal and read-only receipt/detail requests. No mutation was sent
following restart and no assistant was started. Read-only SQLite inspection found
one task, one create receipt, and zero attempts. The recovered screen displayed
`No assistant has been started for this task`.

This run also found an unresolved transport defect: immediately after the dropped
response, before restart, a second POST reached Gateway and was rejected with HTTP 409. JavaScript invoked Nitro Fetch once; Android's Cronet upload rewind behavior
is the identified native retry candidate. Gateway replay protection prevented a
second commit, but the strict one-POST requirement did not pass. A reproducible
native no-replay patch, rebuilt Android APK, and repeated fault injection are
required. Unit tests alone cannot close this finding.

Evidence: private fixture `/tmp/gwp-ia19uvlf`, task
`0a334dcb-623e-435c-81cf-c1c2b1d16b09`, and local screenshots
`/tmp/muqun-recovery-unconfirmed.png` and `/tmp/muqun-recovery-restored.png`.
The fixture used Gateway SHA-256
`e72bea666b24526f2f3482239815e838878a656d38a7dccc9087a4304a57c534`, which predates
scoped task inputs. This test proves neither attachment delivery nor real AI
execution. The QA pairing was removed through the App, its removal was verified
on Gateway, and the owned fixture processes were stopped. The earlier real
Codex session remains untouched at its pending directory-trust prompt.

Immediately before this device test, TypeScript, lint, formatting, and the App
unit suite passed: 3,856 passed, two skipped. Subsequent integration changes need
fresh gates; this is a snapshot of evidence, not final feature readiness.

## Android input intent observation with agent-device 0.20.10

The dedicated Android full run at `dist/e2e-reports/full-1789378799215/`
passed 17 flows and stopped in `task-workflow` at the input intent assertion.
This run does not pass the full gate. Its `task-workflow/0179-snapshot.json`,
`0181-snapshot.json`, and `0184-snapshot.json` show the updated app: the exact
`task-input-use-may-include` radio has the label `✓ May include in the result`,
while `task-input-use-reference-only` has the plain label `Reference only`.
The selected indicator proves the updated JavaScript rendered and the selected
intent changed; neither `checked` nor `selected` is present in those snapshots.

The pinned agent-device 0.20.10 distribution's `dist/src/snapshot.js`, function
`Ce`, constructs Android snapshot nodes by copying identity, text, geometry,
enabled/focused/visibility and hierarchy fields. It omits `checked` and
`selected`. Raw snapshot mode still uses this node conversion. React Native's
`ReactAccessibilityDelegate.kt` maps the app's boolean accessibility `checked`
state to `isCheckable` and `isChecked`, but this tool output cannot verify those
native properties.

The native flow therefore checks the exact radio IDs and rendered checkmark
labels before and after choosing an intent, including the opposite control's
plain label. It also verifies `May include in output` from the frozen task input
receipt after creation. These are rendered selection and retained input intent
checks, not a claim of native checked-state coverage. No generic missing-state
fallback or test-driver upgrade was introduced. A subsequent full device run
is required to establish that the corrected flow passes.

## Real managed startup: identity discovery gap

The dedicated Android QA App paired with the isolated encrypted Gateway candidate and created a managed task. Canonical Codex started in the approved isolated directory, accepted the previously authorized directory trust choice, and reached its interactive screen. The persisted start operation is acknowledged with an immutable native launch ID and owner epoch. A read-only `agent.get_bound` call confirmed that exact launch remained present.

Ordinary native `agent.list` omitted that identity, and Gateway decoded only legacy aliases or conversation identities. App recipient matching therefore remained unavailable and prevented managed prompt delivery. This is an integration defect under repair, not evidence of agent exit. No real managed echo or complete workflow pass is claimed from startup alone.

The same run found misleading unsupported-profile error mapping and creation-form state surviving a return to Tasks. The former has host regression coverage; the latter is included in explicit navigation-state integration. Android layout and final full-suite checks remain pending.
