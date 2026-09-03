# Using the Gateway through an SSH tunnel

**"SSH is the transport, the Gateway is the brain."** A Muqun Gateway that only
listens on its host's loopback (or sits behind a firewall) is normally
unreachable from a phone. This feature lets such a Gateway be reached over an
SSH host the user has already saved: the app opens a local port forward through
the SSH session, and every Gateway request rides that forward instead of a
direct network hop. The Gateway is unchanged; nothing about how the client
authenticates is relaxed.

This document is the design of record. It is written so the code can be checked
against it, and it ends with the threat model the reader asked for.

---

## 1. How a client authenticates today (do not weaken any of this)

Read from `muqun-gateway/src/main.rs`, `src/authority.rs`, `src/transport.rs`
and the app's `src/lib/gateway-transport.ts`, `gateway-client.ts`,
`gateway-storage.ts`, `pairing*.ts`.

### The token
Every non-pairing route runs through `require_device` (`main.rs`): it reads the
`Authorization: Bearer <token>` header, hashes it (`hash_token` = SHA-256,
base64), and matches it against the stored device records in constant time
(`authority::identify_device`). Device records persist **only** the token hash,
never the token. A request with no valid token gets `403 invalid_token`.

### The encrypted transport (`muqun-aes-256-gcm-v1`)
When a Gateway is in the default `transport_encryption = required` mode, each
newly paired device also gets an independent 256-bit AEAD key (the
**transport key**, `transport_key` on the device record). From then on, a bare
bearer token is **not sufficient**: `require_device` additionally demands the
`x-muqun-internal-device-proof` header (for the encrypted-envelope path the
proof is the sealed envelope itself), and the real request body travels **inside**
an AES-256-GCM envelope:

- The client seals each request with `encryptJson(material, 'request', aad, …)`
  (`gateway-transport.ts`). `material` is the 32-byte transport key; the
  per-direction key is `HKDF-SHA256(material, salt="muqun-transport-v1",
  info="muqun-transport-v1/<direction>")` — directions `request`, `response`,
  `pairing-request`, `pairing-response`. The gateway derives the identical key
  (`transport.rs::derive_key`, same salt/info strings) — the two sides must
  match byte for byte.
- **AAD** is `"<METHOD> <path><search>"` (`requestAad`), i.e. the request line
  only — *not* the origin/host. Confirmed against the gateway: `main.rs`
  builds `format!("{} {}", parts.method, parts.uri.path_and_query()…)`. This is
  why swapping the host to a loopback tunnel address changes nothing the AEAD
  checks.
- The envelope carries `version`, `timestamp_ms`, `nonce`, `ciphertext`. The
  gateway rejects a skew over `MAX_CLOCK_SKEW_MS = 5 min` and caches nonces per
  device to refuse replays (`remember_transport_nonce`).
- The bearer **token is placed inside** the sealed payload
  (`EncryptedRequestPayload.token`), so on the wire even the token is not
  visible; the `X-Muqun-Device` header names which device key opens the
  envelope, and `X-Muqun-Envelope` carries it.
- Event streams (`/api/sessions/{id}/events`) are opened with a sealed GET whose
  per-stream key is bound to the request envelope's nonce
  (`encryptedEventStreamRequest`, `sse-record.ts`, gateway `transport.rs` SSE
  info `muqun-transport-v1/sse/<stream_id>/<request_nonce>`); the SSE records
  are individually sealed.

`disabled` mode is an explicit token-only compatibility path; the QR then omits
the key and pairing is not sealed.

### The `Host` header is checked, and this is why the forward uses an IP literal
The AAD is not the only thing that could have objected to a swapped origin. The
gateway runs a `known_host` middleware (`main.rs`) *before* auth: a request
whose `Host` header is not a name the gateway answers to is refused with
`403 unknown_host`. `host_is_known` accepts any **IP literal**, `localhost` and
`*.localhost`, and `*.ts.net`.

The tunnel base URL is `http://127.0.0.1:<localPort>`, so the `Host` header is
an IP literal and passes unconditionally. **This is a load-bearing detail:** if
`tunnelBaseUrl` ever grew a synthetic hostname, every tunnelled request would
start failing `unknown_host` — with an error that says nothing about the real
cause. It is pinned by `tunnelBaseUrl`'s test.

### Pairing (QR / code)
- The manager (`muqun-gateway manage`) prints a QR whose payload is
  `muqun://pair?u=<gateway url>&s=<server_id>&k=<transport bootstrap key>`
  (`pairing_qr_offer`, `main.rs`). `k` is the QR-only bootstrap secret; it is
  absent when the owner set `disabled`. The app parses it with
  `parsePairingOffer`.
