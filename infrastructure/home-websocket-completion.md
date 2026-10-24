# Home streams, history requests and lifecycle ownership

## Transport

Gateways advertising `agent_history_ws_v1` serve `snapshot`, `delta` and `earlier` through correlated `history_request` / `history_response` frames on the existing authenticated, encrypted agent WebSocket. Both transports use the same Gateway projection functions: internal-row filtering, image attachment and history cursor semantics are unchanged. The source Gateway handles private conversation reads; collectors do not acquire transcript access.

The App captures the source ID before sending. Responses must match request ID, source ID and session ID. Identical concurrent requests share a promise, so two consumers cannot accidentally advance one earlier-history cursor twice. Requests are not replayed after disconnect, timeout or an ambiguous response. Older Gateways retain HTTP compatibility; files, pairing and unrelated mutations retain their existing transports.

## Independent overview recovery

`home_overview_resync_v1` allows a source-specific snapshot replay without replacing the task subscription or reopening the socket. The Gateway keeps the latest bounded overview per subscribed source and reconstructs snapshots from unchanged-data heartbeats. Unsubscribe, replacement and unavailable-source frames discard those cached snapshots. The App invalidates coverage after a revision gap and requests a replay, with a per-source retry interval to avoid a request loop. HTTP remains the compatibility fallback when this optional capability is absent.

## Failure isolation

`home_overview_sections_v1` is explicitly requested. Provider and workspace reads run concurrently with individual five-second deadlines; the full collection has a twelve-second deadline. Failed sections are listed separately. Healthy provider sessions and workspace panes remain usable. The App retains failed-provider titles with unknown status and avoids substituting another workspace for an unavailable selected workspace. The Gateway retries collection on its shared cadence. Legacy clients receive a null overview on partial failure, preserving their conservative fallback contract.

## Memory and resource ownership

- Each App socket owns its history promises, deadlines and connection listeners. Settlement removes them; disposal rejects pending work and cancels timers. The last request cancels a pending reconnect instead of creating an unused connection.
- Removed pairings dispose and remove their cached socket, including its AppState listener. Still-paired computers reuse one socket object each.
- Each Gateway socket owns a `JoinSet` of history workers. Closing the socket cancels the workers. Subscription replacement drains canceled Home workers before starting their replacements.
- Personal multi-session usage allows 32 in-flight history requests per socket. Requests have a 30-second server deadline and 35-second client deadline; individual response bodies are limited to 16 MiB. These limits do not cap total paged history.
- The shared overview cache remains bounded to 128 KiB per source; each connection retains only its subscribed sources. Slow writes use the existing socket send deadline.

## Validation

Protocol tests exercise history identity, peer refusal, overview-only replay, provider failure isolation, concurrent request deduplication, deadlines, request budgets, and disposal after 100 sequential requests. Native acceptance and memory observations are recorded separately; development-build PSS observations are not a Release benchmark or proof that the entire application is leak-free.

### Recorded acceptance

The paired Android development emulator successfully read the affected conversation over WebSocket: snapshot, delta and earlier-page operations returned 200. A temporary overview revision-gap injection recovered through a source-specific snapshot replay. The instrumentation was removed before delivery. Both Linux and macOS Gateway release binaries were installed and their checksums matched the build outputs.

Repeated conversation entry/exit was sampled in three batches of five. App total PSS (KiB) was 1,377,454 before the batches, then 1,412,594, 1,483,996 and 1,506,087; a later sample fell to 1,435,668. Gateway RSS rose from 98,520 to 153,584 KiB while the live test conversation continued to grow; its thread count stayed at 35 and descriptors ranged from 31 to 33. These development-session observations include live history/cache growth and some Fast Refresh activity, so they do **not** prove absence of a retained-heap leak. A stable Release-build heap comparison is still needed for that conclusion.

The concrete resource defects fixed here are retained sockets/AppState listeners after removing pairings and a reconnect timer surviving the final request. Automated disposal tests cover 100 sequential requests plus pending-request cancellation, deadline and concurrency-budget cleanup.

The three Home layouts (Classic, Editorial and Stage) were opened on the same paired Android emulator after the changes; source task lists remained visible. This is focused visual/data acceptance, not the complete native flow suite.
