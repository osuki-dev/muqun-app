# Home stream and history audit

## Scope

Review of the Home aggregation changes and adjacent conversation-history consumers: source identity, snapshot/delta ordering, failover, HTTP fallback, authorization and history paging. This is not a complete security review of every Gateway endpoint.

## Findings

| Path                                   | Finding                                                                                                                  | Disposition                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex history ordering                 | Live first/last items could leave no positions for missing historical items.                                             | Fixed with sparse stable positions and atomic insertion validation; regression reproduced the old error.                                                                                              |
| Earlier-history response and workbench | Both consumers treated an empty page as exhaustion, although Gateway filters internal rows after determining exhaustion. | Preserve the explicit `exhausted` flag. Empty nonterminal pages leave another user pull available; no automatic request loop. Malformed envelopes raise an error rather than silently ending history. |
| Home reply titles                      | Persisted target titles could trail newer live/list metadata.                                                            | Resolve metadata by computer, provider and session identity, then freshness. Do not change the recipient.                                                                                             |
| Overview revision gaps                 | A gap invalidates overview coverage; later deltas cannot restore it without a snapshot.                                  | Safe HTTP fallback exists. Independent topic resubscription remains an optimization to implement.                                                                                                     |
| Overview collection                    | Any provider/workspace failure returns a null overview for the source.                                                   | Conservative fallback avoids presenting partial results as complete, but reduces aggregation coverage. Independent per-section availability requires a protocol change.                               |

## Existing protections checked

- The collector binds forwarded source IDs to the authenticated paired link. The App accepts only requested sources and fences callbacks from previous collector attempts.
- Task and overview streams have independent generation/revision chains. Stale revisions are ignored; task gaps trigger reconnect and overview gaps restore direct reads.
- HTTP discovery checks current screen ownership and fresh overview coverage before applying results.
- Summary grants bind owner, reader and audience. Socket delivery rechecks authorization; overview access requires additional explicit consent.
- History cursor loss remains distinct from exhaustion: the App refreshes its snapshot and retries once. Ambiguous prompt delivery is not retried.
- Overview collection is bounded and coalesced; unchanged data preserves references. These checks do not establish physical-device battery savings.

## Validation and limits

The ordering fix passed the Gateway suite (1,853 main tests, 16 lifecycle tests and one update test; 41 ignored). The title fix passed TypeScript, lint, formatting and 2,478 App tests. A focused stream audit passed 73 App tests and the Gateway `home_` selection (14 tests, including unrelated name matches).

Focused Android development-emulator acceptance opened the affected conversation, loaded four earlier pages of 80 rows, cold-launched the App, restarted its Gateway and loaded another earlier page after reconnecting. These checks are not the complete native E2E suite or a Release performance benchmark. The empty-page regression is a separate protocol scenario and must be distinguished from naturally observed history pages.

The empty-page fix was also exercised on the Android emulator using a temporary one-shot empty/nonterminal response. The next user pull reached the real Gateway and returned 80 rows with `exhausted=false`. The injection and diagnostic logs were removed before final validation and publication.
