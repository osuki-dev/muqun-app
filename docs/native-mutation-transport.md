# Android mutation transport patch

The installed `react-native-nitro-fetch@1.6.3` buffered and streaming transports use
Cronet 143.7445.0. A real Android test observed one task-create gesture produce a
committed POST whose acknowledgment was dropped, followed by another native POST
with the same encrypted envelope. Application code had called `nitroFetch` once.
The Gateway rejected the repeated envelope; that does not make transport replay
acceptable for managed operations.

The pinned Bun patch in `patches/react-native-nitro-fetch@1.6.3.patch` applies during
normal dependency installation through `patchedDependencies`. It changes Android
native source, so Metro refresh or an OTA JavaScript update cannot install the fix.
Rebuild the development client and production binaries that need it.

The patch uses one shared policy for both native request paths:

- GET, HEAD and OPTIONS retain existing transport behavior.
- All other methods explicitly request Cronet `NOT_IDEMPOTENT`. A builder without
  that API refuses the mutation before dispatch.
- Mutation upload providers refuse rewind before, during and after initial upload,
  and cannot disclose additional bytes after that refusal. This includes multipart
  bodies and buffered byte/string uploads.
- Mutation redirects are not followed, including the streaming wrapper's explicit
  `followRedirect()` entry point. Streaming builders freeze their method at build.

Cronet documents upload rewind as the mechanism used for redirects and retries
following timeouts or connection loss. The idempotency setting complements the
non-rewindable body; it is not an acknowledgment or proof that a server did no work.
An upload/read failure after dispatch remains unconfirmed. Reconcile the durable
operation key; do not automatically construct another mutation.

A debug-only existing `NitroLogger` call emits the constant policy revision,
engine class and engine version. It contains no URL, request ID, headers, body or
credentials. Release logging remains disabled by the dependency's existing default.

## Verification

`bash scripts/test-nitro-mutation-policy.sh` compiles the installed patched Java
policy against the actual cached Cronet 143.7445.0 API. It checks mutation method
classification, native idempotency, unsupported-builder refusal, initial partial
reads, zero/partial/full-body rewind refusal, and unchanged read-only rewind.
Set `CRONET_API_AAR` explicitly if that pinned Android dependency is not in the
usual Gradle cache. This test does not drive a device or issue a network request.

A fresh copy of the pinned package must accept the committed patch. The project
must also pass frozen-lockfile installation, native Kotlin/Java compilation, and
the normal App gates. The decisive runtime test needs the rebuilt APK: commit a
real create request, drop its successful acknowledgment, confirm exactly one POST,
then kill/relaunch and reconcile using a GET receipt lookup. Record the actual
observations separately; JVM tests do not establish this outcome.

## Platform and fallback limits

This patch does not establish iOS no-replay behavior. The dependency's buffered iOS
path uses `URLSession.data(for:delegate:)` with a reusable `httpBody`; its streaming
URLSession delegate currently follows redirects automatically. iOS needs a separate
review and real lost-acknowledgment/redirect tests before claiming the same guarantee.
No iOS native files are changed by this Android patch.

The dependency's native entry now refuses methods other than GET, HEAD and OPTIONS
before calling its global `fetch` fallback when the Nitro client is unavailable.
This covers both the Metro TypeScript source and published JavaScript entry.
Request objects supply their method unless `init.method` overrides it. No body or
credentials enter the fallback after refusal. The explicitly selected browser
entry retains normal browser fetch behavior, including mutations; it does not
claim the Android native no-replay guarantee. Isomorphic users importing the native
entry get the same conservative refusal instead of an implicit mutation downgrade.
Bodyless mutation retry behavior still needs runtime evidence beyond a
non-rewindable upload provider.

## iOS implementation proposal, pending validation

Use a default or ephemeral URLSession and a per-task delegate for both buffered
and streaming response paths. For mutation redirects, call the redirect completion
handler with `nil`. Do not use background sessions: Apple's redirect delegate
contract says those tasks follow redirects automatically.

For bodies, replace the mutation `httpBody` Data/file path with
`uploadTask(withStreamedRequest:)` and a retained, single-use body owner on the
serial delegate queue. Supply its initial InputStream once from
`urlSession(_:task:needNewBodyStream:)`; subsequent requests for another body stream
must receive `nil` and cancel the task. Never reset, reopen, or manufacture a second
stream after body admission. Preserve the exact initial bytes and propagate an
ambiguous transport error to the existing receipt workflow.

Apple documents that this delegate supplies the initial streamed-upload body and
replacement streams when a request is resent. It also states that Data/file bodies
do not need that delegate. Consequently, adding a delegate while keeping the current
reusable `httpBody` is insufficient. The existing async buffered request would need
a delegate-backed upload task; existing streaming response callbacks can share that
same single body owner. Read-only requests keep existing behavior.

This is an implementation proposal, not a verified iOS guarantee. Test initial and
partial reads, denied second streams, redirects, authentication challenges, a
successful commit followed by connection loss, cancellation and process recovery
on a rebuilt iOS client. In particular, one stream admission alone does not prove
that URLSession never reuses an internal buffer. Do not claim completion until
wire-level evidence shows one mutation and read-only receipt recovery.

Sources:

- https://docs.expo.dev/versions/v57.0.0/
- https://developer.android.com/develop/connectivity/cronet/reference/kotlin/org/chromium/net/UploadDataProvider
- https://bun.com/docs/pm/cli/patch
- https://developer.apple.com/documentation/foundation/urlsessiontaskdelegate/urlsession(_:task:neednewbodystream:)
- https://developer.apple.com/documentation/foundation/urlsessiontaskdelegate/urlsession(_:task:willperformhttpredirection:newrequest:completionhandler:)
