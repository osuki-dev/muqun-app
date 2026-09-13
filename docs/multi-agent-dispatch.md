# Multi-agent dispatch from a phone

Design for review. Nothing here is implemented. Sections marked **Reporting**
describe what exists today in Herdr, the Gateway, or the app; sections marked
**Proposal** are arguments for work we have not done.

Herdr documentation is cited by page. Every quotation was read from the pinned
source for the stable release, `v0.9.0`, which the documentation index at
<https://herdr.dev/llms.txt> resolves to
`raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/*.mdx`.
The preview index (<https://herdr.dev/llms-preview.txt>, build
`2026-09-08-62431dbd033b`) carries the same page set, so nothing in this document
is contradicted by an unreleased page.

---

## 1. The question

> What can official Herdr actually be told to do, in one sentence or one command,
> that results in several different agents being assigned different pieces of
> work, with panes created for them automatically?

**Nothing.** That command does not exist, and the documentation is explicit that
it deliberately does not exist.

---

## 2. What Herdr actually supports

### 2.1 Three primitives, and a hard separation between them

[Agent automation](https://herdr.dev/docs/agent-automation/) opens with a table
of three primitives — Layout, Pane, Agent — and then draws the line that answers
our question:

> A pane exists whether or not it contains an agent. An agent is the recognized
> process currently running inside a pane. `agent start` therefore requires an
> existing shell pane and never creates, splits, or moves layout.

The [CLI reference](https://herdr.dev/docs/cli-reference/) repeats it as a
constraint on the command:

> `agent start` activates an existing available shell pane: the pane's
> interactive shell must own the foreground, with no foreground command, editor,
> or agent running. **Topology must be created separately.**

So "panes created for them automatically" is not a Herdr behaviour at any layer.
Pane creation is a separate call the caller must make first, and it must land the
new pane at an idle interactive shell prompt before `agent start` will succeed.

### 2.2 The real shape of a fan-out: a loop the caller writes

The complete, official fan-out is the recipe in
[Agent automation](https://herdr.dev/docs/agent-automation/), which starts
exactly one agent:

```bash
split=$(herdr pane split --current --direction right --no-focus)
review_pane=$(printf '%s\n' "$split" | jq -r '.result.pane.pane_id')
herdr agent start reviewer --kind codex --pane "$review_pane" -- -m gpt-5.4
herdr agent prompt reviewer "Review the current diff" --wait --timeout 120000
herdr agent read reviewer --source recent-unwrapped --lines 120
```

Three agents on three pieces of work is that block three times, with three
distinct names, run by something that is not Herdr. There is no `agent start
--count`, no manifest of assignments, no batch method. The
[Socket API](https://herdr.dev/docs/socket-api/) method list confirms it at the
protocol level: `agent.start`, `agent.prompt`, `agent.wait`, `agent.read`,
`agent.send_keys`, `agent.rename`, `agent.focus`, `agent.get`, `agent.list`,
`agent.explain`, `agent.view.set`, `agent.view.clear`. Every one is
single-target. Nothing accepts a list.

Herdr's own summary of the workflow is a description of a human at a sidebar, not
an orchestrator ([Agents](https://herdr.dev/docs/agents/)):

> This is the main Herdr workflow: start several agents, let them work in
> parallel, and use the sidebar to see which project needs a decision, which one
> is still running, and which one is ready to review.

Herdr's contribution to multi-agent work is **aggregation and navigation**, not
dispatch.

### 2.3 The nearest thing to "one sentence": the agent skill file

There is one path where a sentence really does produce several agents in several
panes, and it is worth being precise about who executes it.

[Agent skill file](https://herdr.dev/docs/agent-skill/) documents
`skills/herdr/SKILL.md`, installed with `npx skills add herdrdev/herdr --skill
herdr -g`. With it installed, the page says an agent can:

> - split panes and run commands without stealing focus
> - wait for servers, tests, or another agent to finish
> - start helper agents in sibling panes

That is the mechanism. The sentence is addressed to **a coding agent already
running inside a Herdr pane**, and that agent runs the loop from §2.2. Herdr is
the substrate; the orchestrator is whichever agent you gave the skill to. The
skill's own frontmatter is unusually defensive about this:

> Use only when the user explicitly mentions Herdr or asks to use Herdr to
> inspect or control panes, tabs, workspaces, commands, or another agent. Do not
> use merely because a task could benefit from a background terminal, delegation,
> or parallel work. Requires `HERDR_ENV=1`.

and the skill's guardrail is that an agent without `HERDR_ENV=1` must stop and say
it is not running inside a Herdr-managed pane.

This matters to us directly: that path requires a coding agent sitting *inside*
Herdr. Our app is a client *outside* it. We cannot borrow the skill. If we want
fan-out, we issue the same primitive calls ourselves.

### 2.4 What the operator must set up first

Reporting, from the docs, in the order an operator hits them.

| Prerequisite | Source |
| --- | --- |
| A Herdr server running on the machine where the work happens. | [Concepts](https://herdr.dev/docs/concepts/) — "The server owns panes and process state." |
| The agent executables installed and on `PATH`. `--kind` only selects "Herdr's canonical interactive executable"; Herdr does not install agents. | [CLI reference](https://herdr.dev/docs/cli-reference/) |
| A shell pane per agent, at its prompt, created beforehand. | [Agent automation](https://herdr.dev/docs/agent-automation/) |
| Per-agent integrations, if you want state to be trustworthy rather than screen-guessed. `herdr integration install <agent>`. | [Agents](https://herdr.dev/docs/agents/), [Integrations](https://herdr.dev/docs/integrations/) |
| For a remote machine: normal SSH access verified first, then `herdr machine add <host> --label "..."`, run **in an interactive terminal** so Herdr can ask before installing or replacing a server. | [Connecting machines](https://herdr.dev/docs/connecting-machines/) |
| For saved-machine federation specifically: the remote server must advertise the `surface_interest` and `health_check` capabilities, or the machine shows Attention. | [Connecting machines](https://herdr.dev/docs/connecting-machines/) |
| `HERDR_AGENT=<agent>` on any sandbox/VM wrapper command, or detection misses the agent entirely. | [Agents](https://herdr.dev/docs/agents/) |

On permissions, the docs are blunt that approval is not automatable:

> Background connections never answer prompts or install, update, restart, or hand
> off a server.
> — [Connecting machines](https://herdr.dev/docs/connecting-machines/)

and for the agent's own approval dialogs, `agent prompt` refuses outright:

> If the agent is already `blocked`, it returns `agent_blocked` without sending
> terminal input; inspect the dialog and use `agent send-keys` for a deliberate
> response.
> — [Agent automation](https://herdr.dev/docs/agent-automation/)

### 2.5 "Agent working modes" do not exist

This was worth checking rather than assuming, and the answer is negative.

Herdr's **Modes** are keyboard input modes, described in
[Concepts](https://herdr.dev/docs/concepts/):

> Herdr has terminal mode, prefix mode, and navigate mode.
>
> Terminal mode sends keys to the focused pane. Prefix mode waits for one Herdr
> action after the prefix key. Navigate mode is the persistent workspace
> navigation surface.

There is no per-agent working mode, no autonomy level, no plan/execute setting, no
concurrency policy anywhere in the stable or preview page set. Searching the
complete bundle (<https://herdr.dev/llms-full.txt>) for "mode" returns the
keyboard modes, `HERDR_PROCESS_DETECTION` (`native` vs `child-groups`),
`ui.mobile_width_threshold`, and a passing reference to "short-lived UI modes" in
pane graphics. Nothing agent-behavioural.

If a card or a conversation assumes Herdr has configurable agent working modes,
that assumption should be dropped. Whatever "mode" an agent works in is the
agent's own concern, passed through as arguments after `--`.

### 2.6 Identity: what Herdr gives you, and what it does not

This is the section most load-bearing for our implementation, because Herdr's
identity model is weaker than ours and in one respect points the other way.

Herdr addresses an agent two ways, per
[Agent automation](https://herdr.dev/docs/agent-automation/):

> A pane ID such as `w1:p2` identifies the terminal location. An agent name such
> as `reviewer` is a convenient alias for the current agent in that pane. Names
> must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. **The alias
> is cleared when that agent exits, is released, or is replaced; it does not
> permanently rename the pane.**

Both are reusable handles, and both can move:

> Moving a pane to another workspace changes its workspace-qualified pane ID.
> After any `pane move`, continue with `.result.move_result.pane.pane_id` [...]
> New commands can still resolve the agent by name after the move, but a wait
> already in progress ends with `agent_not_running`.

And neither is globally unique once more than one machine is connected
([Connecting machines](https://herdr.dev/docs/connecting-machines/)):

> Workspace, tab, pane IDs, and agent names are scoped to one server. Two machines
> may both contain `w1:p1` or an agent named `reviewer`.

**There is no `instance_id` in Herdr.** The term does not appear in the socket
API, the CLI reference, or the agents pages. The closest durable thing Herdr
exposes is `agent_session`, a *read-only* projection of what an official
integration reported ([Socket API](https://herdr.dev/docs/socket-api/)):

```json
{ "agent_session": { "source": "herdr:codex", "agent": "codex", "kind": "id", "value": "..." } }
```

> If no native session reference is stored, the field is omitted.

And crucially, only some agents report one at all. The integration table in
[Agents](https://herdr.dev/docs/agents/) marks Amp, Kiro CLI, Maki, and Muse with
integration role `none`, so those agents never produce an `agent_session`.

Herdr's own answer to the identity problem is not an id but a server-side pin,
described only for waits ([Socket API](https://herdr.dev/docs/socket-api/)):

> `agent.wait` is server-owned and event-driven. It pins the resolved pane
> occupant so a replacement cannot satisfy the wait.

That pin is transient and never handed to the client.

### 2.7 The status vocabulary, and what it is not allowed to mean

Herdr states are `blocked`, `working`, `done`, `idle`, `unknown`
([Concepts](https://herdr.dev/docs/concepts/)). Three points matter for a UI that
must not lie.

**`unknown` is not success.** [CLI reference](https://herdr.dev/docs/cli-reference/):

> `unknown` means an agent is present but Herdr cannot classify it confidently,
> not that its work succeeded.

**`done` is a per-viewer read receipt, not a result.**
[Agent automation](https://herdr.dev/docs/agent-automation/):

> `idle` and `done` both mean the agent is ready for input. The CLI/API uses the
> server's seen state: `done` is idle but not yet marked seen, **explicit `pane
> focus` / `agent focus` commands mark the target seen, and reads do not.** Each
> TUI client tracks viewed completions independently, so a client's Done badge can
> differ from the CLI or another client's badge.

**Submission is not delivery, and a timeout is not non-delivery.**

> A timeout or `agent_prompt_stalled` does not prove that no input was sent. Read
> the agent before retrying to avoid submitting the same prompt twice.

Herdr's documented position is therefore identical to the rule in our
`AGENTS.md`: status is not proof of completion. We are not fighting the platform
here; we are agreeing with it.

### 2.8 Herdr already has a mobile agents list, and a way to drive it

[Socket API](https://herdr.dev/docs/socket-api/), on `agent.view.set`:

> `agent.view.set` installs one transient declarative projection for the built-in
> Agents view. The projection is reevaluated whenever agent facts or current UI
> context change. It controls the expanded and collapsed sidebar, **mobile Agents
> list**, mouse targets, indexed focus, and next/previous Agent navigation. It
> does not change `agent.list`, notifications, detection, or global attention
> counts.

The projection is a filter/sort query — `op` in `all | any | not | eq | in |
exists`, fields `status`, `workspace_id`, `tab_id`, `pane_id`, `agent`, `seen`,
`state_change_seq`, plus `{"token":"name"}` for plugin-reported metadata; sorts
including `attention` and `state_change_seq`.

"Mobile" there means Herdr's own TUI below `ui.mobile_width_threshold` (default 64
columns), reached over SSH — [How to work with Herdr](https://herdr.dev/docs/how-to-work/)
is clear that Herdr ships no mobile app:

> Herdr works on your phone without a mobile app or web dashboard. Install any SSH
> client, connect to the machine where your agents run, and start Herdr there.

That is the product we are competing with on a phone, and it is a narrow-column
TUI.

### 2.9 Two affordances we should know exist

**Worktrees.** `worktree create` "creates a Git worktree checkout, opens it as a
workspace, and groups it with the parent repo workspace"
([CLI reference](https://herdr.dev/docs/cli-reference/)). This is Herdr's real
answer to several agents on different pieces of work in one repo without them
colliding in one checkout. It is one call per agent, not a fan-out, but it is the
right unit.

**Display metadata we are allowed to write.** `pane.report_metadata` is
explicitly display-only and explicitly *not* a lifecycle authority
([Socket API](https://herdr.dev/docs/socket-api/)):

> Metadata reports are display-only. Valid metadata can override the pane title,
> displayed agent name, visible state labels, and arbitrary named tokens.
> `working`, `blocked`, `idle`, waits, notifications, and rollups still come from
> semantic state.

A report may mention at most 16 token keys; a pane may retain at most 32.

---

## 3. What we support today

Reporting. Gateway at `main` = `0804164` (v0.10.0); app at `main` = `fc4abf6`.

### 3.1 Gateway

The Gateway speaks Herdr's socket protocol directly — newline-delimited JSON over
a Unix socket, one connection per request, 30 s timeout
(`/Users/okk/.repos/muqun-gateway/src/backend/herdr.rs`). It never shells out to
the `herdr` CLI for API work.

Wired: `agent.list`, `agent.get`, `agent.prompt`, `agent.focus`, `agent.start`,
`pane.split`, `pane.read`, `pane.send_text`, `pane.send_keys`, `pane.process_info`,
`workspace.create/focus/rename/close`, `tab.create/focus/rename/close`,
`pane.focus/rename/close`, `worktree.list/open/create`, and an `events.subscribe`
stream.

Absent: `agent.wait`, `agent.read`, `worktree.remove` (we shell out to `git`
instead), `pane.send_input`, `pane.layout`, and every metadata-reporting method.

Two consequences of the absences are worth naming.

- Because `agent.wait` is not used, the Gateway reimplements readiness itself: a
  200 ms `agent.get` poll inside `timeout_ms`, with a `startup_ready` predicate
  that synthesizes its own refusal codes (`agent_name_lost`,
  `agent_kind_mismatch`, `agent_not_ready`, `agent_start_timeout`). We are not
  getting Herdr's occupant pin.
- Because `agent.prompt` is sent bare rather than with the socket API's optional
  `wait` object — which "submits the prompt and starts the wait in one request,
  avoiding a race between separate calls" — we carry our own settle/verify
  keypress state machine instead.

`instance_id` is synthesized by the Gateway, not read from Herdr
(`herdr.rs:1171-1194`):

```rust
if let Some(name) = value.get("name").and_then(Value::as_str) {
    if name.strip_prefix("muqun-").is_some_and(|token| {
        token.len() == 20 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return Some(json!([terminal, "launch", name]).to_string());
    }
}
let conversation = value.pointer("/agent_session/value").and_then(Value::as_str)?;
```

Two shapes, both keyed on Herdr's `terminal_id` rather than its pane id:
`["<terminal_id>","launch","muqun-<20 hex>"]` for an agent we started, and
`["<terminal_id>","<agent_session.value>"]` for one we discovered. Neither exists
when a discovered agent has no session integration; that agent gets
`instance_id: null` and the app drops it from the roster.

Fan-out dispatch: `POST /api/sessions/{sid}/tasks` (worktree + workspace + agent +
prompt, with a step log and a 207 for partial success) and `POST
/api/sessions/{sid}/spawn`. Both start **one** agent. There is no batch endpoint,
no server-side assignment record, and no delegation graph. The schema comment at
`main.rs:12012` is the whole server-side contribution to identity: "Opaque
identity of the ready agent conversation. Never correlate assignment history by
pane id alone."

### 3.2 App

The collaboration screen was deleted; the feature lives in the composer
(`docs/collaboration-composer.md`).

- `src/components/agent-assignment-bar.tsx` — the roster strip: a horizontal
  scroll of agent chips plus one "start a new …" chip per catalog kind.
- `src/hooks/use-composer-assignment.ts` — the write path. `assign` re-reads
  agents, verifies the chosen `instance_id` is still in that pane, and writes to
  the *fresh* target from that read. Never retries.
- `src/components/collaboration-notice.tsx` — the read path, in the terminal's
  notification column.
- `src/hooks/use-collaboration-output.ts` — the pinned snapshot. A 6 s poll flips
  a `hasNewOutput` flag; `setOutput` runs once per effect run, and re-arms only
  when the reader presses `collaboration-notice-refresh`.
- `src/stores/agent-collaboration.ts` — MMKV, id `muqun.agent-collaboration`, key
  `tasks`, capped at 40. `review` and `remove` are local-only and touch no
  network.
- `src/lib/agent-collaboration.ts` — `CollaborationTask`, `taskAgent` (matches on
  pane id **and** `agentInstanceId`), `partitionCollaborationTasks`,
  `canAssignToAgent` (`idle || done`), `collaborationAvailability`.

The target is a single slot:

```ts
export type AssignmentTarget =
  | { type: 'new'; kind: string }
  | { type: 'agent'; paneId: string; instanceId: string; name: string };
```

`useState<AssignmentTarget | null>`, and `choose` replaces on a different pick and
clears on a repeat tap. One task per send.

---

## 4. The gap

| | Herdr offers | We expose | |
| --- | --- | --- | --- |
| Start N agents | N × (`pane.split` → `agent.start` → `agent.prompt`), caller-driven | 1 per send, and `AGENT_SPAWN_SHIPPED = false` means the "new agent" chips never render | Gap |
| Isolate their work | `worktree.create` per agent | Gateway wires it behind `POST /tasks`; no app surface picks a branch per agent | Gap |
| Watch N agents | `agent.list`, `pane.agent_status_changed`, `agent.view.set` projections, sidebar rollups | `CollaborationNotice` renders `current[0]` only, plus a `· N` count | Gap |
| Read N results | `agent.read --source recent-unwrapped`, alternate-screen history paging | One pinned snapshot for one task, via `pane.read` | Gap |
| Assignment history | Not a Herdr concept | Ours, MMKV, offline, capped at 40 | We are ahead |
| Durable agent identity | Reusable pane id + clearable name alias + optional `agent_session` | Synthesized `instance_id` over `terminal_id` | We are ahead |
| Capability gating | `herdr status`; "A missing method is not permission to stop or upgrade a server" | `agent_collaboration` declared and checked — but see §5.1 | Gap |

---

## 5. Where the docs contradict an assumption we make

### 5.1 The capability we gate on is gating nothing

`AGENTS.md` requires capability detection and "an actionable upgrade
explanation." Both halves exist. Neither runs.

Gateway: `agent_collaboration` appears in exactly two places in the whole tree —
`src/main.rs:305`, inside the static `API_CAPABILITIES` array served from
`GET /api/meta`, and the v0.10.0 release notes. No handler branches on it. It is
an advertisement, not a gate.

App: `collaborationAvailability` in `src/lib/agent-collaboration.ts:74` is the
only place `agent_collaboration` is checked, and it is also the only place the
Herdr 0.9.0+ backend floor is applied. It has **no call site in `src/` outside
its own test file**. The visible gate is instead
`server-terminal-workspace.tsx:3784`:

```ts
const assignmentToggle =
  gatewaySupportsAgentSpawn(data.health?.capabilities) || assignmentCandidates.length > 0 ? (
```

and `gatewaySupportsAgentSpawn` returns `false` unconditionally because
`AGENT_SPAWN_SHIPPED = false`. So collaboration is reachable exactly when another
agent already happens to be in the session, and an operator on an old Gateway
gets an empty strip rather than an upgrade explanation.

This is the most important finding in this document. It should be fixed before
any of §6 is built, because §6 assumes a working gate.

### 5.2 "Herdr 0.9.0" means two different things

Our rule says collaboration needs a connected Herdr 0.9.0+ backend. The Gateway
does have a 0.9.0 check — `herdr_owns_prompt_submission` at `herdr.rs:1` — but it
governs something else entirely: whether Herdr owns paste-plus-delayed-Enter, and
therefore whether the legacy extra Enter keypress must be suppressed. It is
consumed only by `needs_submit_keypress`. It is not a collaboration gate, and the
Gateway enforces no collaboration gate at all. The number is shared; the meaning
is not. A reader of either codebase will assume otherwise.

Separately, the two version parsers disagree on prereleases in the same direction
but by different rules: the Gateway's rejects any core containing `-`; the app's
regex `^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$` rejects `0.9.0-rc.1` by failing to match
and falling through to `'herdr'`. Same outcome today, two implementations.

### 5.3 Opening an agent's terminal silently clears every other client's Done badge

We call `POST /api/sessions/{sid}/agents/{target}/focus`, which is Herdr's
`agent.focus`. Per [Agent automation](https://herdr.dev/docs/agent-automation/):

> explicit `pane focus` / `agent focus` commands mark the target seen, and reads
> do not.

`done` is "idle but not yet marked seen". So a reader tapping "Open terminal" on a
phone mutates shared server state: the Herdr TUI on the operator's laptop loses
its Done badge for that agent. Our read path is correctly passive — `pane.read`
does not mark seen — but our navigation path is not. Nothing in our code
acknowledges this. It is arguably the right behaviour (the reader did look), but
it is a cross-client side effect we never decided on.

### 5.4 We treat `instance_id` as durable across moves; Herdr's substrate is not

Our `instance_id` is built over `terminal_id`, which is a better choice than
`pane_id` and survives the documented `pane move` renumbering. But the launch
variant depends on Herdr's `name` alias persisting, and the docs say that alias
"is cleared when that agent exits, is released, or is replaced". The discovered
variant depends on `agent_session`, which the integration table says four
supported agents (Amp, Kiro CLI, Maki, Muse) never report. For those agents
`instance_id` is `null`, `server-terminal-workspace.tsx:2038` drops the candidate,
and they are silently unassignable. That is a correct failure, but it is invisible
— the reader sees an agent in `SessionMap` that simply cannot be chosen in the
assignment strip, with no explanation.

### 5.5 Splits will usually be refused on a phone

`can_split_agent_pane` requires `viewport_rows >= 48`, with a fallback to creating
a new tab. The Gateway sizes the terminal from the attached client, and a phone
is nowhere near 48 rows. In practice the split path is dead on the target device
and the tab path is the real one. Any fan-out design that says "split three ways"
is describing something that will not happen on the hardware this app runs on.
This is a constraint, not a bug, and §6 is built around it.

### 5.6 Our status polling is a workaround for a subscription we under-use

The Gateway subscribes to `pane.agent_status_changed` **per pane known at
subscribe time**, so a pane created afterwards is not covered — and therefore also
runs a 2 s `agent.list` poll to compensate. Herdr's event stream is richer than we
use it; the poll is the price of that. Worth revisiting independently of this
design.

---

## 6. Proposal: the mobile interaction

Everything in this section is a proposal, not a report.

The framing that matters: Herdr's fan-out is N sequential, individually
fallible, individually approvable operations, and Herdr's own mobile story is a
64-column TUI over SSH. Our advantage is not that we can do something Herdr
cannot. It is that we can make N fallible operations legible on a 6-inch screen
without the reader holding the state in their head. The design below is therefore
mostly about **honest partial failure** and **reading N things one at a time**.

### 6.1 Principle: a brief, not a broadcast

The mental model should not be "send this text to three agents." It should be:
the reader writes one **brief**, then splits it into **parts**, and each part goes
to one agent. Parts are authored, not derived. We never ask a model to split the
work for the reader, and we never send the same prompt to N agents and call it
collaboration.

This keeps the record honest: N parts produce N `CollaborationTask` records, each
bound to its own `instance_id`, each with its own outcome.

### 6.2 The composer, extended rather than replaced

`src/components/agent-assignment-bar.tsx` today is a radio group. Proposal: make
chip selection additive when the strip is in brief mode, and give
`use-composer-assignment.ts` a second target shape.

```ts
// proposed, src/hooks/use-composer-assignment.ts
export type AssignmentPart = {
  readonly id: string;
  readonly target: AssignmentTarget;   // unchanged union
  readonly text: string;
};
export type AssignmentPlan = {
  readonly shared: string;             // the brief, prepended to every part
  readonly parts: readonly AssignmentPart[];
};
```

`AssignmentTarget` stays exactly as it is. A plan is a list of the thing we
already know how to dispatch, which means `assign` keeps its per-part contract —
re-read agents, verify `instance_id`, write to the fresh target, never retry —
and gains a caller that runs it N times.

On the screen: the strip's chips become multi-select, and below the field a
compact list of part rows appears, one per chosen agent, each a single line —
agent name, a `StatusDot`, and the first line of that part's text. Tapping a row
swaps the composer field to that part. The brief itself is a separate row pinned
at the top of the list. This is one composer, not N; a phone cannot show N text
fields.

**Proposed new component:** `src/components/assignment-plan-list.tsx`, sitting
between `AgentAssignmentBar` and `TerminalComposer` in
`server-terminal-workspace.tsx`.

### 6.3 Dispatch: sequential, visible, abandonable

N parts dispatch **sequentially**, never concurrently, and the UI shows the queue
draining. Reasons, all from §2:

- `agent start` can return `agent_not_ready` when the agent is blocked at
  startup, and `agent_pane_busy` when the pane is not at a prompt. These need a
  reader, not a retry.
- `agent prompt` returns `agent_blocked` if the agent is sitting at an approval
  dialog, and our own `AGENTS.md` forbids answering trust prompts unattended.
- A timeout does not prove non-delivery, so a failed part must never be retried
  automatically.

**Proposed:** a `DispatchSheet` (`src/components/dispatch-sheet.tsx`) that is a
full-height modal for the duration of the run, showing one row per part with
exactly four terminal states, no percentages and no spinner-as-progress:

- `Queued`
- `Sending` (the only animated row, and it animates because we are actively
  awaiting a call, not because we are guessing at progress)
- `Sent` — the Gateway acknowledged the write. The label must say *sent*, never
  *started* or *done*.
- `Not confirmed` — plus the refusal code's human sentence, plus a single
  **Retry this part** button the reader presses deliberately.

A part that refuses does not stop the queue and does not cancel the parts already
sent. There is no "cancel all", because we cannot un-send a prompt; there is
"stop sending the rest", which is honest.

The existing `collaborationSpawnOutcome` already returns the right vocabulary
(`'sent' | 'attention' | 'start-failed' | 'start-unconfirmed' |
'delivery-unconfirmed'`) and should be the source of these labels rather than a
new enum.

### 6.4 Watching several agents: fix the notice before adding to it

`CollaborationNotice` renders `current[0]` and appends `· ${current.length}`. That
is already wrong for the two concurrent assignments the store can hold today; it
will be badly wrong for five.

**Proposed**, in order of value:

1. **A roster row, not a card stack.** Replace the single card's header with a
   horizontally scrollable row of small agent pills — name, `StatusDot`, and a
   dot if that task has unread new output. Tapping a pill selects which task the
   card below shows. One card at a time is correct on a phone; the row is the
   navigation.
2. **`useCollaborationOutput` per selected task, not per mounted notice.** The
   hook already scopes `output`/`hasNewOutput` to `outputTaskId` and blanks on
   change. Keep that. Polling all N pinned snapshots at 6 s would be N × `pane.read`
   every 6 s over a phone radio; poll only the selected task, and derive every
   other pill's unread dot from `state_change_seq` on the cheap `agent.list` the
   app already has. `state_change_seq` is a documented sort field and monotonic
   per agent, so "this agent has changed since you last looked at it" is
   answerable without reading any output.
3. **A group refresh that refreshes nothing by itself.** The rule is that new
   output must not replace the snapshot until the reader chooses. With N agents
   the temptation is a "refresh all" button; it should refresh only the visible
   card and clear the unread dots it can prove the reader saw — which is one.
4. **Surface `history`.** `partitionCollaborationTasks` returns `{ current,
   history }` and `collaboration-notice.tsx:40` destructures `history` away.
   "Mark reviewed" currently moves a task somewhere with no UI. Proposal: a
   `Reviewed` section behind a disclosure in the same card, offline, with
   `remove` available there. This is a prerequisite for fan-out, not a nicety —
   five tasks a day with no history view is a leak.

### 6.5 Reading results without lying

Three rules, all derived from §2.7 rather than invented.

- **Never write "completed".** The card's status line already avoids it. With N
  agents the pressure to summarize ("3 of 5 done") is much stronger, and it must
  be refused: `done` means *idle and not yet looked at*, and `unknown` explicitly
  does not mean success. A count of agents currently idle is a true sentence only
  if it says so: "3 ready for input" — not "3 done".
- **No aggregate progress, ever.** There is no denominator. A part is sent or
  not sent; an agent is working, blocked, idle/done, or unclassifiable. Any bar
  or percentage over those is fabricated.
- **Blocked is the only thing that earns attention colour.** Already true at
  `collaboration-notice.tsx:116`. With five agents, keeping that discipline is
  what makes the one blocked agent findable.

**Proposed** for the long-output problem: `agent.read` (which we do not use)
automatically pages an idle agent's alternate-screen history when `--lines`
exceeds the visible screen, and returns `agent_not_idle` while the agent is
working. `pane.read`, which we do use, gets that same behaviour only when the
pane contains such an agent. Moving the read path to `agent.read` and surfacing
`agent_not_idle` as "still working — snapshot is from HH:MM" would be both more
capable and more honest than a truncated `pane.read`. This is a Gateway change
and belongs in its own card.

### 6.6 One agent per worktree

**Proposed.** When a plan has more than one part and the session's cwd is a Git
repo, offer one toggle — *Give each assistant its own branch* — which routes each
part through `POST /api/sessions/{sid}/tasks` with a derived `branch_name` instead
of `POST /spawn`. The Gateway already wires `worktree.create` and already returns
a step log with a 207 for partial success, so the failure surface exists; the app
has no UI for it.

This is the single change that most changes what the feature is *for*. Three
agents editing one checkout is a merge conflict with extra steps; three agents in
three worktrees is the thing Herdr's `worktree create` was built for.

Constraints to respect: `worktree remove` is a destructive operation we must not
offer casually, `--trust-repository` must never be sent as an automatic retry
(the Herdr skill says so explicitly), and branch naming must be the reader's,
shown before dispatch, not generated silently.

### 6.7 Write the assignment back into Herdr

**Proposed, and cheap.** After a successful part, report display metadata so the
operator's Herdr sidebar shows what the phone dispatched:

```
pane.report_metadata { pane_id, source: "muqun:assignment", tokens: { summary: "<part title>" } }
```

This is display-only by contract — it cannot take lifecycle authority, cannot
affect waits, notifications, or rollups — and `summary` is renderable as
`$summary` in an Agent sidebar row. Limits: 16 token keys per report, 32 retained
per pane, 1–32 ASCII characters per name. It closes the loop between a phone
dispatch and a laptop TUI, which is the actual two-device workflow this feature
exists for. Needs a new Gateway method and a new capability string; it must be
capability-gated like everything else, and the app must work unchanged without
it.

### 6.8 Capability gating for all of the above

**Proposed:** one new Gateway capability, `agent_fanout`, advertised only when
the backend is Herdr *and* the Gateway will actually accept a multi-part
dispatch. The app checks it through a `collaborationAvailability` that is finally
wired to a call site. When it is absent, the strip stays single-select and the
brief-mode affordance does not render — no dead chips, and an explicit sentence
naming what to upgrade. Which is what `AGENTS.md` asked for in the first place,
and what §5.1 says we do not have today.

---

## 7. What this design does not propose

- **Automatic work splitting.** We do not ask a model to divide a brief into
  parts. The reader authors the parts.
- **Agent-to-agent messaging.** Herdr has no such primitive and neither should
  we. Agents coordinate through the repo, or they do not coordinate.
- **Cross-machine fan-out.** Only one gateway connection is open at a time, and
  Herdr's ids are per-server anyway. One plan targets one session on one machine.
- **Answering approval prompts in a batch.** `agent_blocked` is a stop, per
  Herdr's docs and our own `AGENTS.md`.
- **Any status rollup that implies completion.**

## 8. Open questions for review

1. Should §5.1 (the unwired capability gate) be its own card ahead of this work?
   This document argues yes.
2. Is §5.3 — focusing an agent from the phone clearing the laptop's Done badge —
   acceptable, or should "Open terminal" route through a read-only path?
3. Is the worktree toggle (§6.6) in scope for a first cut, or is it the second
   card?
4. Does `agent.read` (§6.5) justify a Gateway change on its own, independent of
   fan-out?

## 9. E2E note

Per `AGENTS.md`, any implementation of this design touches agent startup and task
delivery, and therefore needs the paired App → Gateway → agent check on an
isolated Herdr session and a dedicated device, with someone present to answer
trust prompts. A multi-part dispatch also needs a new native flow under
`e2e/agent-device/` registered with the `full` tag in `suite.json` in the same
change. Offline demo fixtures can prove the composer interaction and the queue
UI; they cannot prove that three assistants received three different tasks.
