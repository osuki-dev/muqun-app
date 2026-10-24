# Home data streams

## Transport and ownership

Home aggregation multiplexes independently versioned messages over the existing
authenticated agent WebSocket. It is not a single response containing every Home
field. The selected collector forwards authorized source streams through one App
socket; each source Gateway still owns its data and collects it locally.

Every message is scoped by the paired Gateway's immutable `serverId`. A collector
rewrites the origin from its verified peer link. The App accepts only requested,
paired sources and fences callbacks from retired collector connections. Session
identities include provider and session ID; terminal bindings also carry instance
identity when the source knows it. Display names never identify a computer.

## Request inventory and boundaries

| Existing Home read                                                     | Transport in this change             | Boundary                                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Task list and default working directory                                | `home` messages                      | Event-driven task deltas; independent generation/revision                                                                          |
| `/api/sessions` used to choose a Home workspace                        | `home_overview`                      | Bounded workspace IDs from the source configuration                                                                                |
| `/api/sessions/:id/snapshot`, or `/panes` and `/agents` for Home cards | `home_overview`                      | Display-ready pane and agent metadata, without terminal screen contents                                                            |
| `/api/agent-sessions?roots=true&limit=50&order=desc`                   | `home_overview`                      | Newest 50 root sessions across providers; source sorts and bounds the result                                                       |
| Older remembered sessions outside that page                            | Retained last observation            | Opening a session still loads its authoritative detail; the overview does not claim complete history                               |
| Selected conversation timeline, permissions and live events            | Existing direct session transport    | Detailed content is outside the summary sharing grant                                                                              |
| Stage terminal activity and visible-screen reads                       | Existing selected-computer pane feed | Still separate; needs an explicit activity scope and bounded source-side subtitle projection before forwarding through a collector |
| Metadata/capability negotiation, pairing and peer grants               | HTTP                                 | Bootstrap and authorization precede stream subscription                                                                            |
| Files, images, audio, upload and history paging                        | On-demand existing transport         | Large transfers must not block Home status traffic                                                                                 |
| Prompt delivery, approvals, delete and terminal commands               | Existing direct command paths        | Read-only aggregation grants do not authorize writes or ambiguous retries                                                          |

The three Home layouts consume the same source-scoped stores. Their visible
features can require additional on-demand data; sharing an overview does not mean
every layout needs to subscribe to every conversation or terminal.

## Collection, updates and fallback

`home_overview_v1` is negotiated explicitly. Old Apps request only the original
task stream, and old Gateways continue to use HTTP discovery. Peer grants must
explicitly authorize overview metadata; existing task-only grants are not widened.
One computer can subscribe to its own overview without peer setup or an aggregation
settings entry.

The source shares one bounded, single-flight cache across App and peer consumers.
Overview reconciliation is currently 30 seconds with a four-second collection
deadline, at most 16 workspaces, 100 panes per workspace, 50 resulting sessions and
128 KiB serialized data. This is not yet a fully event-driven discovery stream.
Task processing runs in a separate worker and does not wait for this collection.
Unchanged overviews send freshness metadata without repeating the data payload.

Each topic has its own generation and revision. Overview failure or a revision gap
invalidates overview coverage without invalidating tasks. Coverage expires after
75 seconds or collector/source disconnection. Uncovered computers resume existing
HTTP discovery; late HTTP results cannot overwrite a newer covered overview.
An unavailable peer source schedules a subscription retry after 30 seconds,
backing off to 60 and then 120 seconds while healthy sources continue to work.
Restoring all source snapshots cancels the retry. A newly requested capability is
probed once when a healthy peer link still advertises a pre-upgrade feature list.

The App validates the wire shape and writes only the matching source's Zustand
records. Unchanged data retains references for selectors. Gateway owns collection,
ordering and display metadata; App owns selection and presentation.

## Remaining work and measurement

Stage subtitle aggregation requires authoritative session-to-terminal associations
and a dedicated content scope. Do not infer equivalence from matching names,
working directories or subtitle text. Missing associations remain a source-side
limitation, especially for tmux.

Binary serialization and compression are not prerequisites for multiplexing. First
measure bytes, wakeups, source collection time and reconnect behavior. A WebSocket
alone does not reduce work if it carries unchanged full snapshots or drives busy
polling. Battery claims require comparable Release measurements on a real device;
emulator network and UI checks establish behavior, not battery savings.
