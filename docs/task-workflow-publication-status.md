# Draft implementation snapshot

Published at the owner's request before final acceptance. Keep this PR in draft;
do not merge or release this snapshot.

## Included

Managed task records and delivery, scoped inputs, immutable result review,
lead delegation and dependencies, lifecycle recovery and interruption, protected
pending-operation journals, factual task summaries, responsive task layout,
pinned output and reading-state preservation, and Android mutation transport fixes.
The independent soft keyboard implementation is in App PR #82.

## Validation completed

- TypeScript, lint and formatting passed.
- App unit suite: 3,938 passed, two skipped.
- Native runner syntax/manifest check: 27 flows valid.
- Dedicated paired Android testing verified real Codex startup, initial echo,
  follow-up echo, two scoped result submissions, exact-result review, unsent
  requested-change draft preparation, and one-byte interruption acknowledgement.
- Output snapshots changed only after explicit refresh. The Android task-create
  lost-acknowledgement/restart test previously verified one POST and GET-only recovery.

## Still required

- Real model-driven validation of the new automatic scoped MCP reporting path.
- App managed-agent eligibility filtering against native `bound_agent_kinds`.
  The draft for that change is not included in this snapshot.
- Final Android full-suite run after integration, wide/large-text layout and
  accessibility checks, and remaining attachment/recovery acceptance cases.
- iOS runtime testing, deferred to the owner's environment.

The earlier full Android run passed 17 of 18 flows. Its outstanding assertion was
corrected, but it is not a passing final run for this expanded snapshot. Capability
and host tests do not substitute for missing device or real-agent evidence.

Companion implementation: Gateway PR #27. It also carries the required Herdr
integration patch with its exact upstream base and application instructions.
