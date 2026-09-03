# agent-device e2e for the SSH feature

`agent-device` is the device-automation and e2e tool for the SSH feature. Do
not drive the simulator with the `maestro` CLI for this surface; the Maestro
flows under `maestro/flows/` stay for the repo-wide gate, but new SSH coverage
is authored and replayed as native `.ad` scripts here.

## What is here

- `ssh-demo.ad` — the offline demo shell, end to end: home → the header's
  `SSH` button → the bundled demo host → the connected chrome
  (`Disconnect from Demo shell`, `Connected to demo@demo.invalid`) → one key
  from the key row (`Send Enter`) → one line through the composer (focus
  `ssh-composer-input`, type `hello`, press `Run command`) → back to the host
  list, guarded by a selector wait on `Open SSH host Demo shell`.

  The row label is `Open SSH host <label>` on both surfaces, because the list
  and the home screen draw the same `SshHostRow`.

  The composer step asserts nothing about what the canvas drew -- the
  terminal is a Skia surface with no accessibility text -- only that the
  chrome is still standing afterwards. What the demo shell answers
  (`you said: hello`) is `demo-ssh-transcript.ts`'s contract and is covered
  by its unit test.

  It needs no server, no network and no credentials: the demo host is the one
  `src/lib/demo-ssh.ts` puts on an otherwise empty host list. Nothing in the
  script is a `fill`, so there is no secret to keep out of it.

  It reaches the shell through the header's `SSH` button rather than through
  the home screen's own `SSH HOSTS` row, and that is not laziness. The home
  section lists the saved hosts, plus the demo host _while the demo gateway is
  the record in use_; on a phone that state is not reachable from the home
  screen, because the demo's way out is the workspace's back button and that
  button hangs the demo session up on its way past (`leaveDetail`, card #672).
  So a phone that has just left the demo has no demo row to tap, and a phone
  that has never entered it has no SSH section at all -- which is the point of
  the section. The home row is covered by hand on a saved host, and by the
  Pad rail's own group, which does show the demo host beside the demo
  workspace. Scripting the home row would mean adding a host through the form,
  which is four `fill`s and a password.

## Preconditions

1. A Debug build of the app installed on the simulator (`bunx expo prebuild
--platform ios`, then build the `Muqun` scheme for the simulator). There is
   no expo-dev-client in this project, so the app loads its bundle from
   whichever Metro `RCT_jsLocation` points at.
2. Metro running, e.g. `bunx expo start --port 8098`. The `open` line in the
   script carries `--metro-host 127.0.0.1 --metro-port 8098`; agent-device
   writes that into the simulator's React Native debug-server prefs before
   launch, so the port only has to match the Metro you started.
3. **No saved SSH hosts** on that install. The demo host is only offered when
   the list is empty; the hosts live in the keychain and survive a
   `clearState`, so remove them from the app (Edit → Remove host) before a
   run.
4. The iOS notification-permission alert already answered once for that
   install. A system alert hides the app's accessibility tree, and the script
   deliberately does not tap system UI.

The first-run what's-new card is _not_ a precondition: the flow dismisses it
when it is there and steps past it when it is not, so the run is the same from
a clean install as from a warm one. See the first bullet under
[Re-recording](#re-recording).

## Run it

```sh
agent-device --version                       # 0.20.10 is what this was recorded and last replayed with
agent-device replay e2e/agent-device/ssh-demo.ad --platform ios --device "muqun-home" --timeout 300000
# or as a suite entry with a JUnit report:
agent-device test e2e/agent-device/ssh-demo.ad --platform ios --device "muqun-home" \
  --artifacts-dir dist/e2e-reports/agent-device --reporter junit:dist/e2e-reports/agent-device/junit.xml
```

## Running it somewhere else

The two lines above are the flow's own defaults, spelled out: Metro on 8098,
a simulator called `muqun-home`. Nobody else's machine has both. Use the
runner, which takes those from the environment and defaults to exactly the
committed values:

```sh
bash scripts/e2e-agent-device.sh                                  # the defaults, unchanged
E2E_AD_METRO_PORT=8112 E2E_AD_DEVICE=my-sim \
  bash scripts/e2e-agent-device.sh                                # your Metro, your simulator
bash scripts/e2e-agent-device.sh --test                           # ... with the JUnit report
bash scripts/e2e-agent-device.sh e2e/agent-device/ssh-demo.android.ad
```

Which knob needs which mechanism is not obvious, and all three were checked
against agent-device 0.20.10 rather than assumed:

- **Device and platform are already overridable.** `--device` / `--platform`
  on `replay` and `test` win over the script's `context` line, which is
  recorded metadata rather than a binding. A script whose `context` reads
  `device="muqun-home"` replays on `muqun-polish` when `--device` says so.
- **The Metro port is not.** `--metro-host` / `--metro-port` are session
  hints and do not reach a scripted `open`; the port that gets written into
  the simulator's React Native debug-server prefs is the one on the `open`
  line _inside_ the script. Passing `--metro-port 8112` to `replay` while the
  script's `open` line carries no port at all launches the app onto "No
  script URL provided".
- **`${NAME}` interpolation does not help here.** agent-device's `--env
NAME=value` substitution is for `fill`/`type` values -- the secret-safe
  `--record-as` mechanism -- and is not applied to command flags.
  `--metro-port "${METRO_PORT}"` with `--env METRO_PORT=8112` reaches the
  daemon unresolved and lands on the same "No script URL provided" screen.

So `E2E_AD_METRO_PORT` is applied by rendering the flow: the runner copies the
script to a temp file with the port substituted on the `open` line and replays
that (`replay` reads its script on the caller's machine, so a temp copy is a
first-class input). With no `E2E_AD_METRO_*` set it replays the committed file
untouched. That is why `ssh-demo.ad` still carries a literal `8098` -- the raw
`agent-device replay` invocations above keep working, and a re-recording does
not have to remember a placeholder.

`--device` takes the simulator's _name_ as `agent-device devices --platform ios`
prints it, not its UDID.

The script has no terminal `close` (that is how `session save-script`
publishes), so `replay` leaves the session and its daemon alive and prints the
`--state-dir`/`--session` to reach it; `test` cleans up after itself. Its
`takeScreenshot`-free steps write nothing into the worktree.

`replay` and `test` run in their own daemon. If an interactive agent-device
session has the same simulator's runner retained (the usual state after an
`open … ; close`), they fail with "iOS runner … is already owned by another
agent-device daemon"; run `agent-device daemon stop --clean` first.

## Re-recording

```sh
agent-device open dev.osuki.muqun --platform ios --device "muqun-home" \
  --metro-host 127.0.0.1 --metro-port 8098 --relaunch \
  --save-script=e2e/agent-device/ssh-demo.ad
# … press/wait with selectors (never bare @refs), fix app state with --no-record …
agent-device wait 'role=button label="Open SSH host Demo shell"'   # the destination guard
agent-device session save-script --force
```

Keep the final step a selector-targeted `wait` on a labeled landmark: that is
what `session save-script` uses as the destination guard, and a duration wait
or a `wait @ref` is not accepted as one. Never record a real password without
`--record-as` (see `agent-device help scripting`).

Five edits were made to the published script by hand, and a re-recording will
need them again:

- A `press` that dismisses the what's-new card, right after the first `wait`.
  On a genuinely fresh install the card is drawn over the top of the home
  screen and it swallows the tap meant for the header's `SSH` button: the run
  then timed out at the host-list guard having never left home, and it only
  ever passed on a device that had dismissed the card on some earlier run --
  which made this gate green for the wrong reason. `.ad` has no conditional
  step and the card shows once per changelog per install, so the step is
  written to be right in both states: the `||` chain presses
  `Dismiss what's new` when the card is up, and otherwise falls through to the
  home screen's own tagline, which is a static text and answers a tap with
  nothing. `Your agents, anywhere.` is a safe fallback precisely here, because
  the flow already waits for `Try the demo` and both belong to the same empty
  home state.
- A `wait "text" "Try the demo"` right after `open`. Without it the first
  `press` fires while the splash screen is still up (the bundle is still
  loading from Metro), and the recorded selector `wait` that used to sit
  there did not survive replay for the reason below.
- A `wait "stable" 800 10000` after every `press`. The recording was driven
  with `press … --settle`, but `--settle` is a CLI flag, not `.ad` syntax
  (the parser reads it as a selector term and fails), and the published line
  drops it. Without a settle the next `press` resolves its target while the
  screen is still sliding in and taps a stale position; the run then times
  out waiting for the connected chrome while still on the host list.
- The composer steps (`press "id=\"ssh-composer-input\""`, `type "hello"`,
  `press … "Run command"`) were written in by hand after the `Send Enter`
  step rather than recorded: `type` records as the keystrokes it sent, and
  the field is best addressed by its test id, which the recorder does not
  prefer over the label. The `wait "stable"` after the field press is what
  gives the system keyboard time to finish rising before the text goes in.
- The `# agent-device:target-v1 {…}` comment lines were removed. They pin each
  step to the accessibility ancestry seen while recording, and iOS does not
  report this app's tree in one stable shape: a capture right after launch
  puts the header buttons directly under the application node, later captures
  wrap them in `[other]` containers, and agent-device falls back to a second
  snapshot backend on the busier screens. Every replay failed on that
  ancestry check (`identity-mismatch: ancestry[0] recorded=application/Muqun
observed=other/SSH`) while the selector itself matched exactly one element.
  Without the comments the steps resolve by selector, which is what the labels
  are for.

## Android

`ssh-demo.ad` is an iOS script: agent-device gates suite selection on the
`context platform=…` line, `${VAR}` interpolation is not applied to it, and
removing the line makes `--platform android` match nothing. So Android gets its
own copy, `ssh-demo.android.ad`, which differs in exactly three places and is
otherwise the same script:

- the `context` line names `platform=android`, an emulator, and the AVD;
- the `open` line passes `--platform android` and the Android Metro port;
- the first `wait` is given 120 s, because a cold `--relaunch` on an emulator
  spends most of a minute starting the app and pulling the bundle.

Every other step -- the selectors, the what's-new dismissal, `Send Enter`,
`id="ssh-composer-input"`, `type "hello"`, `Run command` and the destination
guard -- runs unchanged on Android. When you edit one script, edit both: they
are deliberately line-for-line the same so a diff shows only those three
lines.

Run it with the device name your AVD reports to `agent-device devices`:

```sh
agent-device test e2e/agent-device/ssh-demo.android.ad --platform android --device "<your avd>"
```
