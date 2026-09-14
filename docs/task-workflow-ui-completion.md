# Managed task UI completion proposal

Status: implementation in progress. The Gateway summary projection and adapter have passed host gates. App presentation memory, responsive layout, composer docking, and summary rendering are being integrated. Native layout, accessibility, and complete managed-AI delivery validation remain outstanding. The findings below describe the pre-integration baseline; they are not claims about the final source.

## Findings from the current implementation

- `src/components/work-task-workspace.tsx` uses one full-screen `SettingsSheet`, which owns one vertical `ScrollScreen` capped at 640 points. List, detail, and creation are mutually exclusive render branches. There is no task-specific tablet split layout or viewport restoration.
- `src/components/work-task-list.tsx` renders the title, project, selection, and delegation-paused flag from `WorkTask`. It cannot truthfully distinguish an unreviewed result, unresolved delivery, or last durable activity. Fetching each detail to invent these labels would introduce N+1 requests and would still be wrong when detail collections are paginated.
- `WorkController.showList()` currently discards detail and selected attempt/result/recipient IDs, preserving only the draft by task ID. Returning to a task loads a fresh detail. This breaks persistent historical selection across back navigation and would make responsive remounting unsafe.
- `use-work-output.ts` owns pinned output snapshots inside the mounted hook. A responsive layout must keep that hook mounted once. Re-entry persistence needs a deliberate bounded cache of its existing snapshot type, rather than another output observer or polling loop.
- `SettingsSheet.fullScreen` deliberately places a fixed safe-area viewport outside its scroll content. Real Android evidence previously showed that moving safe-area padding lets accessibility see untappable rows behind the status bar. Preserve that correction. Default native form sheets must keep the existing direct scroll-root contract.
- `TerminalComposer` already owns the shared input/send UI. The terminal workspace uses one `useReanimatedKeyboardAnimation()` source for its dock and viewport because an independent `KeyboardStickyView` previously became displaced. The task layout should reuse this principle and the existing composer, not layer two keyboard avoidance mechanisms.
- Gateway `work_http.rs::TaskPage` returns `{tasks,next_after_id}`; `store.rs::list_tasks` only reads task records in ID order. The records and changes tables already contain the facts needed for a read projection. The newer delegation/dependency models must remain the authority for dependency decisions.

## UI behavior and component boundaries

Introduce a task-specific `WorkTaskLayout`, using the existing sheet ground, chrome, theme tokens, and safe-area primitives. Do not widen or restructure all `SettingsSheet` consumers. The tasks route remains a full-screen route on both platforms.

Use the actual safe content width, not device type or orientation. Start with a 320-point list pane, 24-point divider/gutter, and at least 480 points for detail. Enter two panes only when these minimums fit; at enlarged text sizes, increase the required pane widths or fall back to the single-pane layout. Final breakpoint is a measured layout constant covered by tests, not a claim that all tablets must split.

Keep one controller, one output observer, one artifact-preview owner, and one set of attachment hooks above responsive layout branches. Width changes only affect placement. They must never invoke selectTask, showList, refresh, addressAttempt, or a mutation. Prefer a stable component tree with flex direction/display changes over remounting detail and composer at a breakpoint.

In two panes, the task list remains visible and independently scrollable. Selecting a row opens detail on the right without moving the list. Loading a different detail retains the current detail with a visible loading indicator until the new request succeeds; failure keeps the previous reading snapshot and draft. The selected row reflects the successfully displayed task. New task opens the existing creation form in the detail region, without silently discarding another task's draft. In one pane, Back returns to the list; returning to the previous task restores its selected historical attempt/result and pinned snapshot. Hardware Back first dismisses the keyboard, then returns from attachment detail/creation/task detail, then closes the route using normal navigation.

Separate detail's scrollable reading area from a bottom composer dock. The dock contains the explicit recipient identity, attachment strip, text field, and send control. It must remain inside the task safe viewport and rise from one keyboard animation source. Measure dock height and reserve matching bottom clearance for the reading viewport. Do not combine translated dock, KeyboardAvoidingView, and a second sticky keyboard controller. Collapsible long attachment details and review editing remain in the reading area. Limit composer height by available viewport, permitting internal input scrolling so 200% text plus a keyboard still leaves the recipient and send control reachable. Large hardware-keyboard windows use the same dock without an artificial keyboard gap.

Output remains refresh-pinned: SSE and polling update a notice only. Showing the dock, rotating, resizing, changing focus, or receiving a result must not replace output, change the selected result, or scroll to the end. Explicit output refresh replaces that snapshot and restores the nearest surviving anchor; it does not implicitly choose the newest result. A separate explicit Latest result action may be added later with its own acceptance tests.