- Flow: `POST /api/pair/request { request_id, device_name, install_id }` →
  gateway generates a one-time 8-char pairing **code** shown on the computer;
  the user types it into the app → `POST /api/pair/claim { request_id, code }` →
  the gateway returns the `PairingPayload` (`server_id`, `label`, `url`,
  `token`, `device_id`, `transport_key`, `transport`). See
  `beginPairingTransaction` / `claimPairingTransaction`.
- **Manual (typed-address) pairing** carries no QR key, so the claim response is
  sealed with material derived from the pairing **code** itself via Argon2id
  (`codePairingMaterial` client, `code_pairing_material` gateway — identical
  params: argon2id, mem 19456 KiB, time 2, lanes 1, out 32, salt =
  `SHA256("muqun-pairing-code-salt-v1" ‖ request_id)`), AAD
  `CODE_PAIRING_CLAIM_AAD`. A typed address therefore *requires* the encrypted
  transport (`transportRequired`), refusing a token-only downgrade
  (`validateClaimedPairing`).

### Default listen address / port, and loopback handling
- `DEFAULT_PORT = 23847` (`main.rs`). The public listener is normally localhost
  behind Tailscale Serve HTTPS or a Tailnet IPv4 (`auto_public_url`); the
  loopback fallback URL is `http://127.0.0.1:23847`.
- **The gateway gives loopback clients no special treatment.** There is no
  code path that skips `require_device` or the transport proof for a request
  arriving on `127.0.0.1`. `is_local_public_url` / `unreachable_listen_warning`
  only classify the *advertised URL* for a startup warning; they never gate
  auth. A request that reaches the socket over an SSH forward is
  indistinguishable from any other loopback request and is authenticated
  identically. **This is exactly why the tunnel must still present the token and
  the sealed transport — the socket itself trusts nobody.**

**Conclusion for this feature:** over the tunnel the client keeps sending the
same token and the same AES-GCM-sealed envelopes it sends today. The tunnel
only changes *where the bytes go* (a loopback port forwarded through SSH),
never *what the bytes are*. The stored `GatewayRecord.token` / `transportKey` /
`deviceId` / `transport` are used unchanged; only the base URL is swapped for
`http://127.0.0.1:<localPort>` at runtime.

---

## 2. Model

`GatewayRecord` (in `gateway-storage.ts`) gains one optional field:

```ts
sshTunnel?: { hostId: string; remoteHost: string; remotePort: number };
```

- `hostId` names a saved SSH host (`SshHostRecord.id`).
- `remoteHost` / `remotePort` are the gateway's address **as seen from the SSH
  server** (usually `127.0.0.1` and `23847`).
- The record's stored `url` **remains the gateway's real URL** as paired — it is
  what pairing reached and what the token was issued for, and it still feeds the
  request AAD's path. The **tunnel URL** (`http://127.0.0.1:<localPort>`) is
  **derived at runtime** and **never persisted**: the local port is ephemeral,
  chosen fresh each time the forward opens.

The sealed blob format is unchanged and backward compatible: `sshTunnel` is
additive and optional. `normalizeGatewayRecord` (new) drops a malformed
`sshTunnel` rather than the whole record, so an old record without the field
loads unchanged and a corrupt tunnel spec degrades to a plain (direct) record.
See the normaliser test in `gateway-storage.test.ts`.

---

## 3. Runtime

- **`src/lib/ssh-tunnel.ts`** — pure. The tunnel state machine (`idle →
  connecting → open → down`, plus `closed`), the reference-count / idle rules,
  and `tunnelBaseUrl(port)` URL derivation. It takes an injected SSH facade so
  it runs under `bun test` with a fake; it imports nothing native.
- **`src/stores/ssh-tunnels.ts`** — the live manager (Zustand). Given a
  `GatewayRecord` with `sshTunnel`, it ensures **one** SSH connection per host
  (reusing `ssh-client.ts`, credentials from the SSH hosts store, host-key trust
  via the same TOFU/mismatch rules as the SSH screen) and **one** forward per
  record. It exposes the effective base URL for a record and a status
  (`connecting | open | down`).
- **Teardown**: a forward is reference-counted by screens/holders using the
  record. It is torn down when no holder remains, on app background if the
  gateway session is idle, and on SSH disconnect (the library closes the forward
  itself when the connection drops; the store observes `onClosed`). It
  re-establishes transparently on reconnect, surfacing status in the UI
  ("Connecting through SSH…", "Tunnel down — reconnect").
- **The one seam**: `gateway-client.ts` resolves the effective base URL for the
  active record through the manager. `configureGateway(record)` computes the
  base URL as `sshTunnelBaseUrl(record) ?? record.url`, and the tunnel store
  calls `refreshGatewayTunnelBaseUrl()` whenever a forward opens or closes so
  the already-configured client repoints without a re-pair. The request AAD is
  path-only, so repointing the origin is transparent to the gateway. The client
  is not forked; the encrypted-transport predicate still keys on token/device/
  transportKey from the record.

