# Native end-to-end tests

Run the offline app suite with agent-device **0.21.12** on a dedicated simulator or
emulator with no paired servers or saved SSH hosts. Install the app, select
English and the Osuki theme, and start Metro for development builds. Preview and
release builds include their own JavaScript bundle.

```sh
bash scripts/e2e.sh --check
bash scripts/e2e.sh --device <id> --platform ios
bash scripts/e2e.sh --smoke --device <id> --platform android
# All four QA devices in parallel (see "Parallel gate" below):
bash scripts/e2e-all.sh
E2E_ALL_ONLY="android-phone android-tablet" bash scripts/e2e-all.sh --smoke
E2E_AD_METRO_HOST=127.0.0.1 E2E_AD_METRO_PORT=8081 \
  bash scripts/e2e.sh --device <id> --platform ios
bash scripts/e2e-agent-device.sh --flow settings --device <id> --platform ios
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

## Parallel gate

`scripts/e2e-all.sh` runs the gate on the iPhone, iPad, Android phone and
Android tablet concurrently, one suite process per device. A serial run of all
four takes over an hour wall-clock (about 18 minutes per device); parallel it
is roughly one device run. Devices are discovered by their QA names on every
run -- UDIDs and emulator serials are never hardcoded -- and an unbooted QA
device is booted, never created. Each leg gets its own agent-device session
(`muqun-e2e-<name>`) and its own report directory (`dist/e2e-reports/<name>`),
so legs cannot steal sessions or overwrite evidence.

Before starting a leg, a read-only preflight opens the app and snapshots it:
a device that shows paired servers instead of the first-run demo entries is
skipped, loudly, and any skip fails the gate -- the suite must never run
against real user data, and partial coverage must never pass as full coverage.
Android legs are taken offline with `svc wifi disable; svc data disable`,
verified by an unreachable ping: the gate is an offline gate (custom-themes
asserts the catalogue's offline failure UI), and a QA emulator with a working
route would reach that assertion online. (Airplane mode alone does not sever
the emulator's virtual route.)
`E2E_ALL_ONLY="ipad android-tablet"` restricts a run to named legs.

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
manifest. Use `--flow <name>`. Standalone native scripts can use
`bash scripts/e2e-agent-device.sh e2e/agent-device/ssh-demo.ad`; the runner applies
runtime overrides to each open and reports assertion failures in the same way.

The target matcher preserves whole-string regular expressions, including
trailing spaces in composer insertion assertions. A missing target is established
only by a readable capture; capture errors fail even optional steps. Selected
and checked state remain assertions, not screenshots. Native selectors perform
mutations and reject ambiguous controls. Coordinates are reserved for the Skia
canvas gestures and the two historical motion-capture touches.

The default suite covers the demo tour, manual pairing, terminal interactions,
SSH, file mentions, attachments, artifacts, the git diff viewer, settings, away
digest, slash commands, and responsive workspace navigation. The `git-diff` flow
opens the demo checkout, expands its six-thousand-line file, pages it with
`Show more`, and refreshes -- all against the bundled fixtures, so it proves the
rows and the paging rather than anything about a real `git`. The
`large-file-preview` flow opens the three demo fixtures that sit past the sizes
the asset viewer routes on -- a 100 KB changelog, a 140 KB bundle with a
six-thousand-character line in it, and an 8 MB log -- and asserts that the first
draws headings rather than its own source, that the second draws numbered rows
under the note saying why they are not coloured, and that only the third is
refused, by a sentence naming both sizes. Pad-specific rail assertions execute when
the persistent Servers rail is present. Run on a landscape tablet to verify
those branches; passing a phone suite does not prove tablet coverage.

Capture-only flows retain their `capture` tag and run only when requested:
`--tag capture` or `--flow <name>`. They include themes, languages, store images
and motion evidence. Some target older labels and may need updating before a new
marketing capture. `store-shot-actions` takes `--env LANG_NAME=...`,
`--env DEMO_LABEL=...`, and `--env ACTIONS_LABEL=...`.
The New Task flow remains disabled, but no longer because the feature is held
back: `AGENT_SPAWN_SHIPPED` is gone and spawning is gated on the gateway's
`agent_spawn` capability, which the demo announces. `flows/new-task.ad` is an
unconverted stub -- every step targets `${TARGET}` and nothing supplies it --
so it has to be rewritten against real selectors before it can carry the `full`
tag. Disabled coverage is never reported as passed.

The suite relaunches the process instead of clearing app storage. It restores
persistent preferences explicitly and never unpairs real servers. The terminal
is a Skia canvas, so assertions verify surrounding controls and the absence of
its recovery UI. Real uploads, unavailable-gateway capability cases, and some
scrollback/multitouch boundaries remain separate integration or unit coverage;
this offline suite does not pretend to exercise a real gateway.
