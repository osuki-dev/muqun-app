# Folding agent collaboration into the composer

Agent collaboration is a 671-line screen (`app/agent-collaboration.tsx`) that
rebuilds things the terminal composer already has. `terminal-composer.tsx` says
what it was designed for:

> Everything else the gateway hangs on it — the paperclip, the slash popup, the
> mention picker — comes in through `leading` and `inputProps`, so the same
> field serves an SSH shell that has none of those.

Collaboration went around that extension point. This note records what a merge
actually costs, because the obvious framing — "two implementations of the same
thing, delete one" — is wrong in one important way.

## What splits, and what does not

Writing a task belongs in the composer. Reading one does not.

| Stays a screen                          | Moves to the composer                                  |
| --------------------------------------- | ------------------------------------------------------ |
| task history, agent status, past output | the prompt text                                        |
|                                         | reference images                                       |
|                                         | the target (existing agent, or a new one of some kind) |
|                                         | "include current terminal output"                      |
|                                         | Send                                                   |

The mapping is direct: the target becomes a chip in `leading`, where the
paperclip already sits; terminal output is an attachment of the current screen
and belongs in the attachment menu; Send is `send`, with its label switching on
the target.

## The attachment stacks are not duplicates

This is the part that looks like duplication and is not.

Both stacks upload through the same function — `uploadAttachment(record, uri,
name, mime, isCurrent)` in `gateway-client`. Both bind an upload to the
destination it was staged for. They differ in **how finely**:

|                          | Binds to                                                       | Enforced at                                                                                                         |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `use-attachment-uploads` | the gateway record                                             | `use-attachment-uploads.ts:171` captures the record per attachment; `:211` clears the queue when the record changes |
| `use-agent-references`   | server + session + **source pane** + **connection generation** | `agent-command-references.ts:184`, `sameScope`, which throws `Reference destination changed`                        |

The collaboration scope is the stricter of the two, and deliberately so: a task
is addressed to one agent in one pane, while a composer message goes to whatever
terminal is in front of the reader. Commit `bd8288e` ("bind uploads and composed
input to their original destination") is the bug that binding prevents.

So the merge direction is fixed: **the shared stack gains the finer binding**.
Migrating collaboration onto the record-level binding as it stands would drop the
pane and the connection generation from the check and reintroduce that bug.

What collaboration gains in return is real: per-item retry, preview, and the
staged-tile state machine, none of which `AgentReferenceEditor` has.

## The payload is a pure function, so the merge is provable

`agentReferenceContext` (`agent-command-references.ts:180`) reduces each image to
exactly four fields — `path`, `name`, `caption`, `use` — and the shared queue
already carries all four (`caption` and `use` were added to `PendingAttachment`
for this, with `annotateEntry` to set them).

That means the migration does not need a paired gateway to be trusted at the
payload level: build the reference block from a `PendingAttachment[]` and assert
byte-identical output against `agentReferenceContext` for equivalent inputs.

What still needs a real App → Gateway → agent check, per AGENTS.md, is delivery
itself — that the task arrives, that a new agent starts, that output comes back.
Offline demo fixtures cannot show that, and the e2e suite runs offline.

## Order of work

1. **Done.** `AttachmentDestination` plus `assertAttachmentDestination` in
   `attachment-queue.ts`, wired into `attachmentReferenceContext`. One drifted
   entry rejects the whole queue, and an unbound entry is refused rather than
   treated as bindable anywhere.
2. **Done.** `attachmentReferenceContext` builds the block from the shared queue,
   and `referenceAttachments` adapts a draft into that queue. Tests assert the
   bytes match `agentReferenceContext` and that both refuse a moved destination
   with the same message.
3. Swap `AgentReferenceEditor` for `AttachmentStrip` plus a caption/use editor.
4. Move the target chip, the output toggle and Send into the composer; leave
   history on the screen.
5. Paired delivery check on an isolated Herdr session and a dedicated device.

**3 and 4 are one step, not two.** `AttachmentStrip` takes an `onPreview`, and
the preview surface it opens lives in the workspace (`previewAttachmentId` in
`server-terminal-workspace.tsx`), not in any shared component. The collaboration
screen has only a 64px thumbnail and nothing to open, so swapping the strip in
while collaboration is still its own screen would put a tile on screen that
looks tappable and does nothing. The strip arrives when the composer does.

Steps 1 and 2 are proven without hardware and are in. Step 3/4 changes what the
reader touches but not what is sent, and the tests from step 2 are what says so.
Step 5 is the one that needs the rig.
