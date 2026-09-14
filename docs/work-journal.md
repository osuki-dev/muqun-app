# Pending work journal

The task controller must hydrate its pending-intent journal before enabling any
mutation. It writes the next request key and stage before each POST, and records
known stage acknowledgments before dependent reads. Rehydration only restores a
guard and enables explicit read-only receipt reconciliation; it never resends a
request. A missing Gateway receipt is not proof that an in-flight request had no
effect.

`work-journal.ts` validates and serializes one bounded envelope. A record contains
only its pairing fingerprint, session, request key, action kind, submission
state, optional task ID, and optional operation ID. The journal contains no bearer
tokens, transport keys, prompts, drafts, repository paths, or result content.
Pairing replacement and session changes select different records. Unresolved
records are never evicted or aged out: the limit of 32 records or 32 KiB refuses
new work instead. Corrupt or unknown schema versions also fail closed.

`work-journal-native.ts` uses the existing Expo SecureStore with
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Each write is awaited and read back before the
controller may send a network mutation. All journal instances share one storage
adapter and serialize read/modify/write operations within the JS runtime. On
Android, the installed SecureStore implementation writes encrypted preferences
with `commit()` rather than `apply()`.

Only explicit resolution clears a record. The controller retains unfinished
metadata when receipt/detail reads fail, after navigation, and after process
restart. Clear/write failures cannot grant permission for another POST.

Validation includes storage errors, readback failure, schema rejection, scope
isolation, capacity refusal, and concurrent scopes. A separate-process fixture
writes a pending request, exits, and constructs a fresh controller and journal;
it verifies recovery with the original actor/key and zero additional POSTs.
That fixture uses an injected file-backed storage port. It proves process-boundary
recovery logic, not Android SecureStore behavior or an iOS runtime guarantee.
Actual App termination/relaunch on Android remains a device verification gate;
iOS runtime verification is deferred to the user.

The explicit offline demo record uses a process-lifetime in-memory journal because
its backend task/receipt fixtures have the same lifetime. Navigation within that
process retains its pending guard; a fresh JS process starts both histories empty.
The selector checks only the reserved demo server identity. Every real pairing
still uses SecureStore, and any storage failure remains a mutation blocker; it
never switches to the demo journal. Demo restarts provide no evidence about real
SecureStore persistence.