Two records tunnelling to different gateways over one SSH host get **independent
forwards** on that one shared connection — no cross-talk: each forward is its
own `direct-tcpip` channel to its own `remoteHost:remotePort`, and each request
is sealed to its own device transport key.

Demo mode never tunnels (`isDemoRecord` short-circuits).

---

## 4. Pairing through SSH

In the pairing/explore flow, "Pair through an SSH host": pick a saved SSH host,
enter the gateway's port on that host (default `23847`), the app opens the
tunnel and runs the **existing** pairing flow against the tunnel URL
(`http://127.0.0.1:<localPort>`), then stores the record with `sshTunnel` set to
`{ hostId, remoteHost: '127.0.0.1', remotePort }`. Because the typed-URL pairing
path already requires the code-sealed encrypted transport, pairing over the
tunnel is sealed end to end exactly like a manual pairing. The pairing code is
entered manually, the same way `pairing-manual` does today.

---

## 5. UI

A tunnel badge/status shows on the server card and the workspace header
("Through <host>", "Connecting through SSH…", "Tunnel down"), with i18n across
all 8 locales and a11y labels. The SSH host's detail lists which gateways ride
on it. Demo mode shows no tunnel.

---

## Threat model

The reader asked for this explicitly. Each item is a claim the code is built to
satisfy.

### T1 — The loopback forward is reachable by other apps on the device
On both iOS and Android, a listener on `127.0.0.1:<port>` is reachable by **any
other app on the same device**. The forward is a plain TCP loopback listener, so
we must assume a hostile local app can connect to it and speak HTTP to the
gateway through it.

**Mitigation — the tunnel never bypasses gateway auth.** This is defense in
depth on top of the gateway's own refusal to trust loopback (§1): a local
attacker who connects to the forward reaches the gateway, but the gateway still
demands the bearer token *and*, in `required` mode, a correctly sealed
per-device AES-GCM envelope. Neither the token nor the transport key is on the
forward or derivable from it — both live only in the sealed gateway blob in the
keychain. So the attacker can open a TCP connection and receive `403`s. To limit
even that:

- **Ephemeral port** — `localPort: 0`, the OS picks a fresh high port each time;
  it is never persisted and changes every open, so it cannot be pre-targeted.
- **Small `maxConnections`** — the forward is opened with `maxConnections: 8`,
  capping how many tunnelled TCP connections a local attacker can pin open.
- **Closed when not needed** — the forward is reference-counted and closed as
  soon as no screen holds the record, on idle background, and on disconnect, so
  the window in which the port exists at all is minimised.

The token and encrypted transport are **mandatory over the tunnel** — there is
no code path that talks to a tunnelled gateway without them.

### T2 — SSH host-key trust
The tunnel uses the **same** TOFU + "Replace key" rules as the SSH terminal
screen, factored into a reusable hook (`useSshHostKeyPrompt`) that renders the
identical red mismatch dialog. `compareSshHostKey` decides `unknown | match |
mismatch`; a **mismatch blocks the tunnel** with the same red dialog and is
never auto-accepted. Declining aborts the connection. The tunnel manager never
writes a trusted key without the reader's explicit acceptance, and reuses the
host's pinned `hostKeyAlgorithms` exactly as the SSH screen does.

### T3 — Credentials never leak
- The SSH password / private key stay in the **sealed SSH secrets blob**
  (`ssh-host-storage.ts`), read at connect time via
  `useSshHostsStore.credentialFor` and never held in tunnel state longer than
  the connect call.
- The gateway token / transport key stay in the **sealed gateway blob**.
- Nothing crosses into logs, toasts, or error messages: tunnel failures are
  reported through `describeSshFailure` / `sshFailureLine` (the SSH screen's
  existing, credential-free formatter) and the gateway's `describeGatewayFailure`.
  No `console.*` prints a credential, host secret, token, or transport key. The
  status strings name only the host label, never a secret.

### T4 — Server-controlled strings
Host names and transport disconnect reasons are server/host-controlled. Every
such string shown in tunnel chrome goes through `sanitizeServerText`
(control-char / bidi / length sanitised), exactly as the SSH screen does.