## View memory and ownership

Add a bounded presentation-memory helper scoped by the existing complete pairing fingerprint and session. Store no new authorization or mutation state. It records list position, task detail positions, selected attempt/result/recipient IDs, and references to the already parsed reading snapshots. Journal hydration and pending-operation locks remain solely in the current controller/journal.

Represent viewport positions as a stable item/section ID plus relative offset, with a clamped raw offset fallback. List anchors use task IDs. Detail anchors use section plus immutable result/review/operation/attempt ID. Output anchors additionally include the existing pinned snapshot identity. Restore after layout/content measurement; cancel restoration if the user has started dragging. Do not continuously issue scroll commands from state updates. On large-text or width changes, remeasure the anchor rather than replaying an absolute pixel position.

Change navigation state explicitly: `view: list | detail | create` is presentation state and must not clear the active cached detail. Add a same-task return path that does not fetch or reset selection automatically; explicit Refresh remains the authority to replace records. Bound in-memory history by both task count and bytes (proposed 20 task snapshots / 16 MiB). Never evict the active or unresolved task; reject caching additional snapshots if necessary. Eviction may lose old viewing position but must never remove pending journals, draft ownership, or receipt identities. Process restart can restore lightweight view IDs/offsets if a separate validated local view preference is added; do not persist terminal output or result content incidentally. A fresh process loads records explicitly and keeps mutation recovery read-only. Pairing replacement/unpair clears its presentation cache; a safe label rename retains it.

## Gateway summary request

Add an optional `work_task_summaries_v1` capability and a compact endpoint:

`GET /api/sessions/{session_id}/work/task-summaries?limit=20&after_id=<uuid>&snapshot_cursor=<cursor>`

First page omits after_id and snapshot_cursor. Response:

```json
{
  "items": [
    {
      "task_id": "uuid",
      "session_id": "session",
      "task_revision": 12,
      "title": "Update homepage",
      "repo_path": "/project",
      "paused": false,
      "last_activity": { "cursor": 91, "kind": "result_submitted", "entity_id": "uuid" },
      "reserved_attempts": 1,
      "unresolved_native_operations": 0,
      "unreviewed_results": 1,
      "latest_result": { "submission_id": "uuid", "review": null }
    }
  ],
  "snapshot_cursor": 91,
  "next_after_id": null
}
```

Make absent activity/latest result explicit null. A review in latest_result is `{review_id,decision}` and applies only to that submission. Include no brief, result summary text, artifact arrays, prompts, credentials, native output, or full record bodies. Counts are bounded safe integers. Unknown event kinds render a neutral Activity recorded label. Prefer no event time in v1: the existing changes table has no timestamp; task updated_at can be presented as task-record updated time but must not be mislabeled as precise event time.

Initially expose factual labels rather than a mutually exclusive task status: Operation needs checking, Result awaiting review, Latest result accepted, Changes requested for latest result, and New delegation paused. Accepted means a human reviewed that exact submission; it never means the entire task or agent has completed. Reserved attempts means capacity is retained, not that native processes are currently running. Refused historical operations should not permanently mark a task failed. Derive unresolved native operations using the existing lifecycle-aware start/delivery blocker semantics; exclude uncertain read-only reconciliations and released generations exactly as the current service does.

Do not add dependency status by reimplementing scheduler rules. Gateway owner confirmed `WorkStore::dependency_readiness(session,task)` already returns `Ready | WaitingForResult | WaitingForAcceptance` using exact `Task.dependencies` and parent delegation policy; latest review uses insertion order. Its current public method is a single-task connection read, so extract/reuse its transaction-scoped evaluator with batched prerequisite loads before exposing summary readiness. Prefer an optional `dependency_readiness` enum matching those existing facts over a newly invented blocked count. Omit it until that evaluator can provide a bounded projection in the same snapshot. App must not treat a missing field as Ready. Avoid an invented completed/working/idle state machine or percentage.

Implement a rebuildable read projection under the existing SQLite transaction authority. Maintain projection rows and any supporting per-result review aggregates from the same committed mutations that update records/changes. The projection is never accepted as mutation authority. Do not compute it by deserializing every task's complete history per list request, and do not issue one detail query per row. Page query uses an indexed `(session,task_id)` projection scan, capped at 20 rows and 128 KiB encoded. Supporting indexes must make latest-event and exact-submission review lookups bounded. Define review recency by committed event cursor, not UUID ordering or client clock.

