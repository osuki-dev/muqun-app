# Maestro e2e flows

End-to-end flows for the Muqun app, driven entirely through **offline demo mode**
so they need no gateway, no network, and no real pairing — safe to run locally or
in CI.

## Run

Install [Maestro](https://maestro.dev), boot one simulator or emulator, install
the app on it, and use the repo's runner:

```sh
bash scripts/e2e.sh                      # everything tagged `full`
bash scripts/e2e.sh --smoke              # the fast subset
bash scripts/e2e.sh --device emulator-5554
```

The runner picks the single booted device, refuses to guess when more than one is
connected, writes a JUnit report to `dist/e2e-reports/junit-<tag>.xml` with the
run's screenshots and view hierarchies beside it, and exits non-zero if any flow
fails. A single flow can still be run directly:

```sh
maestro --device <id> test maestro/flows/demo-tour.yaml
```

For a **dev build** the Metro bundler must be running (`bun expo start`); a
**release/preview build** embeds the JS bundle and needs neither Metro nor the
LogBox handling the flows include.

## Tags

| tag     | what it covers                                                                      |
| ------- | ----------------------------------------------------------------------------------- |
| `smoke` | `demo-tour` only — the app boots, enters demo mode, reaches every top-level screen. |
| `full`  | every flow. This is the promote-time gate (see AGENTS.md).                          |

A flow that is not tagged `full` is a flow the gate does not enforce.

## Flows

- `flows/demo-tour.yaml` — clears state, enters demo, and tours the terminal,
  quick actions, panels sheet, a second pane, and Settings, taking a screenshot
  at each step. The screenshots land under the run's `takeScreenshot/shots/`
  artifacts.
- `flows/terminal-interactions.yaml` — panning the Skia canvas, switching panes
  on a live canvas, re-laying the grid out at a different cell size, and the
  scroll chrome.
- `flows/attachments-ui.yaml` — the paperclip is correctly absent in demo mode,
  and the popup-over-the-composer behaviour the attachment menu is built on.
- `flows/artifacts.yaml` — the Artifacts list in the panels sheet and all three
  asset-viewer branches (markdown, text, no-preview).
- `flows/settings.yaml` — section inventory, both segmented controls round
  tripped, and a setting surviving a relaunch.

`subflows/` holds the pieces the flows share (`launch-home`, `open-demo`,
`dismiss-logbox`). It is deliberately outside the `flows/*.yaml` glob in
`config.yaml`: anything the glob matches is executed as a top-level flow, and a
guard has no meaning on its own.

## Notes

- The terminal is a Skia canvas and is **not** in the accessibility tree, so
  steps assert on the chrome around it and on the absence of the
  `TerminalBoundary` error state rather than on terminal text.
- Controls are addressed by their accessibility label wherever one exists. A
  percentage point silently lands on whatever the layout moved into that spot,
  so points are a last resort (currently only the LogBox banner's unlabelled
  close control).
- On Android **gesture navigation** a swipe starting at the left screen edge is
  the system Back gesture. The drawer is therefore always opened with its
  hamburger button, never with an edge swipe (card #564).
- A dev build's LogBox banner reappears on every new warning and swallows the
  next tap, so `subflows/dismiss-logbox.yaml` runs defensively before
  tap-sensitive steps. It is a no-op on release builds.
- On a **fresh install** the flows decline the notification-permission prompt and
  dismiss the in-app "What's new" card.
- Some behaviour genuinely cannot be reached offline — real attachment uploads,
  and the "↓ Latest" / "Pull for earlier output" chrome, which needs a pane with
  more scrollback than the bundled demo has. Those cases are written out in
  comments in the flow that owns them rather than faked; a flow that silently
  passes when its precondition is missing is worse than no flow.
- Store screenshots for the website/listings are composed separately with the
  app-store-screenshots editor; these flows are for testing (and quick raw
  captures), not the final marketing art.
