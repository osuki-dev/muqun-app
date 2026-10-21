# Native end-to-end tests

Run the offline app suite with agent-device **0.21.12** on a dedicated simulator or
emulator with no paired servers or saved SSH hosts. Install the app, select
English and the Osuki theme, and start Metro for development builds. Preview and
release builds include their own JavaScript bundle.

```sh
bash scripts/e2e.sh --check
bash scripts/e2e.sh --device <id> --platform ios
bash scripts/e2e.sh --smoke --device <id> --platform android
E2E_AD_METRO_HOST=127.0.0.1 E2E_AD_METRO_PORT=8081 \
  bash scripts/e2e.sh --device <id> --platform ios
bash scripts/e2e.sh --flow settings --device <id> --platform ios
```

Notification permission requests for Muqun are declined through their native
button in English, Simplified Chinese, or Traditional Chinese, then the runner
verifies the alert disappeared. This guard runs before locating controls and
before every input or gesture, including delayed prompts raised after entering
demo mode. The `pairing-manual` flow additionally permits denial of Muqun's
camera request, covering manual pairing without camera access. Camera requests
outside that flow and other native alerts fail instead of permitting touches on
the app underneath. iOS runtimes may not support changing notification access
through `settings permission`; the suite does not reset other permissions or
clear app data as a workaround.

Set `AGENT_DEVICE_BIN` to the installed executable's absolute path if it is not
on PATH. `E2E_AD_DEVICE`, `E2E_AD_PLATFORM`, `E2E_AD_SESSION`, and
`E2E_REPORT_DIR` are optional overrides. `E2E_DEV_CLIENT_URL` supplies an explicit
development-client launch URL when needed. No tool is installed automatically.
`--device` accepts a simulator/emulator name, an iOS UDID, or an Android serial.
The runner maps UDIDs to native `--udid` and emulator/connected ADB serials to
native `--serial`; human-readable names retain native `--device` selection.

The full gate runs every enabled `full` flow, serially on the selected device,
and continues after failures to report all affected surfaces. Smoke runs only
`demo-tour` and does not replace the full gate. Reports are
`dist/e2e-reports/junit-full.xml` (or the selected tag/flow) with timestamped
screenshots, native command results, and captured view hierarchies beside them.
Each run keeps its evidence; previous runs are not deleted. A failure returns a
nonzero exit status. The runner's pure tests execute before device tests.

## Device isolation

Discover the existing dedicated QA device and pass its identity explicitly. Verify
that it has no paired computers or saved SSH hosts before running the suite. Do
not create a device for each feature, clear user data, or automate a paired device.
Run each supported platform separately; a phone result does not prove tablet or
iOS coverage. The runner serializes flows within one invocation.

Visibility assertions use native `is exists` with `visible=true`: multiple
visible copies of a heading still satisfy an exact-text visibility assertion.
Mutating actions retain the native unique-target policy and never retry taps.
Selector roles follow the pinned native matcher, not snapshot display aliases.

## Suite structure

`suite.json` registers flows and composes named sections of native `.ad` files.
Actions use native agent-device commands. The typed runner supplies only the
pieces the native linear script format lacks: includes, optional guards,
whole-string text/checked assertions, bounded scroll-to-visible, and capture
parameters. It invokes command argument arrays without a shell and checks
`is.pass` explicitly: a successful command containing a false predicate fails.

Do not replay a sectioned file as one flat flow: its branches belong to the
manifest. Use `--flow <name>`. A `run` reference without a section executes only the
commands before the first `# section` marker. A file containing only named
sections must reference them explicitly; merely registering its filename does
not execute them.

The target matcher preserves whole-string regular expressions, including
trailing spaces in composer insertion assertions. A missing target is established
only by a readable capture; capture errors fail even optional steps. Selected
and checked state remain assertions, not screenshots. Native selectors perform
mutations and reject ambiguous controls. Prefer semantic controls; coordinates
are reserved for canvas gestures and bounded drags within observed content.

Target controls by `testID`, not by accessibility label. agent-device picks an
iOS snapshot backend per capture: the XCTest tree backend often moves a
control's label onto a wider container and leaves the control with only its
id, while private AX keeps the label on the control and hides its children.
Text targets are for static copy, or for asserting a label alongside an id.
`scroll down|up <amount> --in-sheet` drags inside an iPad form sheet, where
the native scroll does not reliably move the list; other devices scroll the
viewport by the same amount.

The full gate is the device acceptance and holds only core flows: a flow stays
only if it proves a core user path or a contract that unit tests cannot. Its 20
flows cover the demo tour, manual pairing, SSH, terminal interactions, the soft
keyboard, slash commands, file mentions, attachments, the git diff viewer,
settings and the Home layout, Home continue and search, notifications, custom
themes, the agent transcript, tool detail, session tree and task result, and the
personal and pad workspaces. The `git-diff` flow opens the demo checkout,
expands its six-thousand-line file, pages it with `Show more`, and refreshes --
all against the bundled fixtures, so it proves the rows and the paging rather
than anything about a real `git`. Pad-specific rail assertions execute when
the persistent Servers rail is present. Run on a tablet to verify those
branches; passing a phone suite does not prove tablet coverage. Tablet Home
retains its editorial spread when Classic is selected. Home search checks
filtering, clearing and opening a result without fixed pagination counts or
repeated popup query permutations. The keyboard flow checks the phone's
symbol pages or the tablet's wide keys, plus contextual editor actions.

Capture-only flows retain their `capture` tag and run only when requested:
`--tag capture` or `--flow <name>`. They include themes, languages, store images
and motion evidence. Some target older labels and may need updating before a new
marketing capture. `store-shot-actions` takes `--env LANG_NAME=...`,
`--env DEMO_LABEL=...`, and `--env ACTIONS_LABEL=...`.
New-task attachment-menu and draft-preservation coverage lives in
`personal-workspace`. Real agent startup, streamed responses and worktree
creation/removal require a separate paired integration check in an isolated
workspace; no offline flow claims to prove them. Obsolete live-device recordings
and disabled placeholder flows are not retained as nominal coverage.

The suite relaunches the process instead of clearing app storage. It restores
persistent preferences explicitly and never unpairs real servers. The terminal
is a Skia canvas, so assertions verify surrounding controls and the absence of
its recovery UI. Real uploads, unavailable-gateway capability cases, and some
scrollback/multitouch boundaries remain separate integration or unit coverage;
this offline suite does not pretend to exercise a real gateway.
