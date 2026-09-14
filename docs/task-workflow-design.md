# Task workflow: architecture and implementation handoff

Status: proposed design for review, not implemented functionality. This document
consolidates the architecture comments on App #63 and the follow-up review of
App #77 and Gateway #26 after those two implementation PRs merged.

The reviewed baselines are App `a178514` and Gateway `f48568c` on 2026-09-14.
Relevant collaboration and delivery files match the earlier reviewed PR heads
(`78abdda` and `b6bca76`). The findings below therefore remain relevant at these
baselines; no device reproduction or release certification is implied.

Read [the interaction specification](./task-workflow-interactions.md) for screen
flows, labels, rationale, failure behavior, accessibility and acceptance scenarios.
The Gateway repository owns the companion `docs/task-workflow-design.md` and
`docs/task-workflow-interaction-contract.md`, including storage, API and native
execution contracts. Keep one owner for each contract rather than copying schemas
into both repositories.

## Product direction

The primary loop is **describe a goal → handle decisions → review a result**.
The user selects a project, enters a goal and attaches references. Automatic is
the default assistant choice, with the resolved lead visible before launch.
One assistant handles simple work; delegation is used when independent work or
another available tool justifies it. Architect is a role, not a required first
choice in the UI.

The App remains useful as an ordinary terminal client. Its existing terminal
composer does not become a task composer merely because a picker is open.
A new task is an explicit context, even when both contexts reuse editor and
attachment components.

Automatic does not mean automatic permission approval. Existing project policy
and effective launch settings remain visible. Expanding authority requires an
explicit decision supported by the backend. A skill describes behavior; it does
not provide a security boundary.

## Ownership

| Owner                    | Responsibilities                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| App                      | Goal entry, destination selection, task and result views, user decisions, pinned snapshots and local reading preferences |
| Lead agent               | Interpret the goal, choose workers, describe dependencies, request dispatch, review submissions and integrate results    |
| Gateway task service     | Durable task/attempt records, validated operations, identity binding, delivery outcomes, result references and recovery  |
| Terminal backend adapter | Native process/terminal operations, topology, input/output and available lifecycle evidence                              |

Gateway executes explicit requests. It does not choose models, split a brief or
automatically schedule all children whose dependencies become satisfied. A phone
connection is not needed to keep the lead running. If the lead exits, recorded
workers and submissions remain visible; replacement is a new explicit attempt.

## Relationship to current agent collaboration

Current `agent_collaboration` provides manual assignment to an existing or new
assistant, local dispatch history and terminal observation. The task workflow is
a layer above that foundation, adding durable tasks, attempts, explicit child
relationships, registered results and human acceptance.

Reuse the composer, attachment pipeline, terminal viewers, backend adapters and
extracted delivery services. Do not build a second prompt transport or rename
local `CollaborationTask` records into server tasks without new contracts.
Legacy history stays local unless explicitly adopted and verified.

The capability fixes in merged App #77 and Gateway #26 are prerequisites, not an
implementation of the entire task workflow. The earlier claim that the helper is
unwired and collaboration is only an unconditional Gateway capability is stale
for these merged baselines.

## Data and identity boundaries

The App consumes Gateway-owned task, attempt, delivery and result IDs:

- A task describes work and optionally names a parent and explicit dependencies.
- An attempt binds that work to one assistant instance and execution placement.
  A replacement creates another attempt; a pane ID is only a locator.
- A delivery describes one instruction or follow-up and its acknowledged,
  refused or unconfirmed outcome. A timeout does not prove non-delivery.
- A result submission binds artifacts and evidence to the originating attempt
  and an immutable content version. User review names that submission.

Relationships are scoped to a Gateway installation and session. Branch names
such as `<brief>/<part>` are presentation labels, not group identity or recovery
state. Observed agents without verified task links stay unattributed.

Keep delivery outcome, observed process state, agent-reported plan state,
submitted results and user acceptance separate. Idle is not task success.
No aggregate completion percentage may be fabricated from terminal state.

Shared state uses task revisions; optimistic conflicts require explicit review.
Per-device read markers, local hiding and legacy history management remain local.
Offline review/removal must not contact or stop an agent. Shared acceptance needs
server acknowledgment and must not be confused with local Mark reviewed.

## Current defects and limits to address

### C1: retained assignment bypasses the capability gate

At the reviewed App baseline, `resetSessionState` in
`src/components/server-terminal-workspace.tsx` clears the draft and attachments
but not `useComposerAssignment` selection or the agent-kind cache. The bar renders
from `assignment.open`; sending branches on `assignment.active` rather than fresh
collaboration eligibility. Quick-action entry can also arm the selection.

Source-level reproduction: choose a new assistant in Herdr, switch to tmux in
the same mounted screen, enter a new draft and send. The retained new-agent
selection reaches the current tmux session, whose ordinary spawn endpoint remains
valid. Hiding the toggle does not invalidate the operation.

Bind selection to its destination, reject stale asynchronous results and enforce
eligibility at dispatch after awaits. Never fall back to ordinary terminal input
when a tracked assignment is refused. This finding is source-traced, not yet a
native device reproduction.

### C2: historical assignments lack a management surface

`src/components/collaboration-notice.tsx` drops the `history` partition and only
renders `current[0]`. Reviewed, superseded and departed-agent assignments remain
stored but lose their controls. A cold offline launch without live agents also
has no current card. The local store operations correctly avoid agent commands;
the missing requirement is an accessible history view independent of live agents.

### C3: outcome copy overstates what happened

