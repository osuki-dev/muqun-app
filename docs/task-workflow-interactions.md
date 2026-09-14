# Task workflow interaction specification

Status: proposed, not implemented or usability-tested. Read the
[architecture and implementation handoff](./task-workflow-design.md) first.
This specification defines the App interaction contract; the Gateway companion
`docs/task-workflow-interaction-contract.md` owns server enforcement.

The design goal is to make three questions easy to answer at every step: **What work am I looking at? Who receives my next action? What will that action change?** The usability rationale below is an architectural hypothesis to validate through representative tasks, not evidence from user research already performed.

## UI-01 — Navigation and information architecture

On a phone, add a Tasks entry within the existing project/server experience. Do not replace the terminal or require a new global navigation system in the first increment.

```text
Project / machine
  ├─ Tasks → Task detail → Worker detail → Terminal
  │                    ├─ Decision detail
  │                    └─ Result detail
  └─ Existing terminal workspace
```

The task list has a compact “Needs your attention” section and a stable recent-task list. Each row shows title, project/machine, last meaningful recorded event and a textual state. Tapping a row opens that task; it never answers a prompt. A visible “New task” action opens composition. If there are no tasks, show that action and one short example, not an agent-management tutorial.

Do not reorder rows underneath an active touch, keyboard focus or screen-reader focus. While reading, accumulate “Updates available” rather than moving the selected item. Do not use an agent's `done` flag to label a task complete. “Result submitted” requires an actual submission; “Accepted” requires a recorded user review.

On a tablet, use a task list plus detail pane with the same selection and back-navigation semantics. Preserve the chosen task and its scroll position across layout changes. Resizing must not initiate a task or change the active terminal.

**Why:** tasks preserve the user's intention across agent restarts and multiple workers. A terminal remains valuable for inspecting raw behavior, but making it the primary task container forces the user to remember which pane contains which responsibility.

## UI-02 — Create a task with one clear commit point

```text
New task                                         Close

Project: website · Development Mac                 Change
Assistant: Automatic                              Change
Delegation: Within this project                   Settings

What would you like done?
[Goal editor                                      ]
[                                                 ]

[Attach]   reference.png · Ready

                                      [Start task]
```

- Opening New task does not start an agent. The project may be prefilled from the explicit current project; the machine remains visible. With no project context, require selection rather than silently choosing a machine.
- Reuse the existing editor, attachment queue and validation. Keyboard Enter inserts a newline; the labeled Start task action is the commit point. Keyboard shortcuts must have the same preconditions as the button.
- Automatic means one lead assistant selected from available, allowed profiles. Show its resolved identity before committing the launch. It does not mean “enable unattended approvals” or “always start multiple agents.”
- Delegation settings expose an allowed agent set, maximum concurrent workers and project scope. Show the effective execution/approval profile. Existing project preferences can be reused; expanding them requires an explicit change, not a hidden flag in an agent command line. Unsupported enforcement must not be presented as a guarantee.
- Changing the machine/project preserves the written goal as a draft, invalidates the resolved assistant and attachment destination, and requires re-selection/re-upload as appropriate. Do not silently forward files staged for one machine to another.
- Upload progress is real byte progress and may show a percentage; task progress must not. Failed attachments have inline Retry/Remove controls. While Start task is waiting for uploads, label it “Uploading attachments…” and prevent a second submission.
- After durable task creation, show the task even while launch or delivery is pending. Display “Starting assistant,” “Instruction sent,” “Start not confirmed,” or “Delivery not confirmed” from the actual operation record. A lost response must not return the user to an empty form that invites a duplicate launch.
- Close/back preserves the draft under its destination without sending it. If a draft is persisted across app restarts, use protected storage; do not put goal text into route parameters, logs or notifications. Attachment handles can expire and must be revalidated when reopening.

The terminal composer keeps its current default meaning: opening an assignment picker without choosing a target does not reroute ordinary terminal input. The task composer is a separate, explicitly entered context. Reusing an editor component must not merge those two destination rules.

**Why:** the user supplies the goal instead of first designing an agent team. A visible destination and a single Start task button make the action predictable without an additional “Are you sure?” dialog for every normal request.

## UI-03 — Task detail: stable content, explicit sources, one primary action

