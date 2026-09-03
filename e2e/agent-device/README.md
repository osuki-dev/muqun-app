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

## Run it

```sh
agent-device --version                       # 0.20.10 is what this was recorded and last replayed with
agent-device replay e2e/agent-device/ssh-demo.ad --platform ios --device "muqun-home" --timeout 300000
# or as a suite entry with a JUnit report:
agent-device test e2e/agent-device/ssh-demo.ad --platform ios --device "muqun-home" \
  --artifacts-dir dist/e2e-reports/agent-device --reporter junit:dist/e2e-reports/agent-device/junit.xml
```

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

Four edits were made to the published script by hand, and a re-recording will
need them again:

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
