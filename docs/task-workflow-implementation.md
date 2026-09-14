# Task workflow implementation record

## Authorized scope and reuse decisions

Implementation follows the task workflow design and interactions. The user has
authorized development, parallel implementation agents and local Android tests
using the existing Omarchy emulator. iOS testing is explicitly deferred to the
user; do not claim iOS runtime validation. Pairing and existing workspace data
must be inspected before running destructive or offline-demo test flows.

The existing collaboration and task flows are one feature family:

| Existing surface                                | Implementation decision                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `useComposerAssignment`, assignment strip       | Repair scope/eligibility and reuse for manual assignment; no competing dispatcher                                         |
| `CollaborationNotice`, output hook, local store | Repair current selection/history and pinned snapshots; retain legacy history independently of live agents                 |
| `new-task` route and `NewTaskSheet`             | Evolve the existing entry when durable task capability is present; preserve legacy assistant launch fallback              |
| Shared composer and attachment queue            | Reuse editor/upload/destination behavior in managed task entry and follow-ups                                             |
| Gateway `/tasks` and `/spawn`                   | Extract and reuse native preparation/start/prompt operations; durable records wrap these operations rather than copy them |
| `TerminalBackend`                               | Sole terminal adapter boundary; new service does not branch on native backend type                                        |
| Artifacts and approval UI                       | Reuse viewers and providers, extend explicit identity/version contracts rather than infer workflow state from prose       |

New code is limited to missing responsibility: durable task/attempt/operation
records, explicit parent relationships, result submission/review and their
query/UI coordination. Existing terminal and manual assignment semantics remain.

## Contract ownership

Gateway owns serialized work API schemas and persistence, documented in its
`docs/task-workflow-implementation.md`. App validates unknown payloads against
that contract; generated legacy API files remain untouched. Managed task routes
are additive under `/api/sessions/{session_id}/work/`, leaving old `/tasks`
responses compatible. New task entry resolves a visible lead before submission;
no inference of task completion from terminal status.

## Execution order and ownership

1. APP-C1/C3: scoped assignment and truthful outcomes.
2. APP-C2: offline history/current selection and stable snapshots.
3. GW-T1: domain/store and durable operation/revision contracts.
4. Shared Gateway execution integration; App task clients and single-assistant UI.
5. Version-bound results, strict approvals, scoped lead/worker operations and
   dependency display; managed tmux native feasibility/implementation follows
   the same contract with no fabricated capability parity.
6. Full local checks, isolated Android device and paired delivery verification,
   then update existing PRs with implementation and actual evidence.

Agents have disjoint file ownership; the primary agent performs integration,
full checks and PR updates. Missing test prerequisites do not justify replacing
the requested feature with an easier subset. Remaining packages stay explicit.
