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

## 1. The question, and the short answers

Someone tells a coding agent that is already running inside a Herdr pane, in one
sentence, to create several panes and put a different agent in each. Two things
were asked about that.

**Is the pane creation a capability of Herdr itself, or does it come from the
skill file?**

It is Herdr's, entirely. The skill file adds no capability whatsoever. An agent
inside a Herdr pane can already run `herdr pane split` and `herdr agent start`
the moment it is launched, with nothing installed, because the pane process
inherits `HERDR_ENV=1` and a `herdr` binary on `PATH` that is already bound to
that session's socket. The skill is a Markdown instruction file: it tells the
agent which commands exist, in what order, and which mistakes to avoid. Remove
the skill and the agent retains every ability and loses only the knowledge. §2.3
settles this line by line.

**Does our app already show the panes and agents that this produces?**

Partly, and better than expected. If the reader is looking at the terminal
workspace, in the foreground, at the tab that was split, three new panes appear
as three new chips in the pane strip about 250 ms later, and the three agents
enter the assignment roster automatically. The visible terminal does not move,
which is correct. What is missing is everything outside that narrow case: panes
in another tab or workspace get no chip, the panels sheet is a one-shot load, the
home-screen mirror can be hours stale, nothing announces any of it, and the app
never represents the layout — three side-by-side panes are indistinguishable from
three unrelated ones. §4 is the full accounting.

The original framing of this research — whether one Herdr command could fan work
out to several agents — is answered in §2.2, and the answer is no. But that was
the wrong question to lead with, because nobody needs our app to issue such a
command. The sentence goes to an agent, and the agent runs the loop.

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

### 2.3 The boundary: Herdr capability versus skill file

This is the section the rest of the document rests on. The claim is that the
skill is prompting, not plumbing, and the docs settle it four ways.

#### 2.3.1 What an agent inside a pane has before anything is installed