For existing databases, rebuild in bounded batches while capability remains absent; verify the rebuilt cursor against the authoritative changes watermark before enabling. Rebuild errors keep the old task-list endpoint usable. An additive materialized projection is acceptable maintenance cost only with a full recompute equivalence test and transaction rollback tests. If an existing projection facility is present by implementation time, extend it rather than creating a parallel table.

Pagination is explicitly snapshot-pinned. Subsequent pages require the first page's session watermark. If relevant session state changed, return revision_conflict; App retains the loaded rows and offers Refresh, never mixes pages. Avoid unrelated sessions invalidating each other's pagination by using a session change watermark. Existing task-list endpoint remains unchanged for compatibility; old Gateways keep neutral title/project rows. Existing changes SSE only raises the updates notice; list refresh uses the summary endpoint. No row-level background GETs and no native polling from the list.

## Accessibility and motion requirements

- Both panes have useful accessibility headings. Rows announce title, project, selected state, and factual attention text in that order. Do not rely on color, checkmarks, or animation. Icons retain explicit labels and controls at least the repository's normal 44/48-point targets.
- Reading order is list then detail on wide layouts; compact inactive panes are inaccessible and unfocusable. Focus moves to the detail heading after an explicit task selection, returns to the original row on Back, and stays stable on new output. Failed network reads announce a concise error without stealing focus from a draft.
- Result acceptance and requested changes controls announce the selected result identity/version context. Recipient controls announce the actual selected attempt. No action label implies a send acknowledgement proves completion.
- Test 200% font scaling and long localized text without fixed-height rows, clipped buttons, or hidden notes. Project paths can visually truncate only when their complete value remains available to assistive technology or explicit detail.
- Reuse `src/lib/motion.ts` system reduced-motion helpers; responsive pane changes and anchor restoration are instantaneous under reduced motion. Avoid pulsing attention indicators and autoanimated reordering. List order remains pinned until explicit refresh.
- Verify TalkBack and hardware keyboard traversal on Android. VoiceOver, iPad multitasking, floating keyboard, and iOS safe-area behavior remain explicitly unverified until the user's iOS testing environment is available.

## Executable ownership and validation sequence

1. Gateway projection owner: new `src/work/store/summaries.rs`, model/HTTP/schema and capability wiring, SQLite migration/indexes, isolated store/service tests. Coordinate shared `work_schema.rs` and capability files before editing. Tests: exact latest submission review, accepted older submission with newer unreviewed result, released ambiguous generation, uncertain reconciliation excluded, foreign session/auth, rollback, rebuild equivalence, bounded row/byte query, pagination conflict, no per-row native/detail calls.
2. App presentation-state owner: new `src/lib/work-view-memory.ts` and focused tests; narrow controller navigation/cache changes; one existing output snapshot owner reused. Test Back/return, rapid task selection, resize without requests or POSTs, stale response rejection, historical selection, pairing rename/re-pair, bounded eviction, pending journal unaffected, and newer draft preservation.
3. App layout owner: new `src/components/work-task-layout.tsx`, narrowly refactor workspace into controlled list/detail/creation regions, add measured dock using existing keyboard animation primitive. Do not alter generic SettingsSheet or terminal delivery behavior. Test width/font breakpoint logic and anchor restore cancellation in pure helpers; native evidence is required for clipping and keyboard geometry.
4. App summary owner: decoder/client list method, compact row view, controller summary snapshot mapping and demo protocol fixture. Preserve fallback endpoint. Tests reject foreign IDs, invalid counts, mismatched revisions/cursors and review references; one list request per page, no N+1 calls; SSE never mutates displayed row order or detail/result/output snapshot.
5. Native QA owner (parent only while device access is serialized): add full-tag task-layout `.ad` flow and extend manifest. Cover phone Back return at historical result, keyboard show/hide and send accessibility, long text, safe-area hit targets, wide layout selection and resize while output arrives, and queued/unconfirmed mutation guards. Reuse the dedicated QA AVD; do not create another device. Restore font/motion/window settings after every flow, including failure. Platform-specific claims require actual platform runs.
6. Localization owner: extract after source labels settle, translate new messages, compile, and run full tsc/lint/format/unit gates. Parent runs the entire Android suite and real paired delivery regression where delivery/layout integration changes warrant it. No readiness claim from targeted/demo tests alone; iOS remains a documented test gate.

Start with presentation-state preservation before moving layout nodes, then dock/split layout, then summary projection. These are independent of enabling native execution or task inputs and must not relax their capability or receipt gates.