The assignment send path uses Assistant started for existing-agent success and
A terminal was created for its unconfirmed delivery. Distinguish existing sends,
confirmed launches and uncertain effects. Preserve known partial resources in
recovery rather than encouraging a duplicate launch.

`use-pane-approval.ts` also reports That answer did not reach the agent for generic
failures. A lost acknowledgment needs unconfirmed wording unless no input is
proven. The future native-aware approval view additionally depends on Gateway's
request-bound decision contract; the current parser requires a fingerprint and
must not manufacture one to disguise a native request ID.

### Delivery and verification limits

Existing-agent delivery checks identity before a separate native target write.
That is useful but not an atomic expected-instance precondition. The Gateway
companion defines the stronger proposed contract and its feasibility boundary.

The original #77/#26 PR descriptions reported missing full device and paired
App-to-Gateway-to-agent checks. Their merge does not establish that those checks
subsequently passed. Obtain current evidence before claiming supported end-to-end
behavior. Unit tests and health probes do not prove delivery.

## Implementation packages

| Package | Dependencies                                      | Changes                                                                                                                 | Completion criteria                                                                                                      |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| APP-C1  | Merged selected-session capability contract       | Scope assignment and shortcut state; invalidate stale catalogue responses; guard dispatch in hook/service and workspace | No tracked mutation after destination/capability loss, including upload races; supported delivery still works            |
| APP-C2  | Independent of task storage                       | Current-assignment selection, dedicated history component, pinned output lifecycle                                      | Multiple assignments navigable; exited/reviewed history manageable offline; reconnect does not replace a pinned snapshot |
| APP-C3  | APP-C1                                            | Operation-specific copy and recovery with known resources                                                               | Existing send, partial launch, refusal and lost response produce accurate wording and no automatic retry                 |
| APP-T1  | Gateway task/store, delivery and result contracts | Task list/detail, shared composer entry, receipts, versioned result review                                              | One assistant: create, actual response, follow-up, reconnect, result, request changes/accept                             |
| APP-T2  | APP-T1 and scoped child-task operations           | Explicit child relationships, dependency display and lead-loss recovery                                                 | Worker inspection does not retarget lead messages; recorded workers survive lead loss                                    |
| APP-S1  | Strict Gateway approval identity contract         | Native/menu identity-aware decision UI and recovery                                                                     | Stale/concurrent decisions refused safely; actual option meaning retained; no replay after uncertainty                   |
| APP-S2  | Relevant task UI packages                         | Privacy, destination labels, protected drafts, accessibility and stable focus                                           | Deep links cannot act; large text and touch targets work; reading state survives updates                                 |

Primary existing seams are `src/hooks/use-composer-assignment.ts`,
`src/lib/agent-collaboration.ts`, `src/components/collaboration-notice.tsx`,
`src/hooks/use-collaboration-output.ts`, `src/stores/agent-collaboration.ts`,
`src/hooks/use-pane-approval.ts` and `src/lib/pane-approval.ts`.

New task list/detail, decision and result components should remain focused.
Do not grow `server-terminal-workspace.tsx` into a task engine. Pure transitions
and destination guards should be testable independently from React Native.

## Maintainability and compatibility

- Keep the Gateway authoritative for shared task facts; SSE is an optimization
  over queryable state. Expired cursors recover from a snapshot.
- Preserve legacy endpoints, ordinary terminal use and capability fallback.
  New contracts have explicit capabilities; session support does not eliminate
  per-attempt readiness and identity checks.
- Keep one registry owner with distinct launch, discovery, integration, detection,
  approval and optional-tool support. An executable on PATH does not prove tool
  entitlement or readiness. Avoid permanent vendor-to-task routing rules.
- Persist references and necessary task facts, not every terminal frame. Bound
  lists, events and artifacts without silently evicting active work.
- Use isolated worktrees for concurrent writers; read-only work may share a
  checkout. Worktrees do not isolate shared services or confer OS sandboxing.
- Keep cleanup, acceptance, interruption and publishing as separate operations.
  No distributed queue, cross-machine delegation or general DAG scheduler is
  required for the first usable single-assistant loop.

## Confirmation and implementation handoff

Recommended decisions to confirm together: task-first Automatic entry; one lead
unless delegation is useful; explicit IDs; Gateway-owned durable state; additive
APIs; distinct delivery/process/result/review states; registered artifact versions;
shared execution services; Herdr first and verified managed tmux support later.

Once confirmed, agents implement the named packages in dependency order. A
material change to identity, delivery guarantees, ownership, persistence or
compatibility returns for architectural review. A handoff includes pinned
base/head, exact contract changes, changed modules, test commands and actual
results, limitations and unresolved decisions. Missing native guarantees cannot
be resolved by wording a capability more confidently.

Every code package runs the five App gates. New native `.ad` flows carry the full
tag. Startup/delivery changes also require real paired tests in an isolated
Herdr session on dedicated QA devices, including existing assignment, startup,
follow-up, returned output and preserved focus. Test each supported platform
before claiming its coverage. No trust decision, release, tag or production
operation is authorized by the existence of this design.

## Source discussion

- [App #63 architecture and handoff](https://github.com/osuki-dev/muqun-app/pull/63#issuecomment-5659075917)
- [App #77 current implementation review](https://github.com/osuki-dev/muqun-app/pull/77#issuecomment-5659062620)
- [Gateway #26 execution design](https://github.com/osuki-dev/muqun-gateway/pull/26#issuecomment-5659070299)
