# Agent collaboration lives in the composer

## What shipped

There is no collaboration screen any more. Assigning a task is:

1. **The strip.** A toggle in the key row (`assignment-toggle`, beside the
   keyboard toggle) opens `AgentAssignmentBar` above the field: a horizontal row
   of the other assistants in this session, with their status, followed by one
   "start a new …" chip per kind the gateway's catalog offers. Nothing is chosen
   by default; an open strip with nothing chosen is an ordinary composer.
2. **The composer.** Once an assistant is chosen the paperclip's seat becomes a
   chip that names the destination -- a different glyph _and_ colour for "a new
   assistant" versus "one already running", because those are different acts --
   and the placeholder and Send label say the same thing in words. Attachments
   go through the shared queue, with its previews and per-item retry.
3. **Send.** `useComposerAssignment.assign` builds the task with
   `attachmentCommandText` (proven byte-identical to the old form's builder),
   then either spawns (`spawnBoundAgent`) or re-reads agents, verifies the
   chosen `instance_id` is still in that pane, and writes to the _fresh_ opaque
   target. Nothing retries. History is recorded in `stores/agent-collaboration`.
4. **Reading** stays where it was: `CollaborationNotice` in the terminal shows
   the current assignment, its output, and the two history operations (mark
   reviewed, remove), both offline and neither stopping an agent.

Shortcuts with `delivery: 'collaboration'` -- theme authoring among them -- no
longer open a page. They write a `ComposerAssignmentRequest`
(`stores/composer-assignment`), close, and the workspace opens the strip with
the reader's text in the field and the bundled instructions carried separately:
named in the strip's header, appended at send, never shown in the field.

## Why existing-agent delivery is on

`supportsExistingAgentDelivery` returned `false` for a long time, on the strength
of a race between a lookup and a write. That made the feature a dead end: every
attempt failed with "Update Muqun Gateway", at a point where the Gateway had
already been checked and found capable. What is done about the race now is the
same thing the composer has always done for the agent in front of the reader,
plus one more check: verify the instance immediately before the write, use the
target from that read, never retry. The function's doc comment is the full
argument.

## What still needs the rig

Every change to task delivery needs the paired App → Gateway → agent check
AGENTS.md requires: an isolated Herdr session, a dedicated device, and someone
present to answer trust prompts. The offline e2e flow (`agent-collaboration.ad`)
proves the interaction and the demo gateway's spawn path; it cannot prove that a
real assistant received the task.

---

## Why the shared queue carries a destination

This is the part that looks like duplication and is not.

Both stacks upload through the same function — `uploadAttachment(record, uri,
name, mime, isCurrent)` in `gateway-client`. Both bind an upload to the
destination it was staged for. They differ in **how finely**:

|                          | Binds to                                                       | Enforced at                                                                                                         |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `use-attachment-uploads` | the gateway record                                             | `use-attachment-uploads.ts:171` captures the record per attachment; `:211` clears the queue when the record changes |
| the old task screen      | server + session + **source pane** + **connection generation** | `agent-command-references.ts`, `sameScope`, which throws `Reference destination changed`                            |

The collaboration scope is the stricter of the two, and deliberately so: a task
is addressed to one agent in one pane, while a composer message goes to whatever
terminal is in front of the reader. Commit `bd8288e` ("bind uploads and composed
input to their original destination") is the bug that binding prevents.

So the merge direction was fixed: **the shared stack gained the finer binding**
(`useAttachmentUploads` now records an `AttachmentDestination` per entry, and
`attachmentCommandText` asserts it before a task is assembled). Migrating the
other way would have dropped the pane and the connection generation from the
check and reintroduced that bug.

What collaboration gained in return is real: per-item retry, preview, and the
staged-tile state machine, none of which the old screen's image strip had.

## The payload is a pure function, so the merge is provable

`agentReferenceContext` (`agent-command-references.ts:180`) reduces each image to
exactly four fields — `path`, `name`, `caption`, `use` — and the shared queue
already carries all four (`caption` and `use` were added to `PendingAttachment`
for this, with `annotateEntry` to set them).

That is what made the migration checkable without a paired gateway at the
payload level: `attachment-reference-context.test.ts` builds both from matching
inputs and asserts the bytes are identical, for the reference block and for the
whole assembled task text.