### T5 — A malicious SSH host
The SSH host carries the tunnel's bytes and can see, drop, or tamper with them.
But that traffic is **still AES-256-GCM sealed to the gateway's per-device
transport key** (§1), which the SSH host does not have: it cannot read request
bodies or the token (both inside the envelope), and any tampering fails the
GCM auth tag at the gateway. Confirmed by reading `transport.rs` (server) and
`gateway-transport.ts` (client): the sealed envelope's key is
`HKDF(material=device transport key)`, and `material` never transits the SSH
session. In `disabled` (token-only) mode the host **can** read the token and
proxy requests — the same exposure as any token-only network path — so a
tunnelled record in disabled mode is no worse than a direct one, and the doc
recommends `required` (the default). A malicious host can of course refuse to
forward (denial of service); that surfaces as "Tunnel down".

### T6 — Two records, one host, two gateways
Two `GatewayRecord`s with `sshTunnel.hostId` equal but different
`remoteHost:remotePort` share one SSH connection and open **two independent
`direct-tcpip` forwards**. There is no shared listener and no cross-talk: each
forward reaches only its own gateway, and each gateway authenticates its own
device key. The manager keys forwards by `serverId`, connections by `hostId`,
and reference-counts each independently.

### T7 — A tunnelled record has no address this phone may use
Found while auditing this branch, and fixed in it. A `GatewayRecord`'s stored
`url` is the gateway's address **as seen from the SSH host** — for the
loopback-only gateway this feature exists for, `http://127.0.0.1:23847`. Sent
*from the phone*, that names **the phone's own loopback** — the very place T1
says a hostile local app may be listening. Three code paths addressed a stored
record by its `url` with `Authorization: Bearer <token>` attached:

- `revokeOwnGatewayPairing` (unpairing a server from Home, which can unpair a
  record no screen has open),
- `endpointForServer` in `notifications.ts` (answering an approval straight from
  a push notification),
- the reachability probe in `stores/server-reachability.ts`.

Each would have handed the gateway token to whatever was listening on the
phone's port 23847. The rule now lives in one named, tested function —
`directGatewayBaseUrl(record)` in `ssh-tunnel.ts` — which returns `null` for a
tunnelled record, and all three go through it:

- **Unpair** brings the record's own forward up for the call
  (`setGatewayTunnelSessionOpener`, the hold released in a `finally`) and treats
  a forward that will not open as unreachable — the same pass an unreachable
  gateway already got, so a dead record can still be forgotten. It **never**
  falls back to the stored URL; that is what `GatewayTunnelUnavailableError`
  exists to make impossible to do by accident.
- **The notification action** returns no endpoint, which the caller already
  resolves to `open-pane`: the workspace holds the tunnel up and asks the
  question properly. Dialling SSH from a backgrounded app, possibly behind a
  host-key prompt nobody can see, is not something a notification tap should do.
- **The probe** returns early. A tunnelled server reports through its tunnel
  badge instead.

### Confirmed against the gateway source
Read directly from `/Users/okk/.repos/muqun-gateway` while writing this:

- **No loopback shortcut exists.** `require_device` is unconditional on every
  authenticated route; the gateway never obtains the peer socket address at all.
  Missing/!Bearer → `401`, unknown token → `403 invalid_token`, and a device
  holding a `transport_key` additionally needs the proof or gets
  `403 device_proof_required`. `/health` and `/api/meta` are gated too — which
  is why probing a tunnelled record was a token-bearing request, not a ping.
- **T5 holds for this client.** The sealing material is the per-device
  `transport_key`, HKDF-SHA256 with salt `muqun-transport-v1` and info
  `muqun-transport-v1/<direction>`, and this app only ever puts
  `X-Muqun-Device` + `X-Muqun-Envelope` on the wire. It never sends the
  device-proof header itself, so the transport key does not transit the SSH
  session and a malicious host sees only sealed bodies.
- **An upstream note, not an app issue:** the gateway *accepts* a client-supplied
  `x-muqun-internal-device-proof` on the unencrypted path and nothing strips it,
  so some *other* client could authenticate by sending the transport key in
  cleartext. Muqun does not, and a tunnel does not make it easier — but the
  "the key never transits the network" property is the client's discipline
  rather than something the gateway enforces. Worth raising on the gateway.
- **`transport_protection` is a config readout, not a per-request one.** It is
  computed from the gateway's own `listen`/`public_url`, so a Tailscale-bound
  gateway keeps reporting `tailscale-wireguard` even when it is being reached
  through this tunnel. The web-service and Simfarm entries gate on that value;
  see the open question in the pull request.

### Residual risks (stated, not mitigated away)
- Token-only (`disabled`) gateways expose the token to the SSH host and to a
  local app that races the port; use `required` (default).
- A local app can cause `403` load against the gateway through the port while it
  is open; bounded by `maxConnections` and the short-lived port.
- Host-key TOFU trusts the first key seen, as SSH TOFU always does; a
  first-connection MITM on the SSH layer is the standard TOFU caveat and is out
  of scope here as it is for the terminal screen.