```text
‹ Tasks        Homepage visual update                More
website · Development Mac

Lead: Claude · Working
Last update 14:32

Needs your attention                                  1
Image service authorization                     [Review]

Plan from lead                                      View
Create artwork, adapt styling, then verify the page.

Work
Artwork             Codex       Working                  ›
Styling             Claude      Waiting for artwork       ›

Results                                                  ›
No result submitted yet

To: Lead · Claude                                  Change
[Add instructions…                              ] [Send]
```

- Section order is context → decisions → lead summary/plan → work → results. The composer is anchored above the keyboard/safe area. A transient toast may acknowledge a tap, but the durable operation status belongs in the task.
- A lead summary is labeled as agent-reported. Process observations carry observation time; stale status reads “Last seen working at 14:32” or “Status unavailable.” Do not change unknown into idle for visual neatness.
- With one assistant, show a compact assistant row and omit empty grouping chrome. With several workers, use vertically readable rows with title, agent, state and attention indicator. Avoid making a horizontal chip strip the only route to workers off screen.
- Tapping a worker opens a stable detail view; it does not select that worker as the recipient of the task's composer. Viewing and addressing are different actions.
- New output adds “New output available.” It must not move the reading position or replace the captured output. Refresh is explicit and applies to the selected view only. Returning from background/reconnecting preserves the pinned snapshot.
- A new decision increases the attention count and can announce one accessible notice. It must not steal focus, open a modal or switch terminals.
- Back returns to the previous list/selection/scroll state. Leaving the task does not stop work. The UI must not imply that keeping the phone awake is necessary for execution.

**Why:** the user can inspect one result or worker without losing the overall task. Attention is reserved for actual decisions, while unchanged content remains spatially stable.

## UI-04 — Follow-ups and recipient changes

The default composer recipient is the current lead attempt, shown as “To: Lead · [name].” In worker detail, show “Message this worker” as an explicit action that opens a composer naming that worker. Returning to task detail restores the task's lead recipient.

Selecting a new recipient changes the destination chip and Send label before any request. Preserve text but revalidate attachments and scope. A disappeared/replaced assistant invalidates the selection; show “This assistant is no longer available. Choose a recipient.” Never substitute the replacement process or send to the ordinary terminal as a fallback.

If the lead is busy and the backend cannot accept a correlated follow-up, keep the message as a draft and show “Assistant is busy. Your draft has not been sent.” Do not pretend the message has entered a queue. A future inbox must be a separately implemented contract, with visible queued/canceled states.

During submission, freeze the addressed attempt for that operation and prevent double taps. A later UI selection cannot retarget an in-flight request. On success, clear only the submitted draft version; a newer draft typed during processing must survive. “Instruction sent” acknowledges delivery, not compliance with the instruction.

**Why:** looking at a worker should not accidentally redirect the next global instruction. Predictable addressing reduces memory burden and protects against the retained-selection defect found in App #77.

## UI-05 — Decisions and approvals

Tapping Review opens a dedicated detail screen, with enough room to inspect the request:

```text
Decision required                                  Close
Task: Homepage visual update
Assistant: Codex · Artwork
Project: website · Development Mac

Requested action
[Actual operation/tool, affected paths or endpoint,
 and the original request/options as available]

Source: Native approval request / Terminal detection
Observed 14:34

[Deny]                         [Allow once]
Other available options                                  ›
```

The button labels above are illustrative: render only decisions the underlying request actually offers, preserving their real meaning. Do not invent “Allow once” when the provider only offers a broader grant. Keep original command/path/endpoint text inspectable and selectable; display it as untrusted content, not trusted App instructions. An AI summary is supplementary and never replaces the original request.

Rules:

- No option is selected or submitted by default. Reading, opening, scrolling or dismissing a request has no approval effect. No batch “Approve all.”
- On an explicit one-time decision, submit once against the displayed request identity and assistant instance. No generic confirmation dialog is needed after the user has already inspected and tapped the specific decision.
- A persistent grant such as “Always allow” opens an additional scope summary naming what permission persists and the actual revoke path when known. Confirm with a scope-specific label. If the scope/revocation behavior is unknown, say so; never imply that closing Muqun revokes it.
- Disable buttons during submission. If the request/instance changes, retain the old view as stale with “This request changed. Review the current request.” Do not silently replace the button meanings under the user's finger.
- If the outcome is uncertain, show “Approval not confirmed” and a Check status action. Do not resend the answer or state that it failed to reach the agent without evidence.
- If structured approval identity or safe answer delivery is unavailable, provide Open terminal to inspect the real prompt. Do not simulate safety by translating a generic Allow button into an unverified Enter key. Raw terminal interaction is an explicit user action, not a structured approval guarantee.
- Credentials and service login stay in the supported authentication flow. Do not ask the user to paste a secret into a task prompt as an approval workaround.

**Why:** meaningful friction belongs where authority changes. Reconfirming every normal send trains dismissal; a focused request review and stronger treatment of lasting grants concentrate attention on the actual consequence.

## UI-06 — Delivery failures, offline use and recovery

| Situation                                        | Visible state                                        | Primary action                       | Required invariant                                |
| ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| Definitive pre-send refusal                      | Instruction not sent + actionable reason             | Fix the reason                       | No claim that a worker started                    |
| Launch created resources but a later step failed | Assistant needs attention + known terminal reference | Inspect assistant                    | Preserve partial resources; do not duplicate them |
| Acknowledgment lost                              | Delivery not confirmed                               | Check status                         | Never auto-resend                                 |
| Offline with unsent text                         | Offline · draft not sent                             | Keep editing                         | Reconnection must not send automatically          |
| Agent replaced/exited                            | Assistant unavailable                                | Inspect history / choose replacement | Old assignment is never rebound                   |
| Lead exits while workers remain                  | Lead unavailable · worker state retained             | Choose a new lead                    | No automatic replay to workers                    |
| Result removed/changed                           | This result version is unavailable/changed           | View submission details              | No silent substitution of newer bytes             |

“Send again” is secondary to Check status for ambiguous operations. It shows the original destination and the concrete warning “The earlier instruction may already have been received.” The explicit retry creates a new operation. Dismissing recovery UI does not resolve the uncertainty.

Local Mark reviewed/Remove from history remain available offline and never control an agent. A shared Accept result action requires server confirmation; while offline, offer local review only. Do not show a local click as shared acceptance.

**Why:** mobile connectivity fails at exactly the point where users are tempted to repeat a tap. The UI should expose uncertainty and preserve work, rather than make a timeout look like a safe retry.

## UI-07 — Results, revision review and previews

A result detail shows the submitting assistant/attempt, submission time, summary, files/preview/diff, and verification evidence. Label evidence as agent-reported or independently observed. “Not tested” is a legitimate value.

Keep the chosen result version fixed. If a newer submission appears, show “A newer result is available” and let the user choose it. Acceptance records exactly the version displayed; it does not accept a result that arrived in the background. If the policy requires the latest version, a conflict asks the user to review it rather than silently redirecting acceptance.

Use “Request changes” to open a composer addressed to the lead, with the reviewed submission reference visibly included. Use “Accept this result” for the shared review action. Offer a local Mark reviewed separately where needed. Neither action merges, publishes, deletes files or terminates workers. Release/merge controls remain a separate explicit workflow.

Render Markdown and images through existing safe viewers. Agent-produced links and HTML are untrusted: no automatic external resource loading from result prose, no credentials in preview URLs, and no authenticated Gateway bridge exposed to generated web content. An external preview shows its host before opening. Never execute a file because an agent called it a preview. Sharing an artifact uses an explicit share action for the selected artifact/version.

**Why:** a readable result is the outcome users came for. Version binding makes approval meaningful and avoids accepting different content from what was inspected.

## UI-08 — Interruption, delegation limits and destructive actions

Use specific actions rather than a single ambiguous Stop button:

- **Interrupt this assistant:** available in its detail, naming the assistant. One explicit action sends one interrupt request, provided identity is current. Show “Interrupt requested” until evidence supports a stronger state. It does not promise rollback or cancellation of all child processes.
- **Pause new delegation:** a task-level control, available only if Gateway enforces it. Explain that existing workers continue. It changes the policy for future managed dispatches, not execution already in progress. The explanation must say that it covers assistants started through Muqun; agents with independent shell/Herdr access may still start work outside that control. Do not present it as an OS-level stop or sandbox.
- **Hide from my history:** local, reversible where supported, no agent control. Offer Undo for local hiding rather than a routine warning dialog.
- **Delete a worktree / close all workers:** not a first-release shortcut. A future implementation needs a concrete resource list and unsaved/unmerged-work handling; it must not be bundled with acceptance or history removal.