Herdr injects its own variables into every managed pane process. The
[CLI reference](https://herdr.dev/docs/cli-reference/) environment table:

> | `HERDR_ENV` | Set to `1` inside Herdr-managed pane processes. |
> | `HERDR_PANE_ID` | Public pane id for the running pane process. |
> | `HERDR_TAB_ID` | Public tab id for the running pane process. |
> | `HERDR_WORKSPACE_ID` | Public workspace id for the running pane process. |
> | `HERDR_SOCKET_PATH` | Low-level socket path override. |

[Integrations](https://herdr.dev/docs/integrations/) says the same from the other
direction, and adds the binary path:

> An agent running in a Herdr pane inherits `HERDR_ENV`, `HERDR_PANE_ID`,
> `HERDR_BIN_PATH`, and `HERDR_SOCKET_PATH`.

The same page notes these are not advisory hints the process can be tricked out
of ([CLI reference](https://herdr.dev/docs/cli-reference/) on `--env`):

> Herdr-managed variables such as `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`,
> `HERDR_ENV`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID` [...] stay
> authoritative when they conflict with caller-provided env.

And the `herdr` binary in that environment is already bound to the right session.
`SKILL.md` itself, describing the ambient situation rather than anything it
provides:

> When the check passes, the `herdr` binary in `PATH` talks to the current
> session. Use it to inspect neighboring work, create terminal layout, start
> agents and commands, read output, and wait for state changes.

So: **`pane split` and `agent start` are reachable to any process in a Herdr pane
purely because it is in a Herdr pane.** Nothing has to be installed. Nothing has
to be enabled. Both are ordinary subcommands of a binary on `PATH`, documented in
the public [CLI reference](https://herdr.dev/docs/cli-reference/) with no
precondition beyond a running server and a pane at its shell prompt.

The one install step that does exist — `herdr integration install <agent>` — is
about detection, not control. [Agents](https://herdr.dev/docs/agents/): "Install
the integration for each agent you use to give Herdr hook or plugin reports
instead of screen detection alone." It improves the accuracy of the agent's
*status*; it grants nothing.

#### 2.3.2 What the skill file adds

Instructions. The [Agent skill file](https://herdr.dev/docs/agent-skill/) page
says so in as many words:

> Install that file into any coding agent that supports reusable skills or custom
> instructions. **The skill teaches the agent how to control Herdr from inside a
> Herdr pane.**

> The skill **tells** an agent to use the `herdr` CLI when `HERDR_ENV=1` is set.
> That means the agent is running inside a Herdr-managed pane and can safely talk
> to the local Herdr socket.

> **The skill is a Markdown instruction file for agents.** If Herdr is already
> installed, run `herdr --skill` to print the release-matched copy bundled with
> that binary.

Note what the second quotation actually asserts: the agent "can safely talk to
the local Herdr socket" *because it is in a pane*, and the skill's contribution is
to tell it so. The capability is stated as a property of the location; the skill
is the messenger.

The page's bullet list — "split panes and run commands without stealing focus",
"start helper agents in sibling panes" — is a list of things the agent will now
*know to do*, not things it becomes *able* to do. The
[Socket API](https://herdr.dev/docs/socket-api/) makes the layering explicit:

> | Agent skill | Teaching a coding agent how to use Herdr from inside a pane. |
> | CLI wrappers | Shell scripts, simple orchestration, and human debugging. |
> | Raw socket API | Custom tools, protocol clients, and event subscribers. |
>
> **The layers share the same control surface.**

Three layers, one surface. The skill is not a fourth capability sitting above the
CLI; it is a way of reaching the same surface. And it ships no runtime: it is
installed by `npx skills add herdrdev/herdr --skill herdr -g` into the agent's own
instruction system, or, for "agents without a skill system", by pasting "the file
into the agent's project or user instructions."

What the skill genuinely does change is **behaviour quality**, and that is not
nothing. Without it, an agent has to discover `herdr --help`, guess at pane
geometry, and will probably steal the reader's focus, predict ids instead of
parsing them from JSON, retry an ambiguous prompt, or answer an approval dialog
it should have escalated. `SKILL.md` spends most of its length on exactly those
failure modes — "Use `--no-focus` for background work unless the user asked to
switch context", "Parse IDs from JSON responses. Do not derive them from sidebar
order", "A timeout or stalled response does not prove the prompt was never
delivered; do not blindly submit it again". The skill is a competence and safety
upgrade. It is not an authorisation or an API.

It also *narrows* what the agent will do. The frontmatter is a restriction, not a
grant:

> Use only when the user explicitly mentions Herdr or asks to use Herdr to
> inspect or control panes, tabs, workspaces, commands, or another agent. Do not
> use merely because a task could benefit from a background terminal, delegation,
> or parallel work. Requires `HERDR_ENV=1`.

#### 2.3.3 Is there an authorisation layer?

**No authorisation layer is documented anywhere.** This is a plain reading, and
where the docs are silent this section says so rather than inferring.

The [Socket API](https://herdr.dev/docs/socket-api/) documents the transport and
the socket paths in full and never mentions authentication, authorisation,
tokens, capabilities-per-caller, or a permission model:

> Herdr uses newline-delimited JSON over a local socket. On Unix, that socket is
> a Unix domain socket. On Windows, it is a named pipe.

> The default socket lives under your Herdr config directory. Named sessions have
> separate sockets:
> `~/.config/herdr/herdr.sock`
> `~/.config/herdr/sessions/<name>/herdr.sock`

The resolution order is `--session`, then `HERDR_SOCKET_PATH`, then
`HERDR_SESSION`, then the default socket. That is addressing, not access control.
No request example anywhere in the page carries a credential; the minimal request
is `{"id":"req_1","method":"ping","params":{}}`.

So on the evidence available: any process that can open that socket file can
drive `pane.split` and `agent.start`. The effective boundary is filesystem
reachability of a Unix socket under the user's own config directory — which is to
say, the user's own account. **The docs do not state this as a security model,
and they do not state socket file permissions either.** If that boundary matters
for a deployment decision, it needs to be verified against the implementation,
not read off the documentation.

Two things that look like gates and are not:

- **`HERDR_ENV=1`** is an indicator Herdr sets, per the CLI reference table
  above. It is not checked by the server. The skill's guardrail is self-imposed
  on the agent, and the [Agent skill file](https://herdr.dev/docs/agent-skill/)
  page words it as advice: "if `HERDR_ENV=1` is not set, the agent **should** stop
  and say it is not running inside a Herdr-managed pane." A process that ignores
  the convention is not stopped by anything.
- **`--trust-repository`** is real but narrow. It exists only because "Git
  rejects repositories owned by another user by default", and it "grants
  per-request Git trust" for worktree commands. It gates Git, not Herdr.

The nearest thing to a gate in the whole control surface is a *refusal* rather
than a permission: `agent prompt` returns `agent_blocked` and sends nothing when
the target agent is sitting at an approval dialog
([Agent automation](https://herdr.dev/docs/agent-automation/)). That protects the
agent being addressed, not the session being controlled.

#### 2.3.4 Summary of the boundary

| | Comes from Herdr | Comes from the skill |
| --- | --- | --- |
| `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH` in the pane | Yes | — |
| `herdr` on `PATH`, bound to this session | Yes | — |
| `pane split`, `agent start`, `agent prompt`, `agent wait`, `agent read` | Yes | — |
| Reaching the socket without a credential | Yes (no gate documented) | — |
| Knowing those commands exist and their order | — | Yes |
| Not stealing the reader's focus; parsing ids from JSON; not re-sending an ambiguous prompt; escalating an approval dialog | — | Yes |
| A restriction on when to engage Herdr at all | — | Yes |
| Any new endpoint, permission, or runtime | — | **No** |

One consequence for us. Because the capability is ambient and the skill is only
instructions, an agent our app starts through the Gateway has the same powers as
one a human started, whether or not anyone installed a skill into it. If a reader
dispatches "split three panes and start three agents" from the phone as ordinary
prompt text, and the receiving agent happens to have the Herdr skill, it will
work — and our app will find out about the result only through the pane list, with
no record that it was asked. §4.5 covers what that looks like on screen.

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

## 4. Does our app already show panes Herdr creates?

Reporting. This is the second question, and it has a more encouraging answer than
the first: the plumbing largely exists, because it was built for panes the reader
creates, and it does not care who created them.

The scenario throughout: an agent inside Herdr splits three panes and starts
three agents in them, while a reader has the phone in hand.

### 4.1 How panes reach the phone at all

Panes are not streamed as a live model. The app fetches a flat snapshot —
`src/lib/workspace-snapshot.ts:53-59` issues four parallel REST calls:

```ts
const [workspaces, tabs, panes, agents] = await Promise.all([
  gatewayTransport.loadWorkspaces(sessionId),
  gatewayTransport.loadTabs(sessionId),
  gatewayTransport.loadPanes(sessionId),
  gatewayTransport.loadAgents(sessionId),
]);
```

and re-fetches it on three triggers, in `src/components/server-terminal-workspace.tsx`:

| Trigger | Latency | Site |
| --- | --- | --- |
| A structural SSE event, debounced | ~250 ms | `:1297-1310` |
| Slow poll, as a backstop for a missed event | 12 s | `:1263` |
| SSE (re)connect, and screen regaining navigation focus | immediate | `:2992-3000`, `:1102-1104` |

The SSE subscription is in `src/hooks/use-pane-events.ts`, and it already includes
everything this scenario emits: `pane.created`, `pane.closed`, `pane.moved`,
`pane.exited`, `pane.agent_detected`, `pane.agent_status_changed`, plus the tab
and workspace lifecycle events (`:47-62`). Frames arrive under the SSE name
`herdr` with the inner event in underscore form, and anything that is not
`pane_updated` falls through to `onStructureChanged()` (`:161-163`).

Two gates matter. Both the poll and the stream are conditioned on `appActive`
(`:1246`, `:2945`), so a backgrounded app learns nothing until it returns. And
`layout_updated` is **deliberately not subscribed** — the module comment at
`use-pane-events.ts:14-22` says the raw Herdr feed "is dominated by focus and
layout churn a phone has no use for". That decision is the direct cause of §4.4.

### 4.2 What the reader sees, automatically

**The pane strip grows.** `paneChips` (`server-terminal-workspace.tsx:4069-4093`)
is derived from `tabPanes`, and the strip appears once a tab has more than one
pane (`src/lib/dock-presentation.ts:281`: `paneChips: dockRows && !virtualKeyboard
&& paneCount > 1`). Three splits into the visible tab produce three new chips
about 250 ms later, with no user action.

**The assignment roster grows.** `assignmentCandidates`
(`server-terminal-workspace.tsx:2008-2041`) is a `useMemo` over `data.agents` and
`data.panes`, so it re-derives on the same refresh. The three new agents become
assignable as soon as the Gateway reports them **with an `instance_id`** — the
memo ends with `candidate.instanceId ? [candidate] : []`.

**The visible terminal does not move.** `src/lib/workspace-selection.ts:29-51`
prefers what the reader already had:

```ts
const pane =
  panes.find((item) => item.id === current.paneId) ??
  panes.find((item) => Boolean(item.raw.focused)) ??
  panes.find((item) => field(item, 'agent').length > 0) ??
  panes[0];
```

Because the reader's pane still exists, the `focused` fallback — which Herdr has
just moved to a new pane — is never consulted. This is exactly the
`AGENTS.md` rule about not navigating the reader's terminal, and it holds. Only
explicit acts move the selection: tapping a chip, picking in the panels sheet,
tapping a push notification, or the workspace/tab swipe gestures.

### 4.3 What the reader does not see

- **Panes outside the visible tab get no chip.** `tabPanes` is
  `data.panes.filter((item) => field(item, 'tab_id') === selection.tabId)`
  (`:1362-1365`). An agent that splits into another tab, or creates a tab or
  workspace of its own — which the Herdr skill explicitly permits when asked —
  is invisible on the terminal screen.
- **The panels sheet is a one-shot load.** `src/components/session-map.tsx` does
  its own fetch of all four lists (`:190-219`) under
  `useEffect(() => { void load(); }, [load, t])` (`:221-223`). No SSE, no poll.
  It *will* list brand-new panes in every tab and workspace — but only if opened
  or pull-to-refreshed after they exist. A sheet left open goes stale silently.
- **The home-screen mirror lags arbitrarily.** `recordServerAgents` is written
  only by the open workspace screen (`server-terminal-workspace.tsx:1634-1641`),
  so new agents reach a server card only after the reader next opens that
  server. `SERVER_AGENTS_STALE_AFTER_MS` is 5 minutes
  (`src/lib/server-agents.ts:144`), after which rows dim and statuses stop being
  presented as current. The module header says it outright: "this is a mirror,
  not a query."
- **Nothing announces any of it.** There is no toast, pill, or banner fired from
  `onStructureChanged`. In-app notices come only from push payloads
  (`src/lib/notifications.ts:43`), which the Gateway raises for `→ blocked` and
  `working → idle` transitions, not for pane creation. The approval banner is
  scoped to the selected pane only (`src/hooks/use-pane-approval.ts:52`), so an
  agent blocking in one of the three new panes produces nothing on screen unless
  a push arrives. `pane.agent_detected` is consumed purely as "refresh the
  lists".

### 4.4 The app has no concept of layout

This is the largest structural gap, and it is a deliberate one.

There is no `layout`, split, geometry, or row/column field anywhere in the
gateway entity layer, and `layout_updated` appears nowhere in `src/`. Exactly one
terminal is ever mounted — a single `PaneChatView` or a single
`TerminalBoundary`/`TerminalPanel` keyed on `selection.paneId`
(`server-terminal-workspace.tsx:4310`, `:4329-4412`). The panels sheet renders
panes as a flat list grouped by tab, and its own module doc notes that indices are
"positions in these lists rather than anything the gateway sends".

So three panes split side by side read on the phone as three interchangeable
chips. A reader cannot tell them from three panes stacked vertically, or — once
they are in the panels sheet — from three panes that have nothing to do with each
other. The app shows *membership*, never *arrangement*.

For a phone this is close to the right call. A 6-inch screen cannot usefully draw
a three-way split, and mirroring Herdr's geometry would buy nothing. But it means
the app cannot represent "these three were spun up together for one brief", which
is precisely the relationship a fan-out creates. §7 proposes grouping by
assignment rather than by geometry for that reason.

### 4.5 The honest summary

| Surface | Shows the three new panes? | When |
| --- | --- | --- |
| Pane strip, same tab, screen open and foregrounded, keyboard down | Yes | ~250 ms; ≤12 s if the stream dropped |
| Pane strip, panes in another tab or workspace | No | — |
| Visible terminal | Unchanged, correctly | — |
| Assignment roster | Yes, if `instance_id` is present | Same as the strip |
| Panels sheet | Yes, all tabs and workspaces | Only on open or pull-to-refresh |
| Home-screen server card | Only after the reader next opens that server | Up to hours; dimmed after 5 min |
| Layout / adjacency | Never | — |
| Any announcement | None from the app | — |
| App backgrounded | Nothing updates | Until foreground |

The one-line version: **we already show the panes and the agents; we do not show
that anything happened.** A reader who is looking gets a live, correct list. A
reader who is not looking finds out by scrolling a strip that silently grew.

---

## 5. The gap

| | Herdr offers | We expose | |
| --- | --- | --- | --- |
| Start N agents | N × (`pane.split` → `agent.start` → `agent.prompt`), caller-driven | 1 per send, and `AGENT_SPAWN_SHIPPED = false` means the "new agent" chips never render | Gap |
| Isolate their work | `worktree.create` per agent | Gateway wires it behind `POST /tasks`; no app surface picks a branch per agent | Gap |
| See N new panes exist | `pane.created` / `pane.agent_detected` events, sidebar | Pane strip and assignment roster, live in ~250 ms — **but only for the visible tab**, and silently | Mostly there |
| Notice that they appeared | Sidebar rollups: "A blocked agent makes its pane, tab, and workspace look blocked" | Nothing. No toast, no badge, no rollup above pane level | Gap |
| See how they are arranged | Real split geometry in the TUI | No layout model at all; one pane mounted at a time | Deliberate, see §4.4 |
| Watch N agents' progress | `agent.list`, `pane.agent_status_changed`, `agent.view.set` projections, sidebar rollups | `CollaborationNotice` renders `current[0]` only, plus a `· N` count | Gap |
| Read N results | `agent.read --source recent-unwrapped`, alternate-screen history paging | One pinned snapshot for one task, via `pane.read` | Gap |
| Assignment history | Not a Herdr concept | Ours, MMKV, offline, capped at 40 | We are ahead |
| Durable agent identity | Reusable pane id + clearable name alias + optional `agent_session` | Synthesized `instance_id` over `terminal_id` | We are ahead |
| Capability gating | `herdr status`; "A missing method is not permission to stop or upgrade a server" | `agent_collaboration` declared and checked — but see §6.1 | Gap |

---

## 6. Where the docs contradict an assumption we make

### 6.1 The capability we gate on is gating nothing

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

This is the most important finding about our own code in this document. It should
be fixed before any of §7 is built, because §7 assumes a working gate.

### 6.2 "Herdr 0.9.0" means two different things

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

### 6.3 Opening an agent's terminal silently clears every other client's Done badge

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

### 6.4 We treat `instance_id` as durable across moves; Herdr's substrate is not

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

### 6.5 Splits will usually be refused on a phone

`can_split_agent_pane` requires `viewport_rows >= 48`, with a fallback to creating
a new tab. The Gateway sizes the terminal from the attached client, and a phone
is nowhere near 48 rows. In practice the split path is dead on the target device
and the tab path is the real one. Any fan-out design that says "split three ways"
is describing something that will not happen on the hardware this app runs on.
This is a constraint, not a bug, and §7 is built around it.

### 6.6 Our status polling is a workaround for a subscription we under-use

The Gateway subscribes to `pane.agent_status_changed` **per pane known at
subscribe time**, so a pane created afterwards is not covered — and therefore also
runs a 2 s `agent.list` poll to compensate. Herdr's event stream is richer than we
use it; the poll is the price of that. Worth revisiting independently of this
design.

---

## 7. Proposal: the mobile interaction

Everything in this section is a proposal, not a report.

The framing that matters: Herdr's fan-out is N sequential, individually
fallible, individually approvable operations, and Herdr's own mobile story is a
64-column TUI over SSH. Our advantage is not that we can do something Herdr
cannot. It is that we can make N fallible operations legible on a 6-inch screen
without the reader holding the state in their head. The design below is therefore
mostly about **honest partial failure** and **reading N things one at a time**.

§4 narrows the work considerably, and reviewers should read it before costing
any of this. The fetch-and-display plumbing already exists and already handles
panes it did not create: the strip, the roster, and the selection rule are all
correct today. What is missing is not data but **relationship and salience** —
the app cannot say that three panes belong to one brief, and it cannot say that
anything changed while the reader was elsewhere. Every proposal below should be
read as adding one of those two, not as building a pane list we already have.

### 7.1 Principle: a brief, not a broadcast

The mental model should not be "send this text to three agents." It should be:
the reader writes one **brief**, then splits it into **parts**, and each part goes
to one agent. Parts are authored, not derived. We never ask a model to split the
work for the reader, and we never send the same prompt to N agents and call it
collaboration.

This keeps the record honest: N parts produce N `CollaborationTask` records, each
bound to its own `instance_id`, each with its own outcome.

### 7.2 The composer, extended rather than replaced

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

### 7.3 Dispatch: sequential, visible, abandonable

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

### 7.4 Watching several agents: fix the notice before adding to it

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

### 7.5 Reading results without lying

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

### 7.6 One agent per worktree

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

### 7.7 Write the assignment back into Herdr

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

### 7.8 Agents that appear without us asking

**Proposal, and this one is new information from §2.3.** Because the capability
is ambient, an agent inside Herdr can split panes and start agents whether or not
our app was involved. A reader who sends "split three panes and start three
agents on these three files" as ordinary composer text to a skill-equipped agent
will get exactly that — and our app will have no `CollaborationTask` for any of
it. The three agents will simply turn up in the strip and the roster.

We should not try to prevent this, and we cannot detect intent. But the app
currently cannot distinguish "an agent I dispatched" from "an agent that
appeared", and after a fan-out that distinction is the whole story.

Proposed, in `src/lib/agent-collaboration.ts`: treat an agent with no matching
task as a first-class state — *unattributed* — rather than an absence. In the
roster pill row from §7.4, an unattributed agent shows with a neutral glyph and
no task card; tapping it offers "Open terminal" and nothing else. That is honest,
costs one predicate, and stops the reader assuming the five pills they see
correspond to the two parts they sent.

The related read, per §4.3, is that an agent doing this may well split into a new
**tab**, which the strip does not show at all. Proposed: when
`data.panes` contains panes whose `tab_id` is not `selection.tabId` and which
gained an agent since the last refresh, show a single quiet affordance at the end
of the pane strip — "2 elsewhere" — that opens the panels sheet. Not a
notification, not a navigation, and not a count of anything we cannot prove.

### 7.9 Make the panels sheet live, or say that it is not

**Proposal, small and independent of everything else.**
`src/components/session-map.tsx` loads once per mount and never updates. During a
fan-out it is the only surface that shows every new pane, and it is precisely
then that it will be wrong. Two honest options:

1. Subscribe it to the same `onStructureChanged` debounce the workspace screen
   uses, so it tracks. Preferred.
2. If that is too costly while the sheet is open over a live terminal, stamp it
   with the time it was loaded and keep the pull-to-refresh, the way
   `ServerAgentRows` already dims and labels a stale mirror.

What it must not keep doing is presenting a five-minute-old list as current
during the one operation that changes it fastest.

### 7.10 Capability gating for all of the above

**Proposed:** one new Gateway capability, `agent_fanout`, advertised only when
the backend is Herdr *and* the Gateway will actually accept a multi-part
dispatch. The app checks it through a `collaborationAvailability` that is finally
wired to a call site. When it is absent, the strip stays single-select and the
brief-mode affordance does not render — no dead chips, and an explicit sentence
naming what to upgrade. Which is what `AGENTS.md` asked for in the first place,
and what §6.1 says we do not have today.

---

## 8. What this design does not propose

- **Automatic work splitting.** We do not ask a model to divide a brief into
  parts. The reader authors the parts.
- **Agent-to-agent messaging.** Herdr has no such primitive and neither should
  we. Agents coordinate through the repo, or they do not coordinate.
- **Cross-machine fan-out.** Only one gateway connection is open at a time, and
  Herdr's ids are per-server anyway. One plan targets one session on one machine.
- **Answering approval prompts in a batch.** `agent_blocked` is a stop, per
  Herdr's docs and our own `AGENTS.md`.
- **Any status rollup that implies completion.**

## 9. Open questions for review

1. Should §6.1 (the unwired capability gate) be its own card ahead of this work?
   This document argues yes.
2. Is §6.3 — focusing an agent from the phone clearing the laptop's Done badge —
   acceptable, or should "Open terminal" route through a read-only path?
3. Is the worktree toggle (§7.6) in scope for a first cut, or is it the second
   card?
4. Does `agent.read` (§7.5) justify a Gateway change on its own, independent of
   fan-out?
5. Given §4, is the cheapest useful first card actually §7.9 (live panels sheet)
   plus the "N elsewhere" affordance in §7.8 — neither of which needs any
   dispatch work, and both of which already pay off for panes a human split?
6. §2.3 establishes that an agent with the Herdr skill can fan out from ordinary
   prompt text, with no involvement from us. Do we want the app to make that
   easier — for example a documented phrasing the reader can send — or is the
   structured plan in §7.2 the only path we support?
7. Does the *unattributed agent* state in §7.8 belong in `CollaborationTask`
   history at all, or should it stay purely derived and never persisted?

## 10. E2E note

Per `AGENTS.md`, any implementation of this design touches agent startup and task
delivery, and therefore needs the paired App → Gateway → agent check on an
isolated Herdr session and a dedicated device, with someone present to answer
trust prompts. A multi-part dispatch also needs a new native flow under
`e2e/agent-device/` registered with the `full` tag in `suite.json` in the same
change. Offline demo fixtures can prove the composer interaction and the queue
UI; they cannot prove that three assistants received three different tasks.
