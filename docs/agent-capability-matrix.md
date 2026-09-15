# Agent capability matrix

**A snapshot, dated 2026-09-14. It will drift.**

What the Muqun Gateway supports today, and what each of twelve coding agents can
uniquely do. Written as the evidence base for the architect-agent direction in
[`multi-agent-dispatch.md`](./multi-agent-dispatch.md) — specifically for the
question "which agent should this part of the brief go to, and why that one."

Three things to know before reading it.

1. **Part 1 is the only part we own.** It is the Gateway, cited as `file:line`
   against **osuki-dev/muqun-gateway @ `dccdd67`** (`origin/main` on 2026-09-14).
   App citations are marked `muqun-app` and are relative to this repository.
2. **Part 2 is third-party.** Twelve binaries we do not control, shipping on
   their own schedules, read from their vendors' own documentation on
   **2026-09-14**. Every row is a dated observation, not a contract. Two doc
   domains moved during the week it was written, and one vendor is mid-rebrand.
3. **Verdicts are `Yes` / `No` / `Partial` / `Unverified`.** `Unverified` means
   the official documentation read did not state it. It is not a claim of
   absence.

## How to refresh this

Re-doing the whole thing is not the intent; re-doing a row is.

- **Part 1** — re-read the cited `file:line` in the Gateway at its current
  `main` and update the commit above. The structural claims (§1.1, §1.6, §1.7)
  change rarely; the lists (§1.2, §1.3, §1.4) change whenever an agent is added.
- **Part 2** — the source URL on each row is the refresh instruction. Read the
  page, update the verdict and the note, and move the date on this header. If a
  URL redirects, record the post-redirect canonical URL, as the Claude Code and
  Codex rows already do.
- **Anything routed on** — if a decision in `multi-agent-dispatch.md` depends on
  a Part 2 row, re-read that row before the decision ships, not before the
  document is edited. The capability catalogue (§ _Capability catalogue_ there)
  is where a verified fact becomes something the app relies on, and it carries
  a `verified-against` version per agent for exactly this reason.

A row that has not been re-read is still useful as history. Say when it was
read; do not quietly present it as current.

---

## Part 1 — What the Gateway actually supports

### 1.1 The gateway does not launch agents itself

The single most important structural fact for a router: **the gateway never
builds an agent command line beyond `argv[0]` plus caller-supplied args.** There
are no per-agent binary paths, no per-agent flags, no resume flags, and no
headless modes anywhere in `src/`.

Two backends implement `start_agent`:

- **Herdr backend** — delegates entirely. It sends JSON-RPC `agent.start` with
  `{name, kind, pane_id, timeout_ms, args?}` and lets Herdr resolve `kind` to a
  command line (`src/backend/herdr.rs:621-695`). The gateway reads back only
  `result.argv`, `result.agent.terminal_id`, and an instance id.
- **tmux backend** — resolves `kind` on `PATH` and _types the literal command
  into the pane_: `argv = [executable] + request.args`, shell-quoted, pasted,
  then `Enter` (`src/backend/tmux.rs:1038-1090`).

Per-agent launch knowledge therefore lives in **Herdr**, not in this repository:
"`kind` is Herdr's own agent kind, and Herdr resolves it to the canonical
executable. The table below is therefore _not_ how the agent is launched"
(`src/tasks.rs:37-41`).

### 1.2 The supported agent kinds

`AGENT_KINDS` — 21 kinds, "Herdr's supported agent kinds, in the order
`herdr agent start --kind` lists them" (`src/tasks.rs:60-87`):

```
agy, amp, claude, cline, codex, copilot, cursor, devin, droid, gemini,
grok, hermes, kilo, kimi, kiro, maki, mastracode, omp, opencode, pi, qodercli
```

A second, shorter list mirrors "Herdr's own `IntegrationTarget` enum" —
`HERDR_AGENTS` (`src/shortcuts.rs:581-595`): `pi, omp, claude, codex, copilot,
devin, droid, kimi, opencode, kilo, hermes, qodercli, cursor, mastracode`.

Absences worth naming: **aider, Crush and Qwen Code appear nowhere in the tree.**
`gemini` is in `AGENT_KINDS` but not in `HERDR_AGENTS`. `kimi` is in both.
`aider` is explicitly asserted to resolve to no table in three separate tests
(`src/composer.rs:1102`, `src/composer.rs:1353`, `src/parts.rs:1277`).

Availability is a `PATH` probe only — kind name == executable name unless
remapped by `agent_commands` in `config.json` (`src/tasks.rs:122-158`,
`src/tasks.rs:43-47`). `available: false` is explicitly "a hint for the picker,
not a veto" (`src/tasks.rs:107-109`).

`GET /api/agents/catalog` returns `{kind, command, available, path, source}` per
kind plus `default_startup_timeout_ms` (`src/main.rs:2027`,
`src/main.rs:6712-6722`).

### 1.3 Support depth is tiered, and the tiers do not match `AGENT_KINDS`

Only a handful of agents get more than "start a binary in a pane". Four separate
per-agent tables exist, each keyed by _substring match on the agent name Herdr
reports_:

| Table                                         | Agents with an entry                                       | Cite                            |
| --------------------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| Transcript marker dictionaries (`parts.rs`)   | claude, qoder, codex, opencode                             | `src/parts.rs:93,106,128,149`   |
| Composer slash-command tables (`composer.rs`) | claude, codex, opencode, qoder                             | `src/composer.rs:471-505`       |
| Key-row / interrupt profiles (`shortcuts.rs`) | claude, codex, opencode, qodercli                          | `src/shortcuts.rs:338-368`      |
| Native protocol adapters (`native.rs`)        | **opencode only**                                          | `src/native.rs:73-78`           |
| Foreground-process detection (tmux)           | claude, codex, opencode, qodercli, gemini, amp, cursor, pi | `src/backend/tmux.rs:1492-1494` |

Everything else in `AGENT_KINDS` — copilot, droid, kimi, cline, devin, grok,
kiro, maki, mastracode, agy, omp, kilo, hermes — can be _started_, but the pane
degrades to `parts: "text"` and the shared shell key row. This is deliberate:
"An agent with no dictionary is not an error: the whole transcript degrades to
`text` parts" (`src/parts.rs:22-24`); "An unrecognised agent falls back to the
shell set rather than to nothing" (`src/shortcuts.rs:400-403`).

### 1.4 Per-agent knowledge the gateway ships

**Built-in slash commands, captured from installed binaries** — explicitly "read
off the program actually installed on the machine this gateway was developed on,
never from memory" (`src/composer.rs:12-31`); versions pinned at
`src/composer.rs:474-505`:

- **claude** (from `claude 2.1.220`): `/add-dir /bug /clear /compact /config
/context /diff /doctor /export /help /hooks /ide /init /login /logout /mcp
/memory /model /output-style /permissions /plan /privacy-settings
/release-notes /reload-skills /resume /review /rewind /skills /status
/statusline /terminal-setup /theme /usage /vim`
- **codex** (from `codex-cli 0.145.0`): `/agent /app /approve /apps /archive
/clear /compact /copy /delete /diff /experimental /fork /goal /hooks /ide
/import /init /keymap /logout /mcp /memories /mention /model /new /permissions
/personality /pets /plan /plugins /ps /quit /raw /rename /resume /review /side
/skills /status /statusline /stop /theme /title /usage /vim`
- **opencode** (from `opencode 1.18.0`): `/agents /compact /connect /copy /diff
/editor /exit /export /fork /help /mcps /models /move /new /redo /rename
/sessions /share /skills /status /themes /thinking /timeline /timestamps /undo
/unshare /variants /workspaces`
- **qoder** (from `qodercli 1.1.5`): `/add-dir /agents /branch /btw /clear
/commands /commit /compact /config /context /copy /diff /effort /export /fast
/goal /help /hooks /init /login /logout /mcp /memory /model /new /permissions
/plan /plugins /release-notes /rename /resume /review /skills /status /theme
/usage /vim`

The gateway records why this is a _captured table_ and not a query: "`claude
--help` does not list slash commands and there is no non-interactive way to ask
for them" (`src/composer.rs:18-21`).

**Skills / command directories scanned per agent** (`src/composer.rs:445-466`).
`.agents/skills` is called out as "the cross-agent convention":

| Agent    | Skill dirs                                              | Command dirs        |
| -------- | ------------------------------------------------------- | ------------------- |
| claude   | `.claude/skills`, `.agents/skills`                      | `.claude/commands`  |
| codex    | `.codex/skills`, `.agents/skills`                       | —                   |
| opencode | `.opencode/skills`, `.opencode/skill`, `.agents/skills` | `.opencode/command` |
| qoder    | `.qoder/skills`, `.agents/skills`                       | `.qoder/commands`   |

Reads are fenced (every path must canonicalize inside the workspace root),
capped at 64 commands and 64 KiB per file (`src/composer.rs:533-545`).

**Interrupt key.** Every profiled agent stops on `esc`, not `ctrl+c`
(`src/shortcuts.rs:315-323`): "a Stop button that sends the same key everywhere
is wrong on four agents out of four."

**opencode's native protocol.** opencode is the only agent with a structured
second source: the gateway reads its HTTP server (mapped against the OpenAPI
document opencode 1.18.0 serves at `GET /doc`) instead of scraping glyphs,
yielding real tool exit codes, patches, checklists and pending permissions as
data (`src/native.rs:1-32`, `:73-78`). The endpoint is **configured, not
discovered** — `HERDR_GATEWAY_OPENCODE_URL` — because opencode binds an ephemeral
port and publishes it nowhere readable (`src/native.rs:96-101`). Codex's JSON-RPC
app-server is _named_ as a second such protocol in the module doc
(`src/native.rs:5-7`) but **no Codex adapter is implemented**: `ADAPTERS` has one
entry and `adapter_for(Some("codex"))` is asserted `None` (`src/native.rs:78`,
`src/native.rs:676`).

### 1.5 Detection, identity and status

**Agent detection (tmux backend).** `#{pane_current_command}` is insufficient
because Claude Code renames its own process to its version string — "tmux reports
`2.1.239` where the argv still plainly says `claude`" (`src/backend/tmux.rs:1504-1513`).
So the gateway shells out to `ps -axo pid=,ppid=,args=` and walks the whole
process subtree under each pane pid (a pane usually holds a shell whose child or
grandchild is the agent), matching the 8-name `AGENTS` list, cached for
`AGENT_LOOKUP_TTL` (`src/backend/tmux.rs:1528-1560`, `:1633-1673`). The match is
`command == agent || command.starts_with("{agent}-")`
(`src/backend/tmux.rs:1496-1502`) — so `claude-canary` detects as `claude`.

**Agent identity.** `agent_instance_id` is read from Herdr's
`/agent_session/value` alongside `terminal_id` (`src/backend/herdr.rs:1171-1200`)
and returned by both `POST /tasks` and `POST /spawn`. The release notes state the
rule: "Agents carry an opaque `instance_id` — the identity of a process and its
conversation, never a reusable pane id" (`release-notes/v0.10.0.md:15-18`).

**Status vocabulary.** `AgentStatus` = `Starting | Working | Idle | Blocked |
Completed | Unknown`, parsed from Herdr's `agent_status` string, `done` aliasing
`completed` (`src/backend/model.rs:100-122`).

**Status inference when the backend cannot say (tmux).**
`infer_tmux_agent_status` (`src/main.rs:5919-5936`): if `approvals::detect()`
finds a menu → `Blocked`; else normalize the visible text through the agent's
marker dictionary and read the last part — `prompt` → `Idle`,
`status`/`tool-block` → `Working`, otherwise `Unknown`. **An agent with no
dictionary can never be inferred past `Unknown`.**

**Readiness gate.** `startup_ready` refuses to hand a prompt to an agent in
`blocked`, and requires `idle`/`done` plus `interactive_ready`, or
`launch_pending != true` (`src/backend/herdr.rs:104-120`).

**Approval detection is agent-agnostic by construction.** `approvals.rs` matches
the _shape_ of a drawn menu, never any agent's wording: only the tail of the pane
counts (80 lines), options must be contiguous and numbered `1..n` with `n >= 2`,
and the block must look like a question with a cursor glyph or a key-hint footer
(`src/approvals.rs:1-38`, `:44-77`). Answers are classified into a closed
vocabulary — `allow | allow_always | deny | other` (`src/approvals.rs:100-125`).
This is the one place the gateway generalizes across agents rather than tabulating
them, and it is why approvals work on agents with no profile at all.

**Status history.** `agent_events.rs` keeps an in-memory ring of 200 status
transitions per session (`seq, pane_id, agent, from, to, unix_ms`), carrying
never terminal output and never a prompt, and never persisted
(`src/agent_events.rs:1-72`).