Keep destructive or scope-expanding actions out of swipe shortcuts and away from frequent Send/Refresh targets. Every action must also be available through a labeled control, not a gesture alone.

**Why:** users need to know whether they are stopping input, preventing new delegation, or destroying resources. One generic Stop cannot honestly describe all three.

## UI-09 — Privacy, accessibility and interaction quality

- First-release task notifications open the relevant task/decision; they do not approve or retry directly from the lock screen. Default notification text contains no prompt, command, path or result body. Respect existing app-lock/background privacy behavior on deep links and app switching.
- A deep link resolves IDs under the current paired identity, rechecks authorization and refreshes the live request before enabling mutations. A link to another machine must identify that destination; it must not inherit an armed composer action.
- Keep body text and actionable labels compatible with font scaling. Use text/icon distinctions alongside color for working, attention, stale and selected states. Screen readers announce the task, recipient, action and disabled reason; do not announce every terminal update.
- Use at least 44 × 44 pt touch targets on iOS and 48 × 48 dp on Android, accounting for actual hit areas and spacing. These targets follow [Apple's UI guidance](https://developer.apple.com/design/tips/) and [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views). Smaller visual icons can sit within those targets.
- Restore focus to the initiating control after closing a sheet. Do not autofocus an approval choice. Support keyboard dismissal, hardware keyboards and reduced motion. Preserve important context at large text sizes rather than truncating the recipient or approval scope irretrievably.
- Busy states describe actual operations. Avoid indefinite success-colored spinners, decorative task percentages, auto-scrolling and animation that makes rows difficult to tap.

## UI-10 — Implementation mapping and acceptance script

Use the packages in [the implementation handoff](./task-workflow-design.md#implementation-packages). Add small task-list/detail, decision-detail and result-detail components around the shared composer/viewers; keep destination/operation state in testable hooks/reducers. Do not grow `server-terminal-workspace.tsx` into the task engine. Gate the new task surfaces on the new contracts, while preserving current terminal use.

Stable native test IDs should identify intent, for example `task-create`, `task-destination`, `task-start`, `task-recipient`, `task-send`, `task-decision-open`, `task-decision-submit`, `task-operation-check`, `task-result-accept`, and `task-history`. Dynamic rows must use stable task/attempt IDs, never list positions.

| Scenario                                          | Pass condition                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Start a simple task                               | A user can identify destination and chosen lead before one Start action; only one launch occurs |
| Change project with attachments                   | Text is preserved, destination/attachments are revalidated, no stale upload path is sent        |
| Inspect a worker then send from task detail       | Message still addresses the visibly selected lead; viewing did not retarget it                  |
| Double tap / reconnect after send                 | No duplicate mutation; receipt is queried and uncertainty is shown accurately                   |
| Switch Herdr → tmux with selection armed          | No tracked assignment is sent; ordinary terminal use still works                                |
| Approval changes while open                       | Old action is refused with zero input to the new request                                        |
| Two devices answer the same request               | At most one matching native decision is executed; the other sees resolved/conflict              |
| A new result arrives while reviewing              | Displayed content and acceptance target remain the chosen version                               |
| Open app offline after an agent exits             | History remains readable/manageable; no automatic stop or resend                                |
| New output while reading or using a screen reader | Position and focus remain stable; only an update indicator changes                              |
| Interrupt one worker                              | Only that verified worker receives the action; siblings remain unaffected                       |
| Malicious result content / notification link      | No command execution, credential exposure or implicit authorization                             |

Run the native full suite and real paired checks specified by the repositories. Also conduct a small moderated usability pass on a compact phone and a large-text configuration: ask users to create a task, find a decision, identify the next message's recipient, recover from an unconfirmed delivery, and distinguish Accept from Publish. Record observed mistakes and assistance needed. The design rationale should be revised if those tasks expose confusion; this specification does not claim that fewer taps alone proves the workflow is better.