### 1.6 The dispatch API

`POST /api/sessions/{session_id}/tasks` (`src/main.rs:2032`; body at
`src/main.rs:6688-6704`):

| Field                | Meaning                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo_path` (req)    | must resolve inside a workspace the session already has open, else 403 `repo_not_allowed` (`src/main.rs:6804-6811`)                                                                               |
| `branch_name`        | present ⇒ cut a git worktree; absent ⇒ work in the repo as it is. Allow-list validated: letters/digits/`._-/`, ≤200 chars, no `..`, no leading `-`, no `.lock` (`src/tasks.rs:190-240`, `:89-92`) |
| `agent` (req)        | a kind from the catalog; unknown ⇒ 400 `unknown_agent` (`src/main.rs:6753-6759`)                                                                                                                  |
| `prompt`             | typed and submitted once the agent is interactive                                                                                                                                                 |
| `workspace_label`    | ≤120 printable chars                                                                                                                                                                              |
| `agent_args`         | extra argv appended to the agent's own command line, ≤32 args × ≤512 chars (`src/main.rs:104-107`)                                                                                                |
| `startup_timeout_ms` | 3001..=300000, default 30000 (`src/tasks.rs:94-101`)                                                                                                                                              |

`POST /api/sessions/{session_id}/spawn` **and** `/agents/spawn` (one handler, two
spellings, because "the card said `agents/spawn` and the route said `spawn`" —
`src/main.rs:2033-2039`); body at `src/main.rs:6971-6986`:
`{agent, cwd?, tab_id?, prompt?}`. No branch, no worktree, **no `agent_args`**.
Accepts a kind _or_ a profile named in `agents.json` (`src/main.rs:7024-7025`).
`tab_id` splits the named tab so the second agent lands beside the first
(`src/main.rs:7140-7152`).

Both return **207** on partial success with a step log
(`worktree | workspace | pane | agent | prompt`), because four remote steps in a
row must not report as all-or-nothing (`src/main.rs:6725-6740`). A worktree is
rolled back only while still useless — once a pane exists in it, nothing is
deleted.

**Prompt delivery is a TTY paste, not an API call.** The prompt is pasted, then a
_separate_ `Enter` is sent after the pane stops redrawing, because "when the
prompt text and its newline arrive in one PTY write, Claude Code's input treats
the newline as pasted content and leaves the prompt sitting in its input box
unsubmitted" (`src/main.rs:6508-6523`, reproduced on camera, card #571). The delay
cannot be fixed: a prompt naming an image file keeps Claude Code busy staging it —
measured "under a second for one small image and at over three seconds for three
large ones off a cold page cache" (`src/main.rs:112-120`). Delivery is retried up
to `SPAWN_PROMPT_ATTEMPTS` times (`src/main.rs:6886-6896`). Herdr 0.9+ owns
paste+Enter itself and the workaround is suppressed there
(`src/main.rs:6524-6537`).

### 1.7 Capability strings

`API_CAPABILITIES`, served from `/health` (`src/main.rs:308-338`, `:4588`):

```
agent_collaboration, agent_catalog, agent_events, agent_lifecycle_notifications,
agent_spawn, assets, device_revocation, file_uploads, git_diff,
one_time_pairing_codes, pane_context, pane_approvals, pane_composer,
pane_file_search, pane_interrupt, pane_output_ansi, pane_parts,
pane_parts_native, pane_shortcuts, configurable_agent_profiles,
per_device_tokens, push_notifications, push_token_revocation, recent_cwds,
tasks, terminal_backends, multiple_terminal_backends,
terminal_session_liveness, terminal_input
```

There is a **second, per-pane** capability descriptor (`src/main.rs:7988-8017`):
`parts: "native" | "dictionary" | "text"`, the `dictionary` id, `native.{protocol,
version, session}`, `composer` (absent — not null — when the gateway knows no
table for this agent), and `image_input: "file-path"`, which is **hardcoded for
every agent**. The gateway's whole image story is: upload, get a local path back,
put the path in the prompt text (`src/main.rs:11908-11912`; PNG/JPEG/GIF/WebP/HEIC
only, type decided by magic bytes not filename, deleted after 48 hours).

### 1.8 Extensibility without a rebuild

`agents.json` in the config directory overlays the built-in profiles —
`match`, `keys`, `interrupt`, `commands`, `commandDirs`: "supporting a new agent
is an edit to a JSON file — no rebuild of the gateway, and certainly no release
of any client" (`src/shortcuts.rs:17-38`; `AGENTS_FILE` at `src/shortcuts.rs:60`).
Re-read on every request so an edit takes effect on the next pane switch. This is
the `configurable_agent_profiles` capability. `is_known_agent` deliberately
accepts any key in `agents.json` — "someone who wrote a profile for an agent this
build has never heard of has said, in the clearest way available, that it is one
they want to run" (`src/shortcuts.rs:598-620`). `agent_commands` in `config.json`
separately remaps a kind to a differently-named executable (`src/tasks.rs:43-47`).
`KEYMAP_VERSION` (currently 6) and `COMPOSER_VERSION` (currently 1) let clients
cache and invalidate these tables (`src/shortcuts.rs:54`, `src/composer.rs:48`).

### 1.9 Agent support policy, from the docs

- `docs/architecture.md:53-58` — the gateway's job is "inspect topology" and "run
  agent workflows: start an agent, create a task/worktree, spawn beside or in a
  new tab"; `:74` lists "approval detection, agent catalog/state inference,
  composer, structured [parts]" as gateway-side concerns.
- `docs/content-model.md` keeps the part set **closed and versioned**; a native
  adapter "names no agent-specific construct on the wire" and "is never required"
  (`src/native.rs:16-25`). Adding an agent is "a new `Dictionary`, never a new
  part type" (`src/parts.rs:8-9`). Every part carries `fallback_text` verbatim, so
  a dictionary that drifts out of date "merely degrade[s] into prose"
  (`src/parts.rs:13-20`).
- `release-notes/v0.10.0.md:39-55` — features are detected by **capability string,
  never by gateway version**; agent collaboration additionally requires "a
  connected Herdr 0.9.0+ backend for the selected session", and where that is
  missing "ordinary terminal use is unaffected and the App explains what to
  upgrade".

### 1.10 What the gateway does _not_ know

None of the following appear anywhere in `src/`: headless / `-p` / `exec`
invocation, `--resume` or session ids for any agent, JSON or stream-json output
parsing, `--yolo` / auto-approve flags, MCP server configuration, model selection,
or per-agent image/media capability. The gateway drives TTYs. Everything in Part 2
is a property of the agent binary, reachable only through `agent_args` on
`POST /tasks`, through typed slash commands, or out of band.

---

## Part 2 — Per-agent capabilities, from vendor documentation

All rows read **2026-09-14** from the vendor's own documentation unless stated.
Verdicts: **Yes / No / Partial / Unverified**. "Unverified" means the official
docs read did not state it — it is not a claim of absence.

Two vendor doc sites moved during this research: `docs.claude.com/en/docs/claude-code/*`
now 301s to **`code.claude.com/docs/en/*`**, and `developers.openai.com/codex/*`
308s to **`learn.chatgpt.com/docs/*`**. URLs below are post-redirect canonical.

### Claude Code (Anthropic)

In `AGENT_KINDS` as `claude`. Deepest gateway support: dictionary + composer
table + key profile, no native adapter.

| Capability             | Verdict                                     | Note                                                                                                                                                                                                                                                                                                                                                                                                          | Source                                            |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Headless               | Yes                                         | `-p`/`--print`; stdin piped as context (10 MB cap); `--bare` for CI                                                                                                                                                                                                                                                                                                                                           | https://code.claude.com/docs/en/headless          |
| Structured output      | Yes                                         | `--output-format text\|json\|stream-json`; **`--input-format text\|stream-json`**; `--json-schema '<schema>'` validates into `structured_output`; `--include-partial-messages`, `--include-hook-events`                                                                                                                                                                                                       | same                                              |
| Session resume         | Yes                                         | `-c`/`--continue`; `-r`/`--resume <session-id\|name\|absolute .jsonl path>`; `--session-id <uuid>`; `--fork-session`; id readable from `.session_id` in JSON output                                                                                                                                                                                                                                           | https://code.claude.com/docs/en/cli-reference     |
| Auto-approve           | Yes                                         | `--permission-mode default\|acceptEdits\|plan\|auto\|dontAsk\|bypassPermissions\|manual`; `--dangerously-skip-permissions`; `--allowedTools`/`--disallowedTools`; `--permission-prompts host\|none`; `--permission-prompt-tool`. In a TTY an approval dialog is drawn per call; `-p` starts in Manual on every plan                                                                                           | same                                              |
| Subagents / parallel   | Yes                                         | `.claude/agents/*.md` + `~/.claude/agents/`, `--agents '<json>'`, `--agent <name>`; built-ins Explore/Plan/General-purpose; background + parallel, default `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=20`, nesting depth 3; a `Workflow` tool orchestrates many subagents                                                                                                                                          | https://code.claude.com/docs/en/sub-agents        |
| Skills                 | Yes                                         | `SKILL.md` in `~/.claude/skills/<name>/`, `.claude/skills/`, and plugins; invoke `/skill-name`; `/skills` lists                                                                                                                                                                                                                                                                                               | https://code.claude.com/docs/en/skills            |
| Hooks                  | Yes                                         | **33 hook events** (`PreToolUse` … `SessionEnd`) in `settings.json` or a plugin's `hooks/hooks.json`                                                                                                                                                                                                                                                                                                          | https://code.claude.com/docs/en/hooks             |
| Plugins                | Yes                                         | `claude plugin install/list/validate`, `--json` output, marketplaces                                                                                                                                                                                                                                                                                                                                          | https://code.claude.com/docs/en/plugins-reference |
| MCP client             | Yes (tools + resources); prompts Unverified | `claude mcp add --transport stdio\|http\|sse`, `add-json`, `list`, `get`, `remove`, `login`; scopes local/project (`.mcp.json`)/user; resources via `ListMcpResourcesTool`/`ReadMcpResourceTool`. **`claude mcp serve` also exposes Claude Code itself as an MCP server**                                                                                                                                     | https://code.claude.com/docs/en/mcp               |
| Image input            | Yes                                         | `Ctrl+V` (`Cmd+V` iTerm2, `Alt+V` Windows/WSL) pastes a clipboard image as an `[Image #N]` chip referenced positionally; `Read` also renders PNG/JPG and PDFs                                                                                                                                                                                                                                                 | https://code.claude.com/docs/en/interactive-mode  |
| Image output           | **No**                                      | The complete built-in tool list contains no image-generation tool                                                                                                                                                                                                                                                                                                                                             | https://code.claude.com/docs/en/tools-reference   |
| Web search / fetch     | Yes                                         | Built-in `WebSearch` and `WebFetch`, both permission-gated; scopeable as `WebFetch(domain:example.com)`; WebFetch denies private/link-local/metadata IPs                                                                                                                                                                                                                                                      | same                                              |
| Computer use / browser | Partial                                     | First-party browser automation via the `claude-in-chrome` MCP server + Chrome extension: `claude --chrome`, `/chrome`; needs extension ≥1.0.36 and a **direct Anthropic plan** (not Bedrock/Foundry/GCP)                                                                                                                                                                                                      | https://code.claude.com/docs/en/chrome            |
| Sandbox                | Yes                                         | macOS Seatbelt; Linux/WSL2 `bubblewrap` + `socat` with optional seccomp (`@anthropic-ai/sandbox-runtime`); per-domain network allowlist via proxy; `/sandbox` panel, `sandbox.enabled`, `allowUnsandboxedCommands`                                                                                                                                                                                            | https://code.claude.com/docs/en/sandboxing        |
| Git worktrees          | **Yes, built in**                           | `EnterWorktree`/`ExitWorktree` tools, subagent `isolation: worktree`, `WorktreeCreate`/`WorktreeRemove` hooks                                                                                                                                                                                                                                                                                                 | https://code.claude.com/docs/en/tools-reference   |
| Context files          | Yes — **`CLAUDE.md`, not `AGENTS.md`**      | Load order: managed policy `CLAUDE.md` → `~/.claude/CLAUDE.md` → `./CLAUDE.md` or `./.claude/CLAUDE.md` → `./CLAUDE.local.md`; ancestors concatenated root→cwd; `.claude/rules/*.md` with `paths:` scoping; `@path` imports depth 4. Docs are explicit: "Claude Code reads `CLAUDE.md`, not `AGENTS.md`" — import or symlink it                                                                               | https://code.claude.com/docs/en/memory            |
| Models / plans         | Yes                                         | Aliases `default/best/fable/sonnet/opus/haiku/opusplan`, `sonnet[1m]`, `opus[1m]`; `--model`, `--effort low\|medium\|high\|xhigh\|max\|ultracode`, `--fallback-model`, `--advisor`. Native 1M: Fable 5/5.1, Sonnet 5, Opus 4.7+. Opus-1M included on Max/Team/Enterprise, usage credits on Pro; Sonnet 4.6 1M always usage credits. Defaults: Opus 5 (Max/Team Premium/Ent/API), Sonnet 5 (Pro/Team Standard) | https://code.claude.com/docs/en/model-config      |
| Runtime introspection  | Yes (mixed)                                 | **Machine-parseable:** `claude plugin list --json`, `claude agents --json`, `claude auth status`, `claude auto-mode defaults --json`, and the `system/init` event of `--output-format stream-json`, which carries model, `tools`, `mcp_servers`, `mcp_server_errors`, `plugins`, `plugin_errors`, `capabilities[]`. **Human text only:** `--help`, `claude mcp list`, `claude doctor`, `/skills`, `/mcp`      | https://code.claude.com/docs/en/headless          |

### OpenAI Codex CLI

In `AGENT_KINDS` as `codex`. Dictionary + composer table + key profile; its
JSON-RPC app-server is known to the gateway but not implemented (§1.4).

| Capability                    | Verdict                                                | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                                        |
| ----------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Headless                      | Yes                                                    | `codex exec` (alias `codex e`); progress → stderr, final message → stdout; stdin as extra context, or as the whole prompt with `codex exec -`; `--ephemeral` skips persisting rollout files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | https://learn.chatgpt.com/docs/non-interactive-mode           |
| Structured output             | Partial                                                | `--json` makes stdout a JSON Lines stream of thread/turn/item/error events; `-o/--output-last-message <path>`; `--output-schema <path>` constrains the final response. **No stream-json _input_ mode** — stdin is plain text                                                                                                                                                                                                                                                                                                                                                                                                                                                 | same                                                          |
| Session resume                | Yes                                                    | `codex resume [--last\|--all\|--include-non-interactive]`; `codex exec resume --last "next instruction"` or `codex exec resume <SESSION_ID>`; also `codex fork`, `archive`, `delete`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | https://learn.chatgpt.com/docs/developer-commands?surface=cli |
| Auto-approve                  | Yes                                                    | `-a/--ask-for-approval on-request\|never`; `-s/--sandbox read-only\|workspace-write\|danger-full-access`; `--dangerously-bypass-approvals-and-sandbox` aka `--yolo`. **`--full-auto` is deprecated** in favour of `codex exec --sandbox workspace-write`. Granular `approval_policy = { granular = {...} }`. In a TTY under `on-request`, escalations and network access surface as interactive approval requests; `/permissions` switches mid-session                                                                                                                                                                                                                       | https://learn.chatgpt.com/docs/agent-approvals-security       |
| Subagents / parallel          | Yes                                                    | Delegation is **prompt-driven** ("spawn two agents", "delegate this in parallel") — Codex orchestrates spawn, follow-up routing, waiting and closing. Custom agents are one TOML file each in `~/.codex/agents/` or `.codex/agents/`. Config `[agents] enabled`, `max_concurrent_threads_per_session`, `default_subagent_model`                                                                                                                                                                                                                                                                                                                                              | https://learn.chatgpt.com/docs/agent-configuration/subagents  |
| Skills                        | Yes                                                    | `SKILL.md` (+ optional `scripts/`, `references/`, `assets/`, `agents/openai.yaml`), scanned from `$CWD/.agents/skills`, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`, plus OpenAI built-ins (Skill Creator, Skill Installer, Atlas Control, Exec Plan, GitHub Fix CI, Linear, OpenAI Docs, Yeet). Invoked with **`$skill-name`** or implicitly. Note `.agents/skills` is exactly the dir the gateway already scans for Codex (§1.4)                                                                                                                                                                                                              | https://learn.chatgpt.com/docs/build-skills                   |
| Custom commands               | Deprecated                                             | `~/.codex/prompts/*.md` invoked `/prompts:<name>` are **deprecated in favour of skills**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | https://developers.openai.com/codex/custom-prompts            |
| Hooks                         | Yes                                                    | `hooks.json` or inline `[hooks]` in `config.toml` at `~/.codex/` or `<repo>/.codex/`; events `SessionStart, SessionEnd, SubagentStart, SubagentStop, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, Stop, Interrupt`; command or MCP-tool handlers, `"async": true`                                                                                                                                                                                                                                                                                                                                                                  | https://learn.chatgpt.com/docs/hooks                          |
| Plugins                       | Yes                                                    | Bundle skills / MCP servers / browser extensions / hooks: `codex plugin add\|list\|remove`, `codex plugin marketplace`, `/plugins`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | https://learn.chatgpt.com/docs/plugins                        |
| MCP client                    | Partial                                                | `codex mcp add\|list\|get\|remove\|login\|logout`; `[mcp_servers.<name>]` with stdio (`command`/`args`/`env_vars`) or streamable HTTP (`url`/`bearer_token_env_var`/`http_headers`), tool allowlists, per-tool approval modes. Tools confirmed; **resources/prompts not documented**. `codex mcp-server` is **removed** — use `codex app-server`                                                                                                                                                                                                                                                                                                                             | https://learn.chatgpt.com/docs/extend/mcp?surface=cli         |
| Image input                   | Yes                                                    | `-i`/`--image PATH[,PATH...]`, repeatable; paste or drag into the interactive composer; config `tools.view_image`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | https://learn.chatgpt.com/docs/image-inputs?surface=cli       |
| **Image output / generation** | **Yes — and it is spelled `$imagegen`, not `$imggen`** | A **built-in skill**, invoked by putting the token in the prompt: "Include `$imagegen` in your prompt to invoke the image generation skill explicitly." Model is fixed: "Built-in image generation uses **`gpt-image-2`** and counts toward your general Codex usage limits." Cost warning: "Image generations use included limits **3–5x faster** on average than similar turns without image generation." For batches the docs say to set `OPENAI_API_KEY` and go through the API so API pricing applies. Plan-dependent: "Image availability and usage limits in ChatGPT web depend on your plan and workspace settings." Reference images are passed with `-i`/`--image` | https://learn.chatgpt.com/docs/image-generation               |
| Web search / fetch            | Yes (search only)                                      | `--search`; `tools.web_search = disabled\|cached\|indexed\|live` (`cached` is the default for local chats) with `allowed_domains` filtering. **No separate URL-fetch tool documented**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | https://learn.chatgpt.com/docs/web-search?surface=cli         |
| Computer use / browser        | **No, in the CLI**                                     | "Browser isn't available in Codex CLI or the Codex IDE extension. Open the ChatGPT desktop app to use the built-in browser." Computer Use is a ChatGPT desktop plugin. The bundled `Atlas Control` skill (macOS) drives the Atlas browser via its own CLI, not a built-in tool                                                                                                                                                                                                                                                                                                                                                                                               | https://learn.chatgpt.com/docs/browser                        |
| Sandbox                       | Yes                                                    | macOS Seatbelt via `sandbox-exec`; Linux `bwrap`+`seccomp` by default; native Windows sandbox; WSL2 uses the Linux path. **Network off by default in `workspace-write`**; enable with `[sandbox_workspace_write] network_access = true`. `codex sandbox` runs arbitrary commands inside it                                                                                                                                                                                                                                                                                                                                                                                   | https://learn.chatgpt.com/docs/agent-approvals-security       |
| Git worktrees                 | No                                                     | No worktree helper documented (`codex fork` forks _sessions_, not worktrees)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | https://learn.chatgpt.com/docs/developer-commands?surface=cli |
| Context files                 | Yes — **`AGENTS.md` only**                             | `~/.codex/AGENTS.override.md` else `~/.codex/AGENTS.md`, then walking project root → cwd checking `AGENTS.override.md` then `AGENTS.md` then configured fallback names; concatenated root-downward so "files closer to your current directory override earlier guidance". Discovery stops at `project_doc_max_bytes` (32 KiB default). **CLAUDE.md is not read**                                                                                                                                                                                                                                                                                                             | https://learn.chatgpt.com/docs/agent-configuration/agents-md  |
| Models / plans                | Partial                                                | GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, GPT-5.5, GPT-5.4, GPT-5.4 mini; `-m/--model`, `model_reasoning_effort = minimal\|low\|medium\|high\|xhigh`. `model_context_window` is a config key but **no published per-model sizes**. Included with Free, Go, Plus, Pro, Business, Edu, Enterprise; 5-hour rolling windows plus weekly limits (values not published)                                                                                                                                                                                                                                                                                                                 | https://learn.chatgpt.com/docs/pricing                        |
| Runtime introspection         | Yes                                                    | **Machine-parseable:** `codex doctor --json`, `codex debug models` (raw model catalog as JSON), `codex debug prompt-input`, `codex plugin list --json`, `codex mcp list --json`, `codex plugin marketplace list --json`, `codex cloud list --json`, and `codex exec --json`. **Human text:** `--help`, `codex features list`, `codex login status` (exit 0 when logged in)                                                                                                                                                                                                                                                                                                   | https://learn.chatgpt.com/docs/developer-commands?surface=cli |

### opencode

In `AGENT_KINDS` and `HERDR_AGENTS` as `opencode`. **The only agent with a
native protocol adapter in the gateway** (§1.4) — and the docs below explain why
that was possible. Note `github.com/sst/opencode` now 301-redirects to
`github.com/anomalyco/opencode`.

| Capability             | Verdict                                               | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Source                                |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Headless               | Yes                                                   | `opencode run [message..]`; also **`opencode serve`** (headless HTTP) and **`opencode acp`** (Agent Client Protocol over stdio). **Stdin piping is Unverified** — undocumented; use args, `-f/--file`, or `--command`                                                                                                                                                                                                                                                                                                                                                                                                                                             | https://opencode.ai/docs/cli/         |
| Structured output      | Yes                                                   | `opencode run --format json` = raw JSON events; `session list --format json`; `opencode export [sessionID]`; `opencode db --format json\|tsv`; `--print-logs`, `--log-level`. The API/SDK prompt takes `format: {type:"json_schema", schema}` → `structured_output`                                                                                                                                                                                                                                                                                                                                                                                               | https://opencode.ai/docs/sdk/         |
| Session resume         | Yes                                                   | `run -c/--continue` (last), `-s/--session <id>`, `--fork`; `opencode session list/delete`; `POST /session/:id/fork`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | https://opencode.ai/docs/cli/         |
| Auto-approve           | Yes                                                   | `--auto` "Auto-approve permissions not explicitly denied"; config `permission.{read,edit,glob,grep,bash,task,skill,lsp,question,webfetch,websearch,external_directory,doom_loop}` → `allow\|ask\|deny` as glob maps, last match wins; `OPENCODE_PERMISSION` env. TTY prompt offers `once` / `always` / `reject` — which is exactly the 3-option shape `approvals.rs` detects                                                                                                                                                                                                                                                                                      | https://opencode.ai/docs/permissions/ |
| Subagents              | Yes (teams Unverified)                                | Primaries `build`/`plan`; built-in subagents `general`, `explore`, `scout`; invoked via the `task` tool or `@name`; **each runs as a child session** (`GET /session/:id/children`), so a subagent is addressable over HTTP. `mode: primary\|subagent\|all`, `permission.task` globs, `subagent_depth`                                                                                                                                                                                                                                                                                                                                                             | https://opencode.ai/docs/agents/      |
| Skills                 | Yes — **cross-vendor**                                | `SKILL.md` in `.opencode/skills/<n>/`, `~/.config/opencode/skills/`, plus **`.claude/skills/`, `.agents/skills/`**, via a native `skill` tool. (The gateway scans `.opencode/skills`, `.opencode/skill`, `.agents/skills` — §1.4 — so `.claude/skills` is a gap on the gateway side)                                                                                                                                                                                                                                                                                                                                                                              | https://opencode.ai/docs/skills/      |
| Commands / plugins     | Yes                                                   | Commands: `.opencode/commands/*.md` with `$ARGUMENTS`, `` !`cmd` ``, `@file`; run as `/name` or `opencode run --command`. Plugins: JS/TS in `.opencode/plugins/` or npm; hooks `tool.execute.before/after`, `permission.asked`, `session.idle`, `file.edited`, `shell.env`, `tui.*`; `--pure` disables                                                                                                                                                                                                                                                                                                                                                            | https://opencode.ai/docs/plugins/     |
| MCP client             | Yes (tools only)                                      | `mcp` key in `opencode.json[c]` or `~/.config/opencode/opencode.json`: `{"type":"local","command":[..]}` / `{"type":"remote","url","headers","oauth"}`; `opencode mcp add\|list\|auth\|logout\|debug`; HTTP `GET/POST /mcp`; tools named `<server>_<tool>`, gated by `permission`. Resources/prompts Unverified                                                                                                                                                                                                                                                                                                                                                   | https://opencode.ai/docs/mcp-servers/ |
| Image input            | Yes                                                   | Drag-and-drop into the TUI; `run -f/--file`; config `attachment.image` (`max_width`/`max_height` 2000, `max_base64_bytes` 5242880)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | https://opencode.ai/docs/config/      |
| Image output           | No                                                    | No generation tool or flag in the docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | https://opencode.ai/docs/tools/       |
| Web search / fetch     | Yes (search gated)                                    | `webfetch` always; **`websearch` only with the OpenCode/OpenCode Go provider or `OPENCODE_ENABLE_EXA` / `OPENCODE_ENABLE_PARALLEL` set**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | same                                  |
| Computer use / browser | No                                                    | MCP/plugins only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | same                                  |
| Sandbox / worktrees    | Partial                                               | **No sandbox documented.** `snapshot: true` (default) tracks edits in an internal git repo → `/undo`, `/redo`, `POST /session/:id/revert`, `GET /session/:id/diff`; `external_directory` permission (default `ask`) confines tools to the worktree; `GET /vcs`; `opencode pr <n>` checks out a PR branch. No worktree-creation helper, no auto-commits                                                                                                                                                                                                                                                                                                            | https://opencode.ai/docs/permissions/ |
| Context files          | Yes                                                   | Precedence: local `AGENTS.md` then `CLAUDE.md` (walking up from cwd) → `~/.config/opencode/AGENTS.md` → `~/.claude/CLAUDE.md`; extras via `"instructions": [globs, URLs]`. Opt out of the Claude paths with `OPENCODE_DISABLE_CLAUDE_CODE[_PROMPT\|_SKILLS]`. `opencode.json` is config, not memory                                                                                                                                                                                                                                                                                                                                                               | https://opencode.ai/docs/rules/       |
| Models                 | Yes                                                   | "75+ providers" via the AI SDK + Models.dev, BYO keys through `opencode auth login` / `/connect`; `model: "provider/model"`, `small_model`, per-agent model, `-m`, `/models`, `opencode models`. Reasoning via per-model `options` (`reasoningEffort`, `thinking.budgetTokens`), named `variants` + `--variant`, `--thinking`. OpenCode Zen is pay-per-token                                                                                                                                                                                                                                                                                                      | https://opencode.ai/docs/models/      |
| Runtime introspection  | **Yes — the strongest surface of any agent surveyed** | `opencode serve --port --hostname` (default `127.0.0.1:4096`, `OPENCODE_SERVER_PASSWORD`) publishes **OpenAPI 3.1 at `GET /doc`** — the exact document the gateway's adapter was written against (`src/native.rs:27-32`). SSE `GET /event`; `GET /config`, `/config/providers`, `/provider`, `/agent`, `/command`, `/mcp`, `/lsp`, **`/experimental/tool/ids` and `/experimental/tool?provider&model` (tool JSON schemas)**; `GET/POST /session` and `/session/:id/{message,prompt_async,command,shell,fork,abort,diff,revert,children,permissions/:id}`; `/find`, `/file`, `/vcs`, `/path`; TUI control `/tui/*`. SDK `@opencode-ai/sdk`. ACP via `opencode acp` | https://opencode.ai/docs/server/      |

### Gemini CLI (Google)

| Capability             | Verdict                                   | Note                                                                                                                                                                                                                                                                                                              | Source                                                                               |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Headless               | Yes                                       | `-p`/`--prompt`; auto-triggers in a non-TTY; `-i` runs then drops into REPL                                                                                                                                                                                                                                       | https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/headless.md |
| Structured output      | Yes                                       | `--output-format text\|json\|stream-json`; JSONL events `init, message, tool_use, tool_result, error, result`                                                                                                                                                                                                     | same                                                                                 |
| Session resume         | Yes                                       | `--resume`/`-r` (`latest` or index), `--list-sessions`, `--delete-session`; `/chat save\|resume`, checkpointing + `/restore`, `/rewind`                                                                                                                                                                           | https://geminicli.com/docs/cli/tutorials/session-management/                         |
| Auto-approve           | Yes                                       | `--approval-mode default\|auto_edit\|yolo\|plan`; `--yolo`/`-y` is a deprecated alias. `general.defaultApprovalMode` **cannot** be set to yolo — flag only                                                                                                                                                        | https://geminicli.com/docs/cli/cli-reference/                                        |
| Subagents              | Yes                                       | `.gemini/agents/*.md` + `~/.gemini/agents/*.md`, YAML frontmatter (`tools` wildcards, `mcpServers`, `model`, `max_turns` 30, `timeout_mins` 10); exposed to the main agent as a tool; force with `@agent_name`; `/agents list\|reload\|enable\|disable`                                                           | https://geminicli.com/docs/core/subagents/                                           |
| Parallel / teams       | Partial                                   | Subagent tool-isolation plus `--worktree` parallel sessions; no teams or fan-out primitive documented                                                                                                                                                                                                             | https://geminicli.com/docs/cli/git-worktrees/                                        |
| Skills                 | Yes                                       | `SKILL.md` dirs, 4 tiers: builtin < extension < `~/.gemini/skills/` (`~/.agents/skills/`) < `.gemini/skills/` (`.agents/skills/`); `gemini skills list\|install`, `/skills`                                                                                                                                       | https://geminicli.com/docs/cli/skills/                                               |
| Custom commands        | Yes                                       | **TOML** in `~/.gemini/commands/` and `.gemini/commands/`; `prompt` required; `{{args}}`, `!{shell}`, `@{file}`; `git/commit.toml` → `/git:commit`                                                                                                                                                                | https://geminicli.com/docs/cli/custom-commands/                                      |
| Hooks                  | Yes                                       | `settings.json` `hooks`: SessionStart/End, BeforeAgent, AfterAgent, BeforeModel, AfterModel, BeforeToolSelection, BeforeTool, AfterTool, PreCompress, Notification                                                                                                                                                | https://geminicli.com/docs/hooks/                                                    |
| Plugins / extensions   | Yes                                       | `gemini extensions install\|uninstall\|list\|enable\|disable`                                                                                                                                                                                                                                                     | https://geminicli.com/docs/cli/cli-reference/                                        |
| MCP client             | Yes (tools); resources/prompts Unverified | `gemini mcp add\|remove\|list` (stdio + HTTP); `/mcp list\|desc\|schema\|enable\|auth`. Resource/prompt primitives not stated on the pages read                                                                                                                                                                   | https://geminicli.com/docs/cli/tutorials/mcp-setup/                                  |
| Image input            | Yes                                       | `read_file` "Supports text, images, audio, and PDF"; `@path` injects the file. Paste/drag not documented                                                                                                                                                                                                          | https://geminicli.com/docs/reference/tools/                                          |
| Image output           | Partial                                   | No built-in tool. Official extension `nanobanana` → `/generate`, `/story`; default model `gemini-3.1-flash-image-preview`                                                                                                                                                                                         | https://github.com/gemini-cli-extensions/nanobanana                                  |
| Web search / fetch     | Yes                                       | `google_web_search` (Search grounding) and `web_fetch` (URLs validated against private/reserved ranges)                                                                                                                                                                                                           | https://geminicli.com/docs/reference/tools/                                          |
| Computer use / browser | No                                        | Not in the built-in tool list; MCP only                                                                                                                                                                                                                                                                           | same                                                                                 |
| Sandbox                | Yes                                       | `-s`/`--sandbox`; `GEMINI_SANDBOX=true\|docker\|podman\|sandbox-exec\|runsc\|lxc`; macOS `SEATBELT_PROFILE` (6 profiles); Windows native sandbox                                                                                                                                                                  | https://geminicli.com/docs/cli/sandbox/                                              |
| Git worktrees          | Yes                                       | `--worktree`/`-w` behind `experimental.worktrees: true`; never auto-deletes a worktree with changes                                                                                                                                                                                                               | https://geminicli.com/docs/cli/git-worktrees/                                        |
| Context files          | Partial                                   | `GEMINI.md`, hierarchical `~/.gemini/` → `./` → `./src/`. **AGENTS.md is not read by default**; opt in with `"context": { "fileName": ["AGENTS.md","GEMINI.md"] }`                                                                                                                                                | https://geminicli.com/docs/cli/gemini-md/                                            |
| Models / quota         | Yes (quota); context window Unverified    | `-m`, default `auto`, aliases `pro\|flash\|flash-lite`; auto fallback routing; thinking via `modelConfigs.aliases` `thinkingBudget`/`thinkingLevel`. Daily: Google account 1,000; unpaid API key 250 (Flash only); AI Pro 1,500; AI Ultra 2,000; Workspace Std 1,500 / Ent 2,000. No context-window figure stated | https://geminicli.com/docs/resources/quota-and-pricing/                              |
| Runtime introspection  | Yes                                       | `gemini mcp list`, `extensions list`, `skills list --all`; `/tools`, `/mcp schema`, `/agents list`, `/commands list`. **JSON-ness of these listings is Unverified**; only the run output has `-o json`                                                                                                            | https://geminicli.com/docs/reference/commands/                                       |

### Qwen Code

**Not in `AGENT_KINDS`** — the gateway has no `qwen` kind. Included because it is
a plausible addition and because it reads `AGENTS.md` natively.

Fork status: originally based on Gemini CLI v0.8.2, but "starting from Qwen Code
v0.1, stopped syncing with upstream and began independent development"
(https://github.com/QwenLM/qwen-code).

| Capability             | Verdict                               | Note                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                           |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Headless               | Yes                                   | `qwen -p`; stdin piping without a flag; also a `qwen serve` daemon                                                                                                                                                                                                                                                                                                      | https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/              |
| Structured output      | Yes                                   | `--output-format json\|stream-json`, `--include-partial-messages`, `--max-session-turns`, `--max-wall-time`, `--system-prompt`                                                                                                                                                                                                                                          | same                                                                             |
| Session resume         | Yes                                   | `--continue` and `--resume [sessionId]`, both usable with `-p`; `qwen sessions list\|ps`                                                                                                                                                                                                                                                                                | same                                                                             |
| Auto-approve           | Yes                                   | `tools.approvalMode = plan\|default\|auto-edit\|auto\|yolo`; **`auto` uses an LLM safety classifier** — unique among the agents surveyed; `--yolo`/`-y`                                                                                                                                                                                                                 | https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/         |
| Subagents / teams      | Yes                                   | `.qwen/agents/` md+YAML; top-level subagents run **in background by default**; `list_agents` returns task_id+status, `send_message` resumes; `subagent_type: "fork"` inherits parent context and shares the prompt cache. README advertises Agent Teams (mechanics Unverified)                                                                                          | https://qwenlm.github.io/qwen-code-docs/en/users/features/sub-agents/            |
| Skills                 | Yes                                   | `SKILL.md`+YAML in `~/.qwen/skills/`, `.qwen/skills/`; `/skills`, `/<skill-name>`; `/learn <source>` auto-generates a skill                                                                                                                                                                                                                                             | https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/                |
| Custom commands        | Yes                                   | **Markdown** (TOML deprecated) in `~/.qwen/commands/`, `.qwen/commands/`; `{{args}}`, `!{cmd}`, `@{file}`                                                                                                                                                                                                                                                               | https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/              |
| Hooks / plugins        | Yes                                   | `/hooks` + `settings.json`; `/extensions`, `/reload-plugins`                                                                                                                                                                                                                                                                                                            | same                                                                             |
| MCP client             | Yes — **tools + resources + prompts** | `qwen mcp add/remove` with scope/transport/env/header/trust/include-tools; HTTP, SSE, stdio. Resources via `@server:uri`, prompts as slash commands. `tools.toolSearch.enabled` loads MCP tools on demand                                                                                                                                                               | https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/                   |
| Image input            | Partial                               | Model-dependent (`model.generationConfig.modalities.image`, `capabilities.vision`); `@path`+`read_file`. Open upstream issues on the `@image` attach path                                                                                                                                                                                                               | https://github.com/QwenLM/qwen-code/issues/7489                                  |
| Image output           | Unverified                            | No image-generation tool in the official tools reference                                                                                                                                                                                                                                                                                                                | https://qwenlm.github.io/qwen-code-docs/en/                                      |
| Web search / fetch     | Yes                                   | `web_fetch` (`format: auto\|markdown\|html\|text`, markdown negotiation cuts tokens up to 80%) and `web_search`                                                                                                                                                                                                                                                         | https://qwenlm.github.io/qwen-code-docs/en/developers/tools/web-fetch/           |
| Computer use / browser | No                                    | MCP only                                                                                                                                                                                                                                                                                                                                                                | https://qwenlm.github.io/qwen-code-docs/en/                                      |
| Sandbox                | Yes                                   | `-s`/`--sandbox=<provider>`; `QWEN_SANDBOX` env **overrides flag and settings**; `SEATBELT_PROFILE`, custom `.qwen/sandbox-macos-custom.sb`                                                                                                                                                                                                                             | https://qwenlm.github.io/qwen-code-docs/en/users/features/sandbox/               |
| Git worktrees          | Unverified                            | No worktree helper found in the docs                                                                                                                                                                                                                                                                                                                                    | —                                                                                |
| Context files          | **Yes, incl. AGENTS.md by default**   | `~/.qwen/QWEN.md` → `./QWEN.md` → `.qwen/QWEN.local.md` (last wins). "If your repository already has an `AGENTS.md` file for other AI tools, Qwen reads that too." Configurable via `context.fileName`                                                                                                                                                                  | https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/                |
| Models / quota         | Yes; quota numbers Partial            | Multi-provider (OpenAI, Anthropic, Gemini, Ollama/vLLM, DeepSeek, Kimi, OpenRouter…). Per-model `contextWindowSize`; README eval ran `context_1m=true`, 1,000,000 ctx / 64,000 max_tokens. `reasoning: { effort: low\|medium\|high\|max }`, `/effort`. **Qwen OAuth free tier discontinued 2026-04-15**; Coding Plan quota described only as "an included weekly quota" | https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/  |
| Runtime introspection  | Yes                                   | `--output-format json\|stream-json`; `qwen sessions list`, `qwen mcp` subcommands; `/tools`, `/skills`, `/mcp`, `/agents`, `/doctor`; **a documented Daemon REST API** for programmatic control                                                                                                                                                                         | https://qwenlm.github.io/qwen-code-docs/en/developers/daemon-rest-api-reference/ |

### Kimi CLI (Moonshot AI)

In `AGENT_KINDS` and in `HERDR_AGENTS` as `kimi`; the gateway ships no
dictionary, composer table or key profile for it.

Not a fork of Gemini CLI or Claude Code — an independent Python implementation
(`uv tool install kimi-cli`). Its flag vocabulary mirrors Claude Code's, and it
deliberately reads other vendors' directories.

| Capability             | Verdict                                   | Note                                                                                                                                                                                                                                                                                                                                                                  | Source                                                                   |
| ---------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Headless               | Yes                                       | `--print` (implicitly enables `--afk`); `--prompt`/`-p`/`--command`/`-c`; `--quiet` = `--print --output-format text --final-message-only`                                                                                                                                                                                                                             | https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html     |
| Structured output      | Yes — **bidirectional**                   | `--output-format text\|stream-json` **and `--input-format text\|stream-json`**; stdin read continuously until closed. Thinking excluded from JSONL; progress goes to stderr                                                                                                                                                                                           | https://moonshotai.github.io/kimi-cli/en/customization/print-mode.html   |
| Session resume         | Yes                                       | `--continue`/`-C`; `--session [ID]` / `--resume [ID]` / `-r`; `kimi export` dumps a session as ZIP                                                                                                                                                                                                                                                                    | https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html     |
| Auto-approve           | Yes                                       | `--yolo`/`-y` auto-approves tool calls but leaves `AskUserQuestion` reachable; `--afk` also auto-dismisses it; `default_yolo = true` in config; `--plan`                                                                                                                                                                                                              | same                                                                     |
| Subagents              | Yes (no teams)                            | `Agent` tool; built-in types `coder` (RW+shell), `explore` (read-only), `plan`; foreground and background; each instance has its own history at `subagents/<agent_id>/` and is resumable by id. **Subagents cannot spawn subagents**                                                                                                                                  | https://moonshotai.github.io/kimi-cli/en/customization/agents.html       |
| Skills                 | Yes — **cross-vendor**                    | `SKILL.md`+YAML; discovery Project > User > Extra > Built-in across `~/.kimi/skills/`, **`~/.claude/skills/`, `~/.codex/skills/`**, `~/.config/agents/skills/`, and `.kimi/`, `.claude/`, `.codex/`, `.agents/skills/`. `--skills-dir` repeatable. Invoke `/skill:<name>`. **Flow skills**: `type: flow` + an embedded Mermaid/D2 diagram executed via `/flow:<name>` | https://moonshotai.github.io/kimi-cli/en/customization/skills.html       |
| Hooks                  | Unverified                                | Not documented                                                                                                                                                                                                                                                                                                                                                        | —                                                                        |
| Plugins                | Yes                                       | `kimi plugin` subcommand (contract not in the pages read)                                                                                                                                                                                                                                                                                                             | https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html     |
| MCP client             | Yes (tools); resources/prompts Unverified | `kimi mcp add\|list\|remove\|auth\|test`; `~/.kimi/mcp.json`; stdio + HTTP with headers/OAuth; ad-hoc `--mcp-config-file` / `--mcp-config`, both repeatable                                                                                                                                                                                                           | https://moonshotai.github.io/kimi-cli/en/customization/mcp.html          |
| Image input            | Yes                                       | `ReadMediaFile` — "Read image or video files. Max file size 100MB"; **Ctrl-V pastes an image**; requires a model with the `image_in` capability                                                                                                                                                                                                                       | https://moonshotai.github.io/kimi-cli/en/faq.html                        |
| Image output           | Unverified                                | No image-generation tool documented                                                                                                                                                                                                                                                                                                                                   | —                                                                        |
| Web search / fetch     | Yes                                       | `SearchWeb` (up to 20 results) and `FetchURL` are default-agent tools                                                                                                                                                                                                                                                                                                 | https://moonshotai.github.io/kimi-cli/en/customization/agents.html       |
| Computer use / browser | No                                        | Via MCP only (docs show `chrome-devtools-mcp`)                                                                                                                                                                                                                                                                                                                        | https://moonshotai.github.io/kimi-cli/en/customization/mcp.html          |
| Sandbox / worktrees    | Unverified (likely none)                  | No sandbox section or `--sandbox` flag in the complete CLI reference; scope control is `--work-dir` and `--add-dir` only                                                                                                                                                                                                                                              | https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html     |
| Context files          | Partial                                   | **`AGENTS.md`** is the project context file ("If the project doesn't have an `AGENTS.md` file, you can run the `/init` command"). No `KIMI.md` documented; precedence undocumented                                                                                                                                                                                    | https://moonshotai.github.io/kimi-cli/en/guides/getting-started.html     |
| Models / quota         | Partial                                   | `-m`; `[models]` TOML with `provider`, model id, `max_context_size` (documented examples **262144** and **1047576**), `capabilities` (`thinking`, `image_in`); `--thinking`/`--no-thinking`. No published free-tier quota numbers                                                                                                                                     | https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html |
| Runtime introspection  | Yes                                       | `kimi info` ("version and protocol information"), `kimi mcp list`, `--output-format stream-json`; **`kimi acp`** (Agent Client Protocol server for Zed/JetBrains), `--wire` Wire server, `kimi web`, plus a separate Kimi Agent SDK                                                                                                                                   | https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html     |

**Kimi caveat.** The docs are mid-migration from "Kimi CLI"
(`moonshotai.github.io/kimi-cli`) to "Kimi Code"
(`moonshotai.github.io/kimi-code`). Every Kimi row above is from the `kimi-cli`
tree as of 2026-09-14 and flags may drift.

### GitHub Copilot CLI (`copilot`)

In `AGENT_KINDS` and `HERDR_AGENTS` as `copilot`; no gateway dictionary/composer/
key profile. This is the **agentic** `copilot` CLI (npm `@github/copilot`), not
the legacy `gh copilot` extension, which only suggested and explained shell
commands.

| Capability             | Verdict                | Note                                                                                                                                                                                                                                                                                                                      | Source                                                                                               |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Headless               | Yes                    | `copilot -p "PROMPT"`; stdin works (`echo … \| copilot`); `-s` suppresses stats                                                                                                                                                                                                                                           | https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically |
| Structured output      | **No**                 | No `--output-format`/JSON documented; only `-s` plain text and Markdown transcript export `--share=PATH` / `--share-gist`                                                                                                                                                                                                 | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference        |
| Session resume         | Yes                    | `--resume` (picker) and `/resume`; `--continue` for the most recent local session; `--remote --resume <TASK-ID>` pulls a remote task local                                                                                                                                                                                | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference             |
| Auto-approve           | Yes                    | `--allow-all-tools`, `--allow-all-paths`, `--allow-all-urls`, `--allow-all` (= `--yolo`); granular `--allow-tool='shell(git:*)'` / `--deny-tool`; `/allow-all`, `--no-ask-user`. Reads and read-only shell are auto-allowed; writes, destructive shell and URL fetches prompt in the TTY                                  | https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools                |
| Subagents              | Yes                    | Automatic subagent delegation to keep the main context focused; custom agents via `*.agent.md`, `--agent=`, `/agent`; a `subagentStop` hook                                                                                                                                                                               | https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features                |
| Skills                 | Yes — **cross-vendor** | `SKILL.md` in `~/.copilot/skills`, `~/.agents/skills`, `.github/skills`, **`.claude/skills`**, `.agents/skills`                                                                                                                                                                                                           | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills                  |
| Hooks / plugins        | Yes                    | Hooks `preToolUse`, `postToolUse`, `userPromptSubmitted`, `sessionStart/End`, `errorOccurred`, `agentStop`, `subagentStop`; plugins bundle agents+skills+hooks+MCP (`copilot plugin`, `/plugins`)                                                                                                                         | https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features                |
| MCP client             | Yes (tools)            | `copilot mcp` subcommands + `/mcp add\|edit\|delete`; `~/.copilot/mcp-config.json`; stdio and remote. Resources/prompts not documented                                                                                                                                                                                    | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers             |
| Image input            | Yes                    | `@path`, drag-drop, or clipboard paste; JPEG, PNG, GIF, WEBP, PDF, HEIC, HEIF                                                                                                                                                                                                                                             | https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview                      |
| Image output           | No                     | Not built in; docs cite image generation as an example of what an MCP server adds                                                                                                                                                                                                                                         | https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features                |
| Web search / fetch     | Yes                    | `web_fetch` gated by `--allow-url`/`--deny-url`/`--allow-all-urls`; **`/research TOPIC`** is a read-only agent with a hard-coded model that searches the codebase, GitHub repos and the web                                                                                                                               | https://docs.github.com/en/copilot/concepts/agents/copilot-cli/research                              |
| Computer use / browser | No                     | MCP only                                                                                                                                                                                                                                                                                                                  | https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features                |
| Sandbox                | Partial                | `copilot --experimental` then `/sandbox enable` — macOS 15+ Seatbelt, Linux bubblewrap 0.5+, Windows 11 ProcessContainer/BaseContainer; cloud sandbox via `copilot --cloud --experimental`. No worktree helper documented                                                                                                 | https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes                          |
| Context files          | Yes                    | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `$HOME/.copilot/copilot-instructions.md`; `copilot instruction` lists what was discovered; `copilot init` scaffolds                                                                                                          | https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features                |
| Models / plans         | Yes                    | `/model`; latest models 1M context with configurable reasoning levels; custom providers via env vars (OpenAI-compatible, Azure OpenAI, Anthropic, Ollama). **Requires a Copilot plan**; draws on the same AI-credit / premium-request pool as the IDE and github.com; 10% discount on auto model selection for paid plans | https://docs.github.com/en/copilot/get-started/plans                                                 |
| Runtime introspection  | Partial                | `copilot help`, `version`, `mcp`, `skill`, `instruction`, `lsp`, `completion SHELL`, in-session `?`. **No documented JSON emission anywhere**                                                                                                                                                                             | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference             |

### Cursor CLI (`cursor-agent` / `agent`)

In `AGENT_KINDS`, `HERDR_AGENTS`, and the tmux `AGENTS` detection list as
`cursor`; no dictionary/composer/key profile.

| Capability                 | Verdict                       | Note                                                                                                                                                                                                                                                                                                                                                                    | Source                                              |
| -------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Headless                   | Yes                           | `agent -p "prompt"`; **print mode grants all tools including write and shell**; `--trust` for headless workspace trust                                                                                                                                                                                                                                                  | https://cursor.com/docs/cli/headless                |
| Structured output          | Yes                           | `--output-format text\|json\|stream-json`; NDJSON events `system/init`, `user`, `assistant`, `tool_call` (started/completed), `result` with `session_id`, `duration_ms`, `is_error`; `--stream-partial-output` for char deltas                                                                                                                                          | https://cursor.com/docs/cli/reference/output-format |
| Session resume             | Yes                           | `--resume [chatId]`, `--continue` (= `--resume=-1`), `agent ls`, `agent resume`, `/resume`, `agent create-chat` returns a new chat id                                                                                                                                                                                                                                   | https://cursor.com/docs/cli/reference/parameters    |
| Auto-approve               | Yes                           | `-f`/`--force` (alias `--yolo`) "force allow commands unless explicitly denied"; `--approve-mcps`; deny-over-allow rules in `~/.cursor/cli-config.json` and `<project>/.cursor/cli.json` as `Shell(ls)`, `Read(src/**)`, `Write(pkg.json)`, `WebFetch(host)`, `Mcp(server:*)`. Interactive runs prompt per action                                                       | https://cursor.com/docs/cli/reference/permissions   |
| Subagents                  | Yes                           | Subagents run in parallel with their own context, prompts, tools and models, "in the editor and the Cursor CLI" (2.4)                                                                                                                                                                                                                                                   | https://cursor.com/changelog/2-4                    |
| Skills                     | Yes — **cross-vendor**        | `SKILL.md` in `.cursor/skills`, `.agents/skills`, `~/` equivalents, plus `.claude/skills` / `.codex/skills` compat                                                                                                                                                                                                                                                      | https://cursor.com/docs/skills                      |
| Commands / hooks / plugins | Yes                           | `/plan`, `/ask`, `/summarize`, `/resume`; `hooks.json` at project `.cursor/`, `~/.cursor/`, enterprise and team scope, incl. `preToolUse`, `subagentStart`, `beforeShellExecution`; `--plugin-dir <path>`                                                                                                                                                               | https://cursor.com/docs/hooks                       |
| MCP client                 | Yes (tools)                   | `agent mcp list`, `mcp list-tools <id>`, `mcp login/enable/disable`; same config and precedence as the editor (project → global → nested); stdio, HTTP, SSE. Resources/prompts not documented                                                                                                                                                                           | https://cursor.com/docs/cli/mcp                     |
| Image input                | Partial                       | The read-files tool "supports image files (.png, .jpg, .gif, .webp, .svg)" and headless docs say images referenced by path are read via tool calling. **No documented clipboard paste in the CLI**                                                                                                                                                                      | https://cursor.com/docs/agent/tools                 |
| Image output               | **Yes**                       | Image-generation tool (from text or reference images), saves into `assets/`; 2.4 states it works in the Cursor CLI                                                                                                                                                                                                                                                      | https://cursor.com/changelog/2-4                    |
| Web search / fetch         | Yes                           | Built-in "Web" tool generates queries and searches; `WebFetch(domain)` is a first-class permission type                                                                                                                                                                                                                                                                 | https://cursor.com/docs/agent/tools                 |
| Computer use / browser     | Partial                       | A built-in Browser tool (screenshots, test apps, verify visual changes) is documented for "Agent"; **the docs do not say whether it is available in the CLI**                                                                                                                                                                                                           | https://cursor.com/docs/agent/tools/browser         |
| Sandbox                    | Yes                           | `--sandbox enabled\|disabled` (persists across sessions), `agent sandbox enable/disable/reset/run <cmd>`; sudo password handled over IPC, never seen by the model                                                                                                                                                                                                       | https://cursor.com/docs/cli/overview                |
| Git worktrees              | **Yes, built in**             | `-w`/`--worktree [name]` under `~/.cursor/worktrees/`, `--worktree-base <branch>`, `--skip-worktree-setup` (`.cursor/worktrees.json`)                                                                                                                                                                                                                                   | https://cursor.com/docs/cli/reference/parameters    |
| Context files              | Yes — **the broadest reader** | The CLI "automatically loads" `.cursor/rules` (`.mdc`), **`AGENTS.md` and `CLAUDE.md`** at project root. `.cursorrules` (legacy dotfile) is not discussed on the current rules page — Unverified for the CLI                                                                                                                                                            | https://cursor.com/docs/cli/using                   |
| Models / plans             | Yes                           | `--model`, `--list-models`, `agent models`, `--mode plan\|ask`, `--plan`. Models incl. Claude Opus 5 / Sonnet 5 / Fable 5.1, GPT-5.6 Sol/Terra/Luna, Gemini 3.1 Pro / 3.8 Flash, Grok 4.6/4.5, Composer 2.5. Plans Start ₹649 (Cursor Models only), Pro $20, Pro Plus $60, Ultra $200, Teams $40/$120 per user, Enterprise; `--api-key` / `CURSOR_API_KEY` for headless | https://cursor.com/docs/models-and-pricing          |
| Runtime introspection      | Yes                           | `--help`, `-v`, `about`, `--list-models`, `models`, `mcp list`, `mcp list-tools`, `--output-format json`, `worker debug`                                                                                                                                                                                                                                                | https://cursor.com/docs/cli/reference/parameters    |

### Factory Droid CLI (`droid`)

In `AGENT_KINDS` and `HERDR_AGENTS` as `droid`; no gateway dictionary/composer/
key profile.

| Capability               | Verdict                       | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                                              |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Headless                 | Yes                           | `droid exec [options] [prompt]`; `-f/--file <path>` reads the prompt from a file; stdin piping (`git diff \| droid exec "draft release notes"`)                                                                                                                                                                                                                                                                                                                  | https://docs.factory.ai/droid-exec/overview         |
| Structured output        | Yes — **richest**             | `-o/--output-format text\|json\|stream-json\|**stream-jsonrpc**`; JSON carries `type`, `subtype`, `is_error`, `duration_ms`, `num_turns`, `result`, `session_id`; `--input-format` for multi-turn. Exit codes 0 ok / 1 runtime / 2 bad args                                                                                                                                                                                                                      | https://docs.factory.ai/reference/cli-reference     |
| Session resume           | Yes                           | `-s/--session-id <id>` continues in exec; `-r/--resume [sessionId]`, `--fork <id>`, `/sessions`, `/tree`, `droid search "query" --json`                                                                                                                                                                                                                                                                                                                          | same                                                |
| Auto-approve             | Yes — **graded**              | Read-only by default; `--auto low` (safe edits) / `medium` (install, build, test, local commits) / `high` (push, deploy); `--skip-permissions-unsafe` removes all checks. Interactive is propose-and-approve with diffs, Ctrl+L cycles autonomy, Alt+E toggles approval details; `commandAllowlist`/`commandDenylist`/`commandBlocklist`, enterprise `maxAutonomyLevel`. **Exec fails fast when a run exceeds its level**                                        | https://docs.factory.ai/droid-exec/overview         |
| Subagents                | Yes                           | Custom droids in `.factory/droids/*.md` / `~/.factory/droids/`; a Task tool with `subagent_type`, `run_in_background: true` + `TaskOutput`; **multiple Task calls in one turn run concurrently**; `subagentAutonomyLevel`; Missions (`/missions`, `droid exec --mission`, `--worker-model`, `--validator-model`)                                                                                                                                                 | https://docs.factory.ai/harness/subagents           |
| Skills / hooks / plugins | Yes                           | `SKILL.md` in `.factory/skills/`, `~/.factory/skills/`, `.agents/skills`, mission and plugin scopes; `/skills`, `/create-skill`, `/commands`; `/hooks` lifecycle hooks (`hooksDisabled` kills them globally); `droid plugin install\|uninstall\|update\|list\|marketplace -s user\|project`                                                                                                                                                                      | https://docs.factory.ai/harness/skills              |
| MCP client               | Yes (tools)                   | `droid mcp add <name> <urlOrCommand...> --type stdio\|http\|sse [--env] [--header]`, `list`, `remove`, `permissions list\|revoke\|clear`, `/mcp`; `~/.factory/mcp.json` plus ancestor and project `.factory/mcp.json`. **Approvals persist and are bound to a transport fingerprint**                                                                                                                                                                            | https://docs.factory.ai/harness/mcp                 |
| Image input              | Yes                           | Ctrl+V pastes an image from the clipboard in interactive mode                                                                                                                                                                                                                                                                                                                                                                                                    | https://docs.factory.ai/reference/cli-reference     |
| Image output             | No                            | No image-generation tool documented                                                                                                                                                                                                                                                                                                                                                                                                                              | same                                                |
| Web search / fetch       | **Unverified**                | No built-in web search or fetch tool listed; the MCP registry ships external servers instead. `droid exec --list-tools` is the authoritative runtime check                                                                                                                                                                                                                                                                                                       | https://docs.factory.ai/cli/configuration/mcp       |
| Computer use / browser   | No                            | Not built in; docs point at the `playwright` MCP server                                                                                                                                                                                                                                                                                                                                                                                                          | same                                                |
| Sandbox                  | Yes                           | macOS Seatbelt, Linux/WSL2 bubblewrap+seccomp, HTTP/SOCKS filtering proxy on all platforms; `sandbox.enabled`, `mode: per-command\|whole-process`, `filesystem.allowWrite/denyRead`, `network.allowedDomains`. Defaults deny writes outside cwd and deny network except Factory/WorkOS                                                                                                                                                                           | https://docs.factory.ai/autonomy-and-safety/sandbox |
| Git worktrees            | **Yes, built in**             | `-w`/`--worktree [name]` on both `droid` and `droid exec`, default `~/.factory/worktrees`, branch `<current>-wt`; **exec removes clean worktrees on exit**                                                                                                                                                                                                                                                                                                       | https://docs.factory.ai/reference/cli-reference     |
| Context files            | Yes — **the most permissive** | `AGENTS.md` (also `agents.md`, `Agents.md`, `CLAUDE.md`, `Claude.md`), searched upward to git root in `.factory/`, `.agents/`, `.agent/` and their `~/` equivalents; project overrides personal, nested overrides root; 80k char initial load, 40k for read-path discovery. `/droids` can import droids from Claude Code                                                                                                                                         | https://docs.factory.ai/harness/agents-md           |
| Models / plans           | Yes                           | `-m/--model`, `-r/--reasoning-effort` (`off`…`max`, per model), Tab cycles effort, Ctrl+N cycles model, `--spec-model`, `--worker-model`, `--validator-model`. Models incl. Claude Opus 5 / Sonnet 5 / Fable 5.1, GPT-5.6 Sol/Terra/Luna, Gemini 3.1 Pro, Grok 4.6, GLM-5.3, Kimi K3, DeepSeek V4, Inkling. Plans Pro $20 / Plus $100 / Max $200 all include Droid CLI + SDK; **BYOK free up to an allowance on all individual plans**; `FACTORY_API_KEY` for CI | https://docs.factory.ai/models                      |
| Runtime introspection    | Yes — **best in class**       | **`droid exec --list-tools`** (the only agent surveyed with a first-class tool-listing subcommand), `droid mcp list`, `droid plugin list`, `droid search --json`, `-o json`, `/diagnostics`, `/status`                                                                                                                                                                                                                                                           | https://docs.factory.ai/reference/cli-reference     |

### Amp (Sourcegraph)

In `AGENT_KINDS` and the tmux `AGENTS` detection list as `amp`; not in
`HERDR_AGENTS`; no dictionary/composer/key profile.

| Capability             | Verdict                     | Note                                                                                                                                                                                                                                                                                                                                                                                                                                        | Source                                                 |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Headless               | Yes                         | `amp -x "…"` / `--execute`; stdin (`cat file \| amp -x "question"`); **execute mode auto-engages when stdout is redirected**. `AMP_API_KEY` (`sgamp_…`) for non-interactive auth                                                                                                                                                                                                                                                            | https://ampcode.com/docs/cli/execute-mode              |
| Structured output      | Yes                         | `--stream-json` (requires `--execute`), **`--stream-json-input`** reads messages from stdin, `--stream-json-thinking` adds thinking blocks; message types assistant / user / result / system-init / system-error, each carrying `session_id` and token usage                                                                                                                                                                                | https://ampcode.com/docs/cli/streaming-json            |
| Session resume         | Yes                         | Threads, not sessions: `amp threads continue T-…` (combinable with `--execute` and `--stream-json`); also `threads list`, `search`, `markdown`/`export`, `share --visibility`                                                                                                                                                                                                                                                               | https://ampcode.com/docs/threads                       |
| Auto-approve           | **Yes, inverted**           | "Amp does not ask for approval before running tools" — there is no approval prompt to bypass and no `--dangerously-allow-all`. **Restriction is opt-in**: a custom policy plugin intercepting `tool.call` (`allow`/`reject-and-continue`/`modify`/`synthesize`), `amp.tools.disable`, and `amp.mcpPermissions` matching on command/args/url                                                                                                 | https://ampcode.com/docs/tools                         |
| Subagents              | Yes                         | Built-in subagents Search, Oracle, Librarian, Read Thread; they run in isolation and return only a final summary. Plugins define custom subagents via `amp.createAgent(...)` + `registerTool(...)` with `parentThreadID`                                                                                                                                                                                                                    | https://ampcode.com/docs/markdown/models-and-subagents |
| Skills / plugins       | Yes — **cross-vendor**      | `SKILL.md` from `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`, project `.agents/skills/`, **`.claude/skills/`, `~/.claude/skills/`, `~/.claude/plugins/cache/`** (`amp.skills.disableClaudeCodeSkills` opts out). Plugins are TS/JS modules: `amp.on(...)`, `registerTool`, `registerSkill`, `registerCommand`, `registerAgentMode`; `amp plugins add/list/repositories/show-agent-options`                      | https://ampcode.com/docs/customize/skills              |
| MCP client             | Yes (tools)                 | `amp mcp add <name> -- npx …` (stdio) or `amp mcp add <name> <url>`; `amp mcp doctor`, `approve`, `remote list`, `remote tools [server] --refresh`; `amp.mcpServers` in settings; `--mcp-config` has highest precedence. Resources/prompts not mentioned                                                                                                                                                                                    | https://ampcode.com/docs/customize/mcp                 |
| Image input            | Yes                         | Ctrl+V pastes from the clipboard (or Ctrl+O → "paste image from clipboard"); drag-and-drop image files                                                                                                                                                                                                                                                                                                                                      | https://ampcode.com/docs/cli                           |
| Image output           | **Yes**                     | A **Painter** tool generates and edits images (**GPT Image 2**) — UI mockups, icons, hero images, redacting screenshots                                                                                                                                                                                                                                                                                                                     | https://ampcode.com/docs/tools                         |
| Web search / fetch     | **Unverified**              | The tools page enumerates only Oracle, Librarian and Painter and defers the rest to `amp tools list`. Librarian searches GitHub code, not the open web                                                                                                                                                                                                                                                                                      | same                                                   |
| Computer use / browser | **Unverified**              | No browser tool named in the docs; `amp tools list` is the authoritative runtime check                                                                                                                                                                                                                                                                                                                                                      | same                                                   |
| Sandbox                | Partial                     | **Orbs** are remote isolated machines — "a fresh, isolated environment with your code, plugins, development tools"; `amp -ox "…"`, `--executor local\|orb\|runner:<id>`, `--orb-size`. **No local OS sandbox and no worktree helper documented**                                                                                                                                                                                            | https://ampcode.com/docs/orbs                          |
| Context files          | Yes                         | `AGENTS.md`, falling back to `AGENT.md` then `CLAUDE.md`; cwd upward to `$HOME`, plus `/etc/ampcode/AGENTS.md`, `/Library/Application Support/ampcode/AGENTS.md`, `%ProgramData%\ampcode\AGENTS.md`, `$HOME/.config/amp/AGENTS.md`, `$HOME/.config/AGENTS.md`; a subtree `AGENTS.md` loads when a file in that subtree is read                                                                                                              | https://ampcode.com/docs/customize/agents-md           |
| Models / plans         | Partial — **no model flag** | There is no `--model`: you pick a mode on "the dial" — `low` (GLM-5.3-Flash · high), `medium` (GPT-5.6 Sol · med), `high` (GPT-6 Astra · med), `ultra` (Fable 5.1 · high), each pairing an Oracle model. **Reasoning effort is bundled into the mode, not user-set.** `--fast` per invocation. Monthly tiers plus credits at provider rates with no markup for individuals; credits expire 12 months after purchase; orbs billed per minute | https://ampcode.com/models                             |
| Runtime introspection  | Yes                         | **`amp tools list`**, `amp plugins list`, `amp plugins show-agent-options` (models + built-in tools), `amp mcp doctor`, `amp mcp remote tools`, `amp threads list`, `--stream-json`, `amp --help`, `amp version`                                                                                                                                                                                                                            | https://ampcode.com/docs/cli                           |

### Crush (Charm)

**Not in `AGENT_KINDS`** — the gateway has no `crush` kind. Included for
comparison. Charm ships no standalone docs site: the canonical sources are the
README, `docs/`, `schema.json` and the Go source, so several rows below rest on
code rather than prose.

| Capability             | Verdict                                  | Note                                                                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                  |
| ---------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Headless               | Yes                                      | `crush run [prompt...]` — "prompt can be provided as arguments or piped from stdin"; `-q/--quiet`, `-m/--model`, `--small-model`, `--reasoning-effort`, `-s`, `-C`. **`--yolo` is root-only and is not accepted by `run`**                                                                                                                                                                                              | https://github.com/charmbracelet/crush/blob/main/internal/cmd/run.go                    |
| Structured output      | Partial                                  | `crush run` emits **plain text only** — no `--format json`, no event stream. JSON exists elsewhere: `crush session list\|show\|last --json`, `crush schema`, the server's OpenAPI                                                                                                                                                                                                                                       | same                                                                                    |
| Session resume         | Yes                                      | `-s/--session <id>` and `-C/--continue` (mutually exclusive) on both `crush` and `crush run`; `crush session list/show/last/delete/rename`                                                                                                                                                                                                                                                                              | https://github.com/charmbracelet/crush/blob/main/internal/cmd/root.go                   |
| Auto-approve           | Yes                                      | `crush --yolo`/`-y`; `permissions allow view edit …` / `permissions deny bash` in `crushrc` (JSON `permissions.allowed_tools`, `options.disabled_tools`). TTY prompt = **a** allow / **s** allow-for-session / **d** deny. Headless `run` auto-approves via `AutoApproveSession` in `app.go`, not via a flag                                                                                                            | https://github.com/charmbracelet/crush#you-only-live-once                               |
| Subagents              | Partial                                  | **One built-in read-only sub-agent**: an `agent` tool with access to glob, grep, ls, view; coordinator agents `coder`/`task`. No user-defined subagents, no teams, no parallel fan-out. Multiple TUIs can share a workspace via `--cwd` against a Crush server                                                                                                                                                          | https://github.com/charmbracelet/crush/blob/main/internal/agent/templates/agent_tool.md |
| Skills                 | Yes — **the widest cross-vendor reader** | Agent Skills (`SKILL.md`) from `$CRUSH_SKILLS_DIR`, `~/.config/{agents,crush}/skills`, `~/.agents/skills`, **`~/.claude/skills`**, `.agents/skills`, `.crush/skills`, **`.claude/skills`, `.cursor/skills`**; `user-invocable: true` surfaces as a ctrl+p command                                                                                                                                                       | https://github.com/charmbracelet/crush#agent-skills                                     |
| Hooks / plugins        | Partial                                  | **`PreToolUse` only** — `hook add <event> --command`, exit 2 blocks, exit 49 halts the turn. LSP is first-class (`lsp add go --command gopls`). **No plugin system**                                                                                                                                                                                                                                                    | https://github.com/charmbracelet/crush/blob/main/docs/hooks/README.md                   |
| MCP client             | Yes — **tools + resources**              | `stdio`, `http`, `sse`; `mcp add <name> --type --url/--command --header --timeout --enabled-tools --disabled-tools --oauth`; `mcp` key in `crushrc`. **Resources are exposed as `list_mcp_resources` / `read_mcp_resource` tools** — one of only two agents surveyed with documented resource support. No `crush mcp list` CLI                                                                                          | https://github.com/charmbracelet/crush#mcps                                             |
| Image input            | Yes                                      | TUI "Add Image" file picker (PNG/JPEG); model-gated by `model add … --supports-images` (schema `supports_attachments`). Paste path Unverified                                                                                                                                                                                                                                                                           | https://github.com/charmbracelet/crush/blob/main/internal/ui/dialog/filepicker.go       |
| Image output           | No                                       | No generation tool; `internal/ui/image` is terminal rendering only                                                                                                                                                                                                                                                                                                                                                      | https://github.com/charmbracelet/crush/tree/main/internal/agent/tools                   |
| Web search / fetch     | Yes                                      | Built-in `web_search` (DuckDuckGo) and `web_fetch` (URL → markdown, >50 KB spilled to a temp file), plus `download` and `sourcegraph`                                                                                                                                                                                                                                                                                   | https://github.com/charmbracelet/crush/blob/main/internal/agent/tools/web_search.md.tpl |
| Computer use / browser | No                                       | No such tool in `internal/agent/tools`                                                                                                                                                                                                                                                                                                                                                                                  | https://github.com/charmbracelet/crush/tree/main/internal/agent/tools                   |
| Sandbox / worktrees    | Partial                                  | **No sandbox** — no seatbelt/landlock/container code; isolation is permission prompts plus `PreToolUse` hooks. **No worktree helpers.** Git: respects `.gitignore`/`.crushignore`; commit attribution via `attribution-trailer-style assisted-by\|co-authored-by\|none`. No auto-commits                                                                                                                                | https://github.com/charmbracelet/crush#ignoring-files                                   |
| Context files          | Yes — **reads everyone's**               | Default context paths: `.github/copilot-instructions.md`, **`.cursorrules`**, `.cursor/rules/`, `CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, `CRUSH.md`/`crush.md` (+`.local.md`), `AGENTS.md`; global `~/.config/crush/CRUSH.md` + `~/.config/AGENTS.md`. `/init` writes `AGENTS.md` by default                                                                                                                        | https://github.com/charmbracelet/crush/blob/main/internal/config/config.go              |
| Models                 | Yes                                      | BYO keys (Anthropic, OpenAI, Gemini, Bedrock, Vertex, Azure, OpenRouter, Groq…); `provider add <id> --type openai\|openai-compat\|anthropic\|ollama\|llamacpp\|lmstudio\|litellm\|omlx`; `model large`/`model small` slots; `--think`, `--reasoning-effort low\|medium\|high`. Model DB is Catwalk (`CATWALK_URL`, `crush update-providers`). Charm Hyper is the subscription (`HYPER_API_KEY`); plan limits Unverified | https://github.com/charmbracelet/crush#api-keys                                         |
| Runtime introspection  | Yes                                      | `crush schema` (config JSON Schema, also live at https://charm.land/crush.json); **`crush server`** → HTTP+SSE API `/v1/health`, `/v1/version`, `/v1/config`, `/v1/workspaces/...` (sessions, agent, permissions, skills, MCP, LSP) with **OpenAPI 3.1 at `GET /v1/docs/openapi.json`**; `crush session … --json`. README says `crush serve` but the cobra command is `server`                                          | https://github.com/charmbracelet/crush/blob/main/internal/server/docs.go                |

### Aider

**Not in `AGENT_KINDS`** — the gateway has no `aider` kind, and three separate
tests assert `aider` resolves to no dictionary, composer table or profile
(`src/composer.rs:1102`, `src/composer.rs:1353`, `src/parts.rs:1277`). Read at
`main`, v0.86.3.dev.

| Capability                          | Verdict                      | Note                                                                                                                                                                                                                                                                                                                                                                                                                                     | Source                                                         |
| ----------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Headless                            | Yes                          | `--message`/`--msg`/`-m "..."` and `--message-file`/`-f FILE` — "process reply then exit (disables chat mode)"; `--commit` and `--exit` also exit. **Stdin prompt Unverified** — no doc and no stdin read in `main.py`/`io.py`                                                                                                                                                                                                           | https://aider.chat/docs/scripting.html                         |
| Structured output                   | Partial                      | **No JSON output at all.** Text only, plus `--verbose`, `--chat-history-file`, `--llm-history-file`, `.aider.input.history`                                                                                                                                                                                                                                                                                                              | https://aider.chat/docs/config/options.html                    |
| Session resume                      | Partial                      | `--restore-chat-history` (default False) reloads prior messages from the history file; `/save` / `/load FILE` and `--load FILE` replay file-add commands. **No session ids**                                                                                                                                                                                                                                                             | https://aider.chat/docs/usage/commands.html                    |
| Auto-approve                        | Yes                          | `--yes-always` "Always say yes to every confirmation"; `--dry-run`, `--no-auto-lint`, `--auto-test`. TTY = inline y/n prompts (**not a numbered menu**, so `approvals.rs`'s detector would not fire — see Part 3)                                                                                                                                                                                                                        | https://aider.chat/docs/config/options.html                    |
| Subagents                           | Partial                      | No subagents, no parallelism. Instead a **two-model pair**: `--architect` (or `/architect`, `--chat-mode architect`) with `--editor-model` and `--editor-edit-format`; `--weak-model` for commit messages and summaries                                                                                                                                                                                                                  | https://aider.chat/docs/usage/modes.html                       |
| Skills / commands / hooks / plugins | Partial                      | **No SKILL.md, no hooks, no plugins, no user slash commands.** It has `/run` (`!`), `/test`, `/lint`, `--lint-cmd`, `--test-cmd`, `--auto-lint`, `--auto-test`; `CONVENTIONS.md` is loaded only via `--read` / `/read-only` / `read:` in `.aider.conf.yml`                                                                                                                                                                               | https://aider.chat/docs/usage/conventions.html                 |
| MCP client                          | **No**                       | Zero "mcp" hits in the docs or in `aider/args.py` / `main.py` on `main` (v0.86.3.dev); only open issues (#2525, #4506)                                                                                                                                                                                                                                                                                                                   | https://github.com/Aider-AI/aider/tree/main/aider/website/docs |
| Image input                         | Yes                          | `/add image.png`, **`/paste`** (clipboard image), or `aider image.png`; requires a vision model                                                                                                                                                                                                                                                                                                                                          | https://aider.chat/docs/usage/images-urls.html                 |
| Image output                        | No                           | Nothing documented                                                                                                                                                                                                                                                                                                                                                                                                                       | same                                                           |
| Web search / fetch                  | Partial                      | **Fetch only**: `/web <url>` scrapes to markdown; a pasted URL prompts to scrape; `python -m aider.scrape <url>` (Playwright if installed). No search engine                                                                                                                                                                                                                                                                             | same                                                           |
| Computer use / browser              | No                           | `--browser`/`--gui` launches aider's **Streamlit chat UI** (`aider/gui.py`) — not browser automation                                                                                                                                                                                                                                                                                                                                     | https://aider.chat/docs/usage/browser.html                     |
| Sandbox / worktrees                 | Partial                      | No sandbox, no worktree helper. But **the deepest git integration of any agent surveyed**: `--auto-commits` defaults **True** (commits every LLM edit with a generated message), `--dirty-commits` defaults True (commits pre-existing dirty changes first), `--attribute-author`/`--attribute-committer`/`--attribute-co-authored-by` all True, `--commit-prompt`, `/undo` reverts aider's last commit, `--no-git` is "not recommended" | https://aider.chat/docs/git.html                               |
| Context files                       | Partial — **shares nothing** | Auto-read: `.aider.conf.yml` (home → git root → cwd, later wins), `.env`, `.aiderignore`, `.aider.model.settings.yml`, `.aider.model.metadata.json`, plus its repo map. `CONVENTIONS.md` is **not** automatic. **`AGENTS.md` and `CLAUDE.md` are not supported** — nothing is shared with other agents by convention                                                                                                                     | https://aider.chat/docs/config/aider_conf.html                 |
| Models                              | Yes                          | LiteLLM-backed BYO keys (OpenAI, Anthropic, Gemini, DeepSeek, Ollama, Azure, Bedrock, Vertex, OpenRouter, Copilot, OpenAI-compatible); `--model`, `--alias`, `/model`; `--reasoning-effort`, `--thinking-tokens` (0 disables), `/reasoning-effort`, `/think-tokens`; pricing from LiteLLM metadata or `--model-metadata-file`, shown by `/tokens`                                                                                        | https://aider.chat/docs/llms.html                              |
| Runtime introspection               | Partial                      | **Human-readable only**: `--help`, `--version`, `--list-models`/`--models NAME`, `/models`, `/help`. No HTTP API and no JSON. A Python entry point exists (`Coder.create(...)`, `coder.run(...)`) but the docs call it "not officially supported"                                                                                                                                                                                        | https://aider.chat/docs/scripting.html                         |

---

## Part 3 — Implications

### A. Truly agent-specific (another agent cannot get it via MCP or a skill)

1. **Sandboxing and the approval model.** An OS sandbox is a property of the
   process that spawns the shell — it cannot be handed to another agent. Claude
   Code, Codex, Gemini, Qwen, Cursor and Droid have one; Copilot has one behind
   `--experimental`; opencode, Crush, Aider and (per docs read) Kimi have none.
   Amp inverts the question entirely: it never asks for approval, and restriction
   is opt-in through a policy plugin. Droid is the only one with _graded_
   autonomy (`--auto low|medium|high`) that fails fast when a run exceeds its
   level.
2. **Built-in git worktrees.** Claude Code (`EnterWorktree`, subagent
   `isolation: worktree`), Cursor (`-w`), Droid (`-w`, auto-removes clean ones)
   and Gemini (`--worktree`, experimental) have them. Codex, opencode, Crush,
   Aider, Copilot, Amp and Kimi do not. This directly overlaps `POST /tasks`'s
   own `branch_name` worktree — two mechanisms that must not both run.
3. **Structured output on the wire.** Not addable by a skill. Rich:
   Droid (`stream-jsonrpc`), Claude Code and Kimi (both with _stream-json
   input_), Amp (`--stream-json-input`), Cursor, Gemini, Qwen. Thin: Codex
   (`--json` output only), opencode (`--format json`). **None: Copilot CLI,
   Crush's `run`, Aider.**
4. **A local HTTP/RPC control surface.** opencode (OpenAPI 3.1 at `GET /doc`,
   the basis of `src/native.rs`), Crush (`crush server`, OpenAPI at
   `/v1/docs/openapi.json`), Qwen (daemon REST API), Codex (`codex app-server`),
   Kimi (`kimi acp`, `--wire`). This is what makes structured reads possible at
   all; everything else is glyph-scraping.
5. **Native image generation.** Codex `$imagegen` (**not `$imggen`** — a
   built-in skill, model fixed at `gpt-image-2`, counted against Codex usage
   limits and burning them 3–5× faster), Amp's Painter tool (GPT Image 2),
   Cursor's image tool (writes to `assets/`), Gemini via the official
   `nanobanana` extension. Claude Code, Copilot, Droid, opencode, Crush, Aider
   and Kimi have none.
6. **Vendor-gated browser control.** Claude Code's `--chrome` needs the Chrome
   extension **and a direct Anthropic plan** (not Bedrock/Foundry/GCP). Codex's
   browser is explicitly absent from the CLI. Everyone else is MCP-only.
7. **Plan and seat gating.** Copilot CLI requires a Copilot subscription and
   draws on the same credit pool as the IDE. Codex image generation depends on
   plan and workspace settings. Amp has no `--model` flag at all — a mode dial
   binds model _and_ reasoning effort together, so "route this to a cheap model
   on Amp" is not expressible.
8. **Aider's git behaviour.** `--auto-commits` and `--dirty-commits` default to
   **True**: it commits every LLM edit, and commits pre-existing dirty changes
   first. No other agent surveyed does this. It is also the only one that reads
   neither `AGENTS.md` nor `CLAUDE.md`.

### B. Commodity (assume it, do not route on it)

- Headless invocation, session resume by id, MCP _tools_, image _input_, some
  form of auto-approve, and `SKILL.md` — every agent in Part 2 except Aider has
  essentially all of these, and Aider has most.
- `SKILL.md` at `.agents/skills` is now genuinely cross-vendor: Codex, Gemini,
  Qwen, Droid, Amp, opencode, Crush, Copilot and Cursor all read it, and Kimi,
  Crush, Copilot, Cursor, Amp and opencode additionally read `.claude/skills`.
  A capability delivered as a skill in `.agents/skills` is portable; one
  delivered as a Claude Code plugin or a Codex hook is not.
- `AGENTS.md` is the near-universal memory file. The exceptions are the ones to
  remember: **Claude Code reads `CLAUDE.md`, not `AGENTS.md`** (documented
  explicitly); **Gemini reads `GEMINI.md`** unless `context.fileName` is
  reconfigured; **Aider reads neither**. Cursor, Droid, Amp, opencode and Crush
  read both.
- **MCP resources and prompts are not commodity.** Every vendor documents MCP
  _tools_; only Qwen (tools+resources+prompts), Claude Code (resources via
  dedicated tools) and Crush (`list_mcp_resources`/`read_mcp_resource`) document
  more. Assume tools-only.

### C. Runtime vs static — and the drift problem

This is the part that matters most, because **none of these binaries are ours
and all of them ship on their own schedule.** Two doc domains moved mid-research
(`docs.claude.com` → `code.claude.com`, `developers.openai.com/codex` →
`learn.chatgpt.com`), Codex deprecated `--full-auto` and removed
`codex mcp-server`, Codex deprecated `/prompts:` in favour of skills, Qwen's
free tier was discontinued, and the Kimi docs are mid-rebrand. Any table baked
into a release is wrong before the release ships.

**Must be discovered at runtime, per host, per version:**

- Which kinds exist and which are installed — already handled:
  `GET /api/agents/catalog` probes `PATH` (§1.2), and the app's own rule is
  "the agent is the gateway's word, not ours … it never invents a kind"
  (muqun-app `src/lib/agent-spawn.ts:20-27`).
- Which tools and models an agent actually has. Only three agents answer this
  cheaply and machine-readably: `droid exec --list-tools`, `amp tools list`, and
  opencode's `GET /experimental/tool/ids`. Claude Code answers it inside the
  `system/init` event of a `stream-json` run (`tools`, `mcp_servers`, `plugins`,
  `capabilities[]`); Codex via `codex debug models --json` and
  `codex mcp list --json`. **Copilot CLI and Aider emit no machine-readable
  introspection at all.**
- Whether the installed binary still matches the gateway's captured tables. The
  composer tables are pinned to `claude 2.1.220`, `codex-cli 0.145.0`,
  `opencode 1.18.0`, `qodercli 1.1.5` (§1.4) and were read out of those binaries
  because `claude --help` does not list slash commands. There is no automatic
  invalidation — a version bump silently offers commands the pane may reject.
  `COMPOSER_VERSION`/`KEYMAP_VERSION` invalidate _client caches_, not the tables
  themselves.
- Whether optional features are present at all: opencode's `websearch` needs a
  specific provider or `OPENCODE_ENABLE_EXA`; the gateway's own opencode adapter
  needs `HERDR_GATEWAY_OPENCODE_URL` to be set by hand (§1.4).

**Safe to assume statically:**

- The gateway's own contract: the closed part set, the `allow|allow_always|deny|
other` approval vocabulary, the `Starting|Working|Idle|Blocked|Completed|
Unknown` status enum, `esc` as the interrupt for every profiled agent, and
  `image_input: "file-path"` (which is hardcoded and therefore true by fiat, not
  by observation).
- That an unknown agent degrades rather than fails: `parts: "text"`, shell key
  row, no composer. Every table in the gateway is written to degrade.
- That `approvals.rs` will keep working on agents nobody has profiled, because it
  matches menu _shape_ rather than wording. **Its limit is worth naming: Aider's
  inline y/n prompt is not a numbered list of ≥2 options, so it would not be
  detected — and Amp never prompts at all, so an Amp pane can never be
  `Blocked`.**

### D. Where the gateway's design already absorbs the drift, and where it does not

- **Absorbs it.** `agents.json` adds a whole agent profile with no rebuild and
  no client release (§1.8). `agent_commands` remaps a kind to a renamed binary.
  Capability strings, not version numbers, gate features
  (`release-notes/v0.10.0.md:39-55`). `fallback_text` on every part means a stale
  dictionary costs structure, never content.
- **Does not absorb it.** The four composer tables are compiled in and pinned to
  four specific binary versions. The tmux `AGENTS` detection list is a compiled-in
  8-name array, so 13 of the 21 `AGENT_KINDS` are invisible to tmux-backend
  detection. `image_input: "file-path"` is hardcoded although Claude Code,
  Copilot, Droid, Amp, Aider and Kimi all support clipboard paste and Codex takes
  `--image`. The native adapter list has one entry, and the Codex app-server the
  module doc names is unimplemented.

### E. What this means for a router, stated as constraints rather than proposals

- A router can only pass `agent`, `prompt`, `agent_args`, `cwd`/`repo_path` and
  `branch_name`. Everything in Part 2 that needs a flag must arrive through
  `agent_args` — which `POST /tasks` accepts (≤32 × ≤512 chars) and
  **`POST /spawn` does not**.
- Prompt delivery is a TTY paste with a heuristic Enter, not an API call, so
  delivery is best-effort and confirmed only by a 207 step log. The app already
  encodes this: a timeout "does not prove the process failed, nor that a prompt
  was delivered" (muqun-app `src/lib/agent-collaboration.ts:11-22`),
  and assignments start only at an idle prompt because "Herdr cannot correlate
  its completion with a specific turn"
  (muqun-app `src/lib/agent-collaboration.ts:217-221`).
- Routing must bind to `instance_id`, not pane id — already the stated rule
  (`release-notes/v0.10.0.md:15-18`), and already enforced app-side before every
  send (muqun-app `src/lib/agent-command-delivery.ts:19-29`).
- Agent status is not proof of completion. `Idle` means "drawing a prompt", and
  for any agent without a dictionary it can only ever be `Unknown`.
