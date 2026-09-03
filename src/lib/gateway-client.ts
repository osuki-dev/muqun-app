import { File } from 'expo-file-system';
import { fetch as nitroFetch, Response as NitroResponse } from 'react-native-nitro-fetch';
import QuickCrypto from 'react-native-quick-crypto';

import {
  configure,
  deleteApiDevicesPushToken,
  deleteApiSessionsBySessionIdPanesByPaneId,
  deleteApiSessionsBySessionIdTabsByTabId,
  deleteApiPairingsByDeviceId,
  deleteApiSessionsBySessionIdWorkspacesByWorkspaceId,
  getApiPairings,
  getApiSessionsBySessionIdAgents,
  getApiSessionsBySessionIdAgentsByTarget,
  getApiSessionsBySessionIdPanes,
  getApiSessionsBySessionIdPanesByPaneId,
  getApiSessionsBySessionIdPanesByPaneIdOutput,
  getApiSessionsBySessionIdPanesByPaneIdShortcuts,
  getApiSessionsBySessionIdTabs,
  getApiSessionsBySessionIdWorkspaces,
  getApiSessions,
  getHealth,
  patchApiSessionsBySessionIdPanesByPaneId,
  patchApiSessionsBySessionIdTabsByTabId,
  patchApiSessionsBySessionIdWorkspacesByWorkspaceId,
  postApiDevicesPushToken,
  postApiNotificationsTest,
  postApiSessionsBySessionIdAgentsByTargetFocus,
  postApiSessionsBySessionIdAgentsByTargetSend,
  postApiSessionsBySessionIdPanesByPaneIdFocus,
  postApiSessionsBySessionIdPanesByPaneIdSendKeys,
  postApiSessionsBySessionIdPanesByPaneIdSendText,
  postApiSessionsBySessionIdPanesByPaneIdSplit,
  postApiSessionsBySessionIdPanesByPaneIdZoom,
  postApiSessionsBySessionIdTabs,
  postApiSessionsBySessionIdTabsByTabIdFocus,
  postApiSessionsBySessionIdWorkspaces,
  postApiSessionsBySessionIdWorkspacesByWorkspaceIdFocus,
  setToken,
} from '@/api';
import { activeLocaleHeaders } from '@/i18n/active-locale';
import {
  answerHasNoBody,
  headerRecord,
  isStreamingRequest,
  startRequestBudget,
  withBodyDeadline,
} from './request-budget';
import { normalizeGatewayEntities, normalizeGatewayEntity, type GatewayEntity } from './gateway-entities';
import { GatewayTransportRefusalError } from './gateway-refusal';
import {
  encodeMultipart,
  multipartBoundary,
  multipartContentType,
  utf8Bytes,
  type MultipartPart,
} from './multipart';
import {
  assetFromContentHeaders,
  findAssetById,
  findAssetByPath,
  assetKindQuery,
  sessionAssetsFromResponse,
  // Re-exported further down as well, but `export … from` binds nothing in this
  // module, and the kind allow-list on a listing request is typed with it.
  type AssetKind,
  type SessionAsset,
} from './session-assets';
import {
  NO_GATEWAY_CAPABILITIES,
  panePartsFromResponse,
  type PaneParts,
} from './pane-parts';
import {
  FILE_MENTION_LIMIT,
  fileMentionHitsFromResponse,
  type FileMentionHit,
} from './file-mentions';
import {
  isApprovalConflictCode,
  paneApprovalAnswerFromResponse,
  paneApprovalFromResponse,
  type ApprovalConflictCode,
  type NamedApprovalDecision,
  type PaneApprovalAnswer,
  type PaneApprovalState,
} from './pane-approval';
import { agentEventsFromResponse, type AgentEvent } from './away-digest';
import {
  agentProfilesFromResponse,
  recentCwdsFromResponse,
  spawnedAgentFromResponse,
  type AgentProfile,
  type AgentSpawnRequest,
  type SpawnedAgent,
} from './agent-spawn';
import {
  demoAgentEvents,
  demoAgentProfiles,
  demoAgents,
  demoAssetContentUri,
  demoAssetText,
  demoHealth,
  demoPanes,
  demoPaneFiles,
  demoPaneOutput,
  demoPaneRange,
  demoPaneParts,
  demoRecentCwds,
  demoSessionAssets,
  demoSessions,
  demoSpawnedAgent,
  demoShortcuts,
  demoTabs,
  demoWorkspaces,
  isDemoActive,
  isDemoRecord,
  setDemoActive,
} from './demo-gateway';
import type { GatewayRecord } from './gateway-storage';
import type { PairingPayload } from './pairing';
import {
  CODE_PAIRING_CLAIM_AAD,
  GATEWAY_TRANSPORT,
  decryptJson,
  encryptJson,
  pairingKeyMaterial,
  transportKeyMaterial,
  type EncryptedEnvelope,
} from './gateway-transport';
import { assertSupportedHerdr } from './herdr-compatibility';

const REQUEST_TIMEOUT_MS = 8_000;
// An attachment is orders of magnitude larger than a control call, and the
// gateway is usually reached over Wi-Fi or a tunnel, so it gets its own budget
// rather than being cut off by the request timeout.
const UPLOAD_TIMEOUT_MS = 60_000;

export const INITIAL_PANE_OUTPUT_LINES = 240;
export const PANE_OUTPUT_PAGE_LINES = 240;
// Matches MAX_EMULATED_ROWS in the terminal emulator. Asking for more than the
// emulator can hold means downloading and parsing lines that are then dropped.
export const MAX_PANE_OUTPUT_LINES = 2_000;

/**
 * One request, one deadline -- and the deadline covers the body, not just the
 * headers.
 *
 * Every timed request in this file used to arm an abort timer and clear it in a
 * `finally` around the `nitroFetch` call. But `nitroFetch` resolves when the
 * response HEADERS arrive, so the clear ran while the body was still on the
 * wire, and everything after it -- the generated client's `await
 * response.json()`, every `await response.text()` here -- ran with no deadline
 * at all. A gateway that answered 200 and then stalled mid-body left the caller
 * awaiting forever: no error, no timeout, a spinner that never stops.
 *
 * The parts that can be wrong on their own live in `request-budget`, where they
 * can be tested without a transport. This is the wiring.
 *
 * @param timeoutMs Budget for the whole request.
 * @param message What to say when the budget runs out, in the caller's words.
 */
async function fetchWithin(
  timeoutMs: number,
  message: string,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const budget = startRequestBudget(timeoutMs, message, init.signal);

  let response: Response;
  try {
    response = await Promise.race([
      nitroFetch(input, { ...init, signal: budget.signal }),
      budget.deadline,
    ]);
  } catch (failure) {
    budget.disarm();
    throw failure;
  }

  if (answerHasNoBody(init.method, response.status)) {
    budget.disarm();
    return response;
  }

  return withBodyDeadline(response, budget);
}

interface EncryptedRequestPayload {
  token: string;
  content_type?: string;
  body: string;
}

interface EncryptedResponsePayload {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function base64Url(value: Uint8Array): string {
  return QuickCrypto.Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string) {
  return QuickCrypto.Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestAad(input: RequestInfo | URL, method: string): string {
  const url = new URL(requestUrl(input));
  return `${method.toUpperCase()} ${url.pathname}${url.search}`;
}

function shouldEncryptGatewayRequest(input: RequestInfo | URL): boolean {
  if (
    !currentToken ||
    !currentDeviceId ||
    !currentTransportKey ||
    currentTransport !== GATEWAY_TRANSPORT
  ) return false;
  try {
    const url = new URL(requestUrl(input));
    const gateway = new URL(currentBaseUrl);
    if (url.origin !== gateway.origin) return false;
    return !url.pathname.startsWith('/api/pair/');
  } catch {
    return false;
  }
}

/**
 * What React Native's `FormData.getParts()` answers: a value is either an
 * inline string or a file it only knows by URI. React Native does not export
 * the type, and the shape is the contract this module actually depends on.
 */
type FormDataPart =
  | { string: string; headers: Record<string, string> }
  | { uri: string; headers: Record<string, string> };

/**
 * Read one `FormData` part into the bytes the envelope will seal.
 *
 * React Native models a file as `{ uri }` rather than as a `Blob`, so the bytes
 * still have to be fetched from disk. `expo-file-system` does that natively and
 * is already in every binary as a dependency of `expo` itself, so this costs no
 * new native module.
 */
async function multipartPartFrom(part: FormDataPart): Promise<MultipartPart> {
  if ('string' in part) {
    return { headers: part.headers, content: utf8Bytes(part.string) };
  }
  return { headers: part.headers, content: await new File(part.uri).bytes() };
}

/**
 * Turn a request body into the bytes the transport seals, and say what the
 * gateway should read them as.
 */
async function serializeBody(body: BodyInit | null | undefined, contentType?: string) {
  if (body == null) return { bytes: QuickCrypto.Buffer.alloc(0), contentType };
  if (body instanceof FormData) {
    // Deliberately not `new Response(body).arrayBuffer()`. React Native's
    // `Response` keeps a `FormData` unread and throws `could not read FormData
    // body as blob`, and reports no `content-type` for one either -- so that
    // spelling failed every attachment upload on the encrypted transport before
    // a byte left the phone. The body and its boundary are built here instead.
    const boundary = multipartBoundary(
      QuickCrypto.Buffer.from(QuickCrypto.randomBytes(16)).toString('hex')
    );
    const parts = (body as unknown as { getParts(): FormDataPart[] }).getParts();
    const encoded: MultipartPart[] = [];
    for (const part of parts) encoded.push(await multipartPartFrom(part));
    return {
      bytes: QuickCrypto.Buffer.from(encodeMultipart(encoded, boundary)),
      contentType: multipartContentType(boundary),
    };
  }
  if (typeof body === 'string') {
    return { bytes: QuickCrypto.Buffer.from(body, 'utf8'), contentType };
  }
  if (body instanceof ArrayBuffer) {
    return { bytes: QuickCrypto.Buffer.from(body), contentType };
  }
  if (ArrayBuffer.isView(body)) {
    return {
      bytes: QuickCrypto.Buffer.from(body.buffer, body.byteOffset, body.byteLength),
      contentType,
    };
  }
  if (body instanceof Blob) {
    return { bytes: QuickCrypto.Buffer.from(await body.arrayBuffer()), contentType };
  }
  throw new Error('This request body cannot be encrypted by the Gateway transport.');
}

async function encryptedGatewayFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  endpoint?: GatewayEndpoint
): Promise<Response> {
  const token = endpoint?.token ?? currentToken;
  const deviceId = endpoint?.deviceId ?? currentDeviceId;
  const transportKey = endpoint?.transportKey ?? currentTransportKey;
  if (!token || !deviceId || !transportKey) throw new Error('Not connected to a server.');
  if (isStreamingRequest(init)) {
    throw new Error('Encrypted event streams use the dedicated stream transport.');
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const aad = requestAad(input, method);
  const headers = headerRecord(init.headers);
  const contentType = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'content-type'
  )?.[1];
  const serialized = await serializeBody(init.body, contentType);
  const plaintext: EncryptedRequestPayload = {
    token,
    ...(serialized.contentType ? { content_type: serialized.contentType } : {}),
    body: base64Url(serialized.bytes),
  };
  const material = transportKeyMaterial(transportKey);
  const envelope = encryptJson(material, 'request', aad, plaintext);
  const envelopeJson = JSON.stringify(envelope);
  const bodylessMethod = method === 'GET' || method === 'HEAD';
  const outerHeaders = { ...headers };
  for (const name of Object.keys(outerHeaders)) {
    if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'content-type') {
      delete outerHeaders[name];
    }
  }
  const response = await fetchWithin(timeoutMs, 'Timed out waiting for the server.', input, {
    ...init,
    method,
    headers: {
      ...outerHeaders,
      'Content-Type': 'application/json',
      'X-Muqun-Transport': '1',
      'X-Muqun-Device': deviceId,
      ...(bodylessMethod
        ? { 'X-Muqun-Envelope': base64Url(QuickCrypto.Buffer.from(envelopeJson, 'utf8')) }
        : {}),
    },
    body: bodylessMethod ? undefined : envelopeJson,
  });
  if (response.headers.get('x-muqun-transport') !== '1') {
    // Not a mystery, and not a transport fault. The gateway's middleware seals
    // a response only once the request has authenticated, so every refusal on
    // the way there -- unknown device, dead token, missing transport key,
    // unknown host -- arrives here in plaintext with the reason in the body.
    // Reading it is the whole difference between telling someone this server no
    // longer knows their device and telling them an encryption marker was
    // missing. `GatewayTransportRefusalError` carries status and body through to
    // `describeGatewayFailure`, which decides what that reason means.
    throw new GatewayTransportRefusalError(response.status, await response.text().catch(() => ''));
  }
  const sealed = (await response.json()) as EncryptedEnvelope;
  const payload = decryptJson<EncryptedResponsePayload>(
    material,
    'response',
    `${aad}\n${envelope.nonce}`,
    sealed
  );
  if (
    !Number.isInteger(payload.status) ||
    payload.status < 100 ||
    payload.status > 599 ||
    typeof payload.body !== 'string' ||
    !payload.headers ||
    typeof payload.headers !== 'object' ||
    Array.isArray(payload.headers)
  ) {
    throw new Error('Gateway returned an invalid encrypted response.');
  }
  const bytes = fromBase64Url(payload.body);
  const noBody = answerHasNoBody(method, payload.status);
  // Use the same response implementation as the request transport. React
  // Native's global Response treats a QuickCrypto Buffer as a string-like body
  // on Android, decoding each UTF-8 byte as one character ("⏺" became
  // "â…"). NitroResponse recognises ArrayBuffer views and preserves both JSON
  // UTF-8 and binary asset bodies.
  return new NitroResponse(noBody ? null : (bytes as unknown as BodyInit), {
    status: payload.status,
    headers: payload.headers,
  }) as unknown as Response;
}

/** Every gateway call the generated client and this file make, on one budget. */
const gatewayFetch: typeof globalThis.fetch = async (input, init) => {
  // The one place worth stamping the locale, because both the generated client
  // and every raw call in this file come through here. Merged underneath the
  // caller's own headers rather than over them, so a request that has a reason
  // to ask for a different language keeps it -- and read per call rather than
  // captured once, so switching language in Settings takes effect on the very
  // next request without reconfiguring anything.
  const headers = { ...activeLocaleHeaders(), ...headerRecord(init?.headers) };
  if (shouldEncryptGatewayRequest(input)) {
    return encryptedGatewayFetch(input, { ...init, headers });
  }

  // Exempt, and deliberately: see `isStreamingRequest`.
  if (isStreamingRequest(init)) return nitroFetch(input, { ...init, headers });

  // "Timed out" is load-bearing, not phrasing. `describeGatewayFailure` reads
  // these messages to decide what kind of failure this was, and a deadline that
  // does not say so is filed as a plain request error: shown to the user
  // verbatim, in English, and marked not worth retrying -- which is the wrong
  // answer on all three counts for a server that simply went quiet.
  return fetchWithin(REQUEST_TIMEOUT_MS, 'Timed out waiting for the server.', input, {
    ...init,
    headers,
  });
};

export interface HealthResponse {
  ok: boolean;
  gatewayVersion: string;
  apiVersion?: string;
  apiMajor?: number;
  minimumCompatibleApiVersion?: string;
  legacyUnversionedApi?: boolean;
  capabilities?: string[];
  serverId: string;
  label: string;
  /**
   * How the gateway describes the protection on this connection.
   *
   * `protection` is a closed vocabulary (`TransportProtection` in
   * `@/lib/web-service`) but is typed as a plain string here: it arrives from
   * the network, an older or newer gateway may send a word this build has never
   * heard of, and narrowing at the boundary would be asserting something the
   * wire cannot promise. Readers ask a predicate rather than compare literals.
   */
  transportSecurity?: {
    protection?: string;
    applicationLayerEncryption?: boolean;
    httpsRecommended?: boolean;
  };
  herdr?: {
    connected?: boolean;
    version?: string;
    protocol?: number;
    compatible?: boolean;
    supportedProtocolMin?: number;
    /** `null` means the gateway declares no upper bound. */
    supportedProtocolMax?: number | null;
    error?: string;
    response?: unknown;
  };
  /**
   * The session `GET /api/sessions` leads with, and the one the `herdr` key
   * above is actually about -- that key is a legacy envelope and carries the
   * primary backend's verdict whatever kind it is. `kind` is the only field
   * that says which; without it a failure reads as a Herdr failure even when
   * the backend that is down is tmux.
   */
  backend?: {
    kind?: string;
    connected?: boolean;
    version?: string | null;
    protocol?: number | null;
  };
}

export interface SessionsResponse {
  sessions?: {
    id: string;
    label: string;
    socket_path: string;
  }[];
}

export type HerdrEntity = GatewayEntity;

export interface ShortcutKey {
  label: string;
  key: string;
  description?: string;
}

export interface SlashCommand {
  command: string;
  description?: string;
  /**
   * What may follow the command, e.g. "[instructions]". Null means the command
   * runs exactly as written, so it is safe to send on a single tap.
   */
  argument_hint?: string | null;
  /** "builtin" for the gateway's own table, "user"/"project" for a command file. */
  source?: string;
}

export interface PaneShortcuts {
  version: number;
  /** Which table the gateway matched: an agent name, "editor", or "shell". */
  profile: string;
  keys: ShortcutKey[];
  commands: SlashCommand[];
}

export interface PaneOutputResponse {
  text?: string;
  output?: string;
  content?: string;
  lines?: string[];
  [key: string]: unknown;
}

export interface GatewayTransport {
  loadHealth: () => Promise<HealthResponse>;
  loadSessions: () => Promise<SessionsResponse>;
  loadWorkspaces: (sessionId: string) => Promise<HerdrEntity[]>;
  loadTabs: (sessionId: string) => Promise<HerdrEntity[]>;
  loadPanes: (sessionId: string) => Promise<HerdrEntity[]>;
  loadAgents: (sessionId: string) => Promise<HerdrEntity[]>;
}

export interface DevicePushTokenRegistration {
  token: string;
  platform: 'ios' | 'android';
  device_name?: string;
}

export interface TestNotificationRequest {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

export interface PairingRequestResponse {
  request_id: string;
  server_id: string;
  server_label: string;
  status: 'pending';
  expires_in_ms?: number;
}

// Kept alongside the generated client's config so raw requests to endpoints the
// codegen doesn't know about (e.g. PATCH /api/meta) can reuse the same base+token.
let currentBaseUrl = '';
let currentToken: string | null = null;
let currentDeviceId: string | null = null;
let currentTransportKey: string | null = null;
let currentTransport: typeof GATEWAY_TRANSPORT | null = null;

function configureApi(
  baseUrl: string,
  token: string | null,
  deviceId: string | null = null,
  transportKey: string | null = null,
  transport: typeof GATEWAY_TRANSPORT | null = null
): void {
  currentBaseUrl = baseUrl;
  currentToken = token;
  currentDeviceId = deviceId;
  currentTransportKey = transportKey;
  currentTransport = transport;
  configure({
    baseUrl,
    fetch: gatewayFetch,
    responseExtractor: (raw) => raw,
  });
  setToken(token);
}

/**
 * Tell the connected gateway its display label, so agent push notifications show
 * the name the user set rather than the machine hostname. Best-effort: a no-op in
 * demo mode or when disconnected, and the caller ignores failures.
 */
export async function setGatewayLabel(label: string): Promise<void> {
  if (isDemoActive() || !currentBaseUrl || !currentToken) return;
  const response = await gatewayFetch(`${currentBaseUrl.replace(/\/$/, '')}/api/meta`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentToken}`,
    },
    body: JSON.stringify({ label: label.trim() }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
}

export interface UploadedAttachment {
  /** Path on the gateway host, which is what a pane or agent can actually read. */
  path: string;
  name: string;
  size: number;
  mime: string;
}

/**
 * nitro-fetch's native readers strip the `file://` prefix and open the rest as a
 * literal path, without percent-decoding it. A document picked with a space or
 * a CJK character in its name arrives percent-encoded, so it has to be decoded
 * here or the file is reported as missing. `content://` URIs go to Android's
 * resolver untouched, where the encoding is meaningful.
 */
function localFilePath(fileUri: string): string {
  if (!fileUri.startsWith('file://')) return fileUri;
  try {
    return decodeURI(fileUri);
  } catch {
    return fileUri;
  }
}

/**
 * Send one file to the gateway's attachment store and answer with the path the
 * pane can read it from.
 *
 * This bypasses the generated client because that client JSON-encodes every
 * body. It goes to `fetchWithin` rather than `gatewayFetch` so the upload gets
 * its own, much longer budget -- but the same budget shape, covering the reply
 * as well as the send.
 */
export async function uploadAttachment(
  fileUri: string,
  name: string,
  mime: string
): Promise<UploadedAttachment> {
  if (isDemoActive()) throw new Error('Attachments are not available in the demo.');
  const baseUrl = currentBaseUrl.replace(/\/$/, '');
  if (!baseUrl || !currentToken) throw new Error('Not connected to a server.');

  const form = new FormData();
  // React Native's FormData takes a local file as this triple. nitro-fetch
  // recognises it and assembles the multipart body natively, reading the file
  // on its own thread, so the bytes never pass through JS.
  form.append('file', { uri: localFilePath(fileUri), name, type: mime } as unknown as Blob);

  const uploadUrl = `${baseUrl}/api/uploads`;
  const uploadInit: RequestInit = {
      method: 'POST',
      // Content-Type is deliberately unset: the multipart boundary belongs to
      // whichever layer writes the body, and setting it here would not match.
      headers: { ...activeLocaleHeaders(), Authorization: `Bearer ${currentToken}` },
      body: form,
  };
  const response = currentTransport === GATEWAY_TRANSPORT
    ? await encryptedGatewayFetch(uploadUrl, uploadInit, UPLOAD_TIMEOUT_MS)
    : await fetchWithin(
        UPLOAD_TIMEOUT_MS,
        // "Timed out" so `describeGatewayFailure` files this as one; see `gatewayFetch`.
        'Timed out waiting for the upload.',
        uploadUrl,
        uploadInit
      );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const value = (await response.json()) as Partial<UploadedAttachment> | null;
  if (!value || typeof value.path !== 'string' || value.path.length === 0) {
    throw new Error('The server did not return a file path.');
  }
  return {
    path: value.path,
    name: typeof value.name === 'string' ? value.name : name,
    size: typeof value.size === 'number' ? value.size : 0,
    mime: typeof value.mime === 'string' ? value.mime : mime,
  };
}

/**
 * The gateway's unified content model (schema 1.0): anything an agent produced
 * that exists as a file. `kind` is sniffed server-side; `previewable` says
 * whether `GET /api/assets/{id}/content` will stream something renderable.
 *
 * Re-exported so a screen reaches for the gateway through one module the way it
 * always has, while the matching rules stay testable on their own.
 */
export {
  assetFromContentHeaders,
  findAssetById,
  findAssetByPath,
  sessionAssetsFromResponse,
  type AssetKind,
  type SessionAsset,
} from './session-assets';

/**
 * What the viewer hands to `expo-image`. Kept as a plain shape rather than
 * importing the image library's type, so this module stays free of UI deps.
 */
export interface AssetImageSource {
  uri: string;
  headers?: Record<string, string>;
  /** Identity for the image cache, so a rewritten file is not served stale. */
  cacheKey: string;
}

/**
 * How wide the Files listing's window is.
 *
 * A hundred rather than fifty because the window is a rolling one over
 * everything a machine writes, and an agent editing source can push every
 * artifact worth looking at out of fifty in under a minute. The kind filter is
 * the real fix -- it is applied by the gateway's scan, so `kind=image` returns
 * the newest images rather than the images among the newest N -- and this is
 * what "All" is worth on its own.
 */
export const SESSION_ASSET_PAGE_LIMIT = 100;
/**
 * As wide as the window can be asked to get: the gateway's own cap
 * (`ASSET_LIST_MAX_LIMIT`), said on this side so the Files sheet knows when it
 * has reached the end of what can be asked for, rather than discovering it by
 * asking for more and being handed the same page again.
 *
 * The endpoint has no cursor -- `since` narrows to files *newer* than a time,
 * which is the opposite direction -- so paging towards older files means
 * widening this window and reading the listing again.
 */
export const MAX_SESSION_ASSET_LIMIT = 200;

/**
 * Ceiling on a text-ish asset read. The gateway caps this too, but a phone is
 * the side that runs out of memory, so the app refuses oversized files before
 * asking for them rather than after receiving them.
 */
export const MAX_ASSET_TEXT_BYTES = 512 * 1024;
/**
 * Reading a file is not a control call; it gets its own, longer budget.
 *
 * The budget covers the WHOLE read -- the response headers and the body after
 * them. It used to be cleared the moment the headers arrived, so a gateway that
 * answered and then stalled mid-body left the promise pending for as long as
 * the socket stayed open, and the viewer spun on a file that was never going to
 * arrive. 15 seconds is the point past which a person has already decided the
 * app is broken.
 */
export const ASSET_CONTENT_TIMEOUT_MS = 15_000;

function gatewayUrl(path: string): string {
  const baseUrl = currentBaseUrl.replace(/\/$/, '');
  if (!baseUrl) throw new Error('Not connected to a server.');
  return `${baseUrl}${path}`;
}

function gatewayAuthHeaders(): Record<string, string> {
  // Carries the locale as well as the token, so the handful of calls that reach
  // for `nitroFetch` directly -- to get their own timeout -- are localized too
  // without each one having to remember.
  return {
    ...activeLocaleHeaders(),
    ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
  };
}

/**
 * Recent artifacts for a session, newest first. Raw rather than generated,
 * because the asset endpoints are additive and not in the OpenAPI client yet.
 */
export async function listSessionAssets(
  sessionId: string,
  tabId: string,
  options: { since?: number; limit?: number; kind?: readonly AssetKind[] } = {}
): Promise<SessionAsset[]> {
  if (isDemoActive()) {
    const assets = demoSessionAssets();
    return options.kind?.length
      ? assets.filter((asset) => options.kind?.includes(asset.kind))
      : assets;
  }

  const limit = Math.max(
    1,
    Math.min(MAX_SESSION_ASSET_LIMIT, Math.round(options.limit ?? SESSION_ASSET_PAGE_LIMIT))
  );
  // Both values are numbers, so the query is assembled directly rather than
  // through URLSearchParams, whose React Native shim is only a partial one.
  const query = [`limit=${limit}`];
  if (typeof options.since === 'number' && Number.isFinite(options.since)) {
    query.push(`since=${Math.round(options.since)}`);
  }
  // The kinds are a closed set of bare words, so they need no escaping either.
  // See `assetKindQuery` for why the filter is asked for rather than applied to
  // the answer.
  const kind = assetKindQuery(options.kind);
  if (kind) query.push(`kind=${kind}`);

  return requestSessionAssets(sessionId, tabId, query);
}

async function requestSessionAssets(
  sessionId: string,
  tabId: string,
  query: string[]
): Promise<SessionAsset[]> {
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/tabs/${encodeURIComponent(tabId)}/assets?${query.join('&')}`
    ),
    { headers: gatewayAuthHeaders() }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return sessionAssetsFromResponse(await response.json());
}

/**
 * The file a path printed in the output names.
 *
 * The listing is a rolling window over what was written recently -- on a busy
 * machine it can be under two minutes wide -- so matching a tapped path against
 * it finds nothing for almost anything worth tapping. The gateway resolves one
 * exact path instead, with no scan and no paging, and holds it to the same
 * scoped-root fence as every other read: a path outside a root answers "no
 * match" rather than an error, so this still cannot be used to probe the host.
 *
 * The listing match stays as the fallback, for a gateway that predates the
 * exact lookup and simply ignores the query parameter -- such a gateway answers
 * with an ordinary page, which is exactly what the fallback expects.
 */
export async function resolveAssetByPath(
  sessionId: string,
  tabId: string,
  path: string
): Promise<SessionAsset | null> {
  if (isDemoActive()) return findAssetByPath(demoSessionAssets(), path);

  // Only an absolute path is worth asking about: `~` is the shell's, not the
  // gateway's, and sending it would only ever come back empty.
  if (path.startsWith('/')) {
    const exact = await requestSessionAssets(sessionId, tabId, [
      `path=${encodeURIComponent(path)}`,
    ]);
    const match = findAssetByPath(exact, path);
    if (match) return match;
  }

  const listed = await listSessionAssets(sessionId, tabId, { limit: MAX_SESSION_ASSET_LIMIT });
  return findAssetByPath(listed, path);
}

/**
 * The artifact a part points at.
 *
 * Same rolling window, same problem, and one more escape: the bytes endpoint
 * resolves an id directly -- rebuilding its index if it has to -- so an id the
 * listing has forgotten is still a file the gateway will hand over. When the
 * listing does not know it, the content endpoint's own headers are asked what
 * it is.
 */
export async function resolveAssetById(
  sessionId: string,
  tabId: string,
  assetId: string
): Promise<SessionAsset | null> {
  if (isDemoActive()) return findAssetById(demoSessionAssets(), assetId);

  const listed = await listSessionAssets(sessionId, tabId, { limit: MAX_SESSION_ASSET_LIMIT });
  const match = findAssetById(listed, assetId);
  if (match) return match;

  return describeAssetById(assetId);
}

/**
 * Ask the content endpoint what an asset is without downloading it. A HEAD is
 * answered by the same handler as the GET, so the fence and the 404 mean what
 * they always mean; only the bytes are left out.
 */
async function describeAssetById(assetId: string): Promise<SessionAsset | null> {
  const response = await gatewayFetch(assetContentUrl(assetId), {
    // A HEAD response has no bytes in which to carry an encrypted envelope.
    // Encrypted records use GET for this rare fallback; ordinary records keep
    // the cheap metadata-only request.
    method: currentTransport === GATEWAY_TRANSPORT ? 'GET' : 'HEAD',
    headers: gatewayAuthHeaders(),
  });
  // 415 is the gateway saying "this exists, it just has no preview" -- which is
  // a file the details sheet can still describe.
  if (!response.ok && response.status !== 415) return null;
  return assetFromContentHeaders(assetId, (name) => response.headers.get(name), {
    previewable: response.status !== 415,
  });
}

/** Absolute, authenticated-read URL for an asset's bytes. */
export function assetContentUrl(assetId: string): string {
  if (isDemoActive()) return demoAssetContentUri(assetId);
  return gatewayUrl(`/api/assets/${encodeURIComponent(assetId)}/content`);
}

/**
 * An image is displayed straight from the gateway rather than downloaded first:
 * `expo-image` sends the auth header itself, decodes off the JS thread and owns
 * the disk cache, so the bytes never enter the JS heap. Copying them into a
 * cache file by hand would buy nothing and cost a full in-memory round trip.
 */
export function assetImageSource(asset: SessionAsset): AssetImageSource | null {
  const uri = assetContentUrl(asset.id);
  if (isDemoActive()) return { uri, cacheKey: asset.id };
  // expo-image cannot decrypt an AEAD envelope. Encrypted records load through
  // readAssetImageSource instead, and thumbnails stay off the wire.
  if (currentTransport === GATEWAY_TRANSPORT) return null;
  return {
    uri,
    headers: gatewayAuthHeaders(),
    cacheKey: `${asset.id}:${asset.modified_unix_ms}`,
  };
}

/** Download and authenticate image bytes before handing a data URI to the decoder. */
export async function readAssetImageSource(asset: SessionAsset): Promise<AssetImageSource> {
  const direct = assetImageSource(asset);
  if (direct) return direct;
  const response = await encryptedGatewayFetch(
    assetContentUrl(asset.id),
    { headers: gatewayAuthHeaders() },
    ASSET_CONTENT_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const mime = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
  if (!mime.startsWith('image/')) throw new Error('Gateway did not return an image.');
  const bytes = QuickCrypto.Buffer.from(await response.arrayBuffer());
  return {
    uri: `data:${mime};base64,${bytes.toString('base64')}`,
    cacheKey: `${asset.id}:${asset.modified_unix_ms}:encrypted`,
  };
}

/**
 * Text, markdown and code are read into a string because that is what the
 * viewers render anyway; a cache file would only add a copy. The size gate
 * above is what keeps that safe.
 */
export async function readAssetText(
  asset: SessionAsset,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  if (isDemoActive()) return demoAssetText(asset.id);
  if (asset.size > MAX_ASSET_TEXT_BYTES) {
    throw new Error('HTTP 413: This file is too large to open here.');
  }

  // `fetchWithin` rather than a bare `nitroFetch`: the budget has to cover the
  // body, because a file that starts arriving and stops is exactly the case the
  // viewer must not spin forever on. It also chains the caller's own signal --
  // the viewer closing, or the reader moving to a different file -- so leaving
  // a file that is still arriving stops the download rather than letting it run
  // to completion into a component that is gone.
  const url = assetContentUrl(asset.id);
  const init = { headers: gatewayAuthHeaders(), signal: options.signal };
  const response = currentTransport === GATEWAY_TRANSPORT
    ? await encryptedGatewayFetch(url, init, ASSET_CONTENT_TIMEOUT_MS)
    : await fetchWithin(ASSET_CONTENT_TIMEOUT_MS, 'Timed out reading the file.', url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  // The declared size can lag the file on disk, so the gate is re-checked
  // against what the server actually says it is about to send.
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_ASSET_TEXT_BYTES) {
    throw new Error('HTTP 413: This file is too large to open here.');
  }
  return response.text();
}

/**
 * The unified content model's part vocabulary, re-exported so a screen reaches
 * for the gateway through one module the way it always has.
 */
export {
  paneComposerFromResponse,
  type PaneComposer,
  type PaneSlashCommand,
} from './pane-composer';

export {
  PANE_PARTS_SCHEMA_MAJOR,
  type GatewayCapabilities,
  type PanePart,
  type PanePartRange,
  type PanePartStatus,
  type PaneParts,
  type PaneTodoItem,
} from './pane-parts';

/**
 * The `@` mention vocabulary, re-exported for the same reason the part one is:
 * a screen reaches for the gateway through a single module.
 */
export {
  FILE_MENTION_DEBOUNCE_MS,
  FILE_MENTION_LIMIT,
  FILE_MENTION_VISIBLE_ROWS,
  createFileMentionSearch,
  findFileMentionTrigger,
  insertFileMention,
  type FileMentionHit,
  type FileMentionSearch,
  type FileMentionTrigger,
} from './file-mentions';

/**
 * The normalized transcript for one pane. The raw ANSI endpoint remains the
 * fallback path and is never replaced by this one.
 *
 * A gateway that predates the content model answers 404, which is reported as
 * "no parts here" rather than as a failure: there is nothing wrong, this build
 * of the gateway simply has no structured view to offer.
 */
export async function listPaneParts(
  sessionId: string,
  paneId: string,
  lines = INITIAL_PANE_OUTPUT_LINES
): Promise<PaneParts> {
  if (isDemoActive()) return panePartsFromResponse(demoPaneParts(paneId));

  const lineLimit = Math.max(1, Math.min(MAX_PANE_OUTPUT_LINES, Math.round(lines)));
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/parts?lines=${lineLimit}`
    ),
    { headers: gatewayAuthHeaders() }
  );
  if (response.status === 404 || response.status === 501) {
    return {
      schemaVersion: '',
      capabilities: NO_GATEWAY_CAPABILITIES,
      source: 'none',
      structured: false,
      parts: [],
      composer: null,
    };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return panePartsFromResponse(await response.json());
}

/**
 * Fuzzy path search inside one pane's workspace, for the composer's `@` file
 * mentions. Paths only -- reading a file is what the asset endpoints are for.
 *
 * Every failure answers with an empty list rather than throwing. A gateway too
 * old to have this route, a pane with no workspace the gateway will look inside,
 * a timeout, a phone that just lost the network: none of them are worth
 * interrupting typing over, and the caller's contract stays "here is what there
 * is to mention, which may be nothing".
 */
export async function listPaneFiles(
  sessionId: string,
  paneId: string,
  query: string,
  limit = FILE_MENTION_LIMIT
): Promise<FileMentionHit[]> {
  if (isDemoActive()) return fileMentionHitsFromResponse(demoPaneFiles(paneId, query, limit));

  // The gateway clamps to 50 as well; asking within the range keeps the echoed
  // limit equal to the one requested, which makes a mismatch a real signal.
  const capped = Math.max(1, Math.min(50, Math.round(limit)));
  const search = [`limit=${capped}`];
  // Assembled by hand rather than through URLSearchParams, whose React Native
  // shim is only a partial one.
  if (query) search.push(`query=${encodeURIComponent(query)}`);

  try {
    const response = await gatewayFetch(
      gatewayUrl(
        `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(
          paneId
        )}/files?${search.join('&')}`
      ),
      { headers: gatewayAuthHeaders() }
    );
    if (!response.ok) return [];
    return fileMentionHitsFromResponse(await response.json());
  } catch {
    return [];
  }
}

/**
 * The "while you were away" vocabulary, re-exported for the same reason the
 * part and mention ones are: a screen reaches for the gateway through a single
 * module.
 */
export {
  AGENT_EVENTS_CAPABILITY,
  AWAY_THRESHOLD_MS,
  MAX_AGENT_EVENTS,
  MAX_DIGEST_ROWS,
  agentEventsFromResponse,
  awayDurationParts,
  gatewaySupportsAgentEvents,
  summariseAwayEvents,
  wasAwayLongEnough,
  type AgentEvent,
  type AwayDigest,
  type AwayDigestRow,
} from './away-digest';

/**
 * Every agent status transition this session's ring still holds.
 *
 * The gateway's ring is in memory and `MAX_AGENT_EVENTS` deep, so this is "the
 * recent past" and never "the history": an absence longer than the ring comes
 * back truncated, with no marker saying so. That is the right trade for what
 * the answer is used for -- a digest of what changed while nobody was watching
 * is allowed to be a summary of the last two hundred things that happened. A
 * restarted gateway answers with an empty list, because it was not watching.
 *
 * ## Why `since` is not sent
 *
 * The endpoint has one, and it is a trap for this caller. It is expressed in
 * the ring's own per-session `seq` -- a small, strictly increasing integer --
 * and it exists for a client polling for live updates, which carries the
 * highest `seq` it has seen and sends it back.
 *
 * This app is not that client. It asks once, on returning to a screen it may
 * not have opened since before the gateway was last restarted, and the question
 * it asks is "what happened after half past two". No sequence number it holds
 * can express that. Passing the timestamp instead is the obvious wrong move and
 * a silent one: it is a number, the parameter takes a number, and no `seq` will
 * ever exceed 1.8 trillion, so the answer would be an empty list forever and
 * the feature would simply never appear. So the whole ring is asked for, and
 * `summariseAwayEvents` applies the window against each event's own timestamp,
 * which is the only clock the two ends share.
 *
 * A gateway without the ring answers 404, reported as "no events" rather than
 * as a failure -- the same silent degradation the parts and approval endpoints
 * get. Callers should still gate on `gatewaySupportsAgentEvents` so an older
 * gateway is never asked at all, and so the surface stays invisible rather than
 * merely empty.
 */
export async function listAgentEvents(sessionId: string): Promise<AgentEvent[]> {
  if (isDemoActive()) return agentEventsFromResponse(demoAgentEvents());

  const response = await gatewayFetch(
    gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/agent-events`),
    { headers: gatewayAuthHeaders() }
  );
  if (response.status === 404 || response.status === 501) return [];
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return agentEventsFromResponse(await response.json());
}

/**
 * The permission menu vocabulary, re-exported so a screen reaches for the
 * gateway through one module the way it always has.
 */
export {
  APPROVAL_PUSH_CATEGORY_ID,
  PANE_APPROVALS_CAPABILITY,
  approvalPushTarget,
  gatewaySupportsApprovals,
  optionForDecision,
  type ApprovalDecision,
  type ApprovalOption,
  type ApprovalPushTarget,
  type NamedApprovalDecision,
  type PaneApproval,
  type PaneApprovalAnswer,
  type PaneApprovalState,
} from './pane-approval';

/**
 * The New Task vocabulary, re-exported for the same reason as the approvals
 * one above: a screen reaches for the gateway through one module.
 */
export {
  AGENT_SPAWN_CAPABILITY,
  agentIsInterruptible,
  agentSpawnRequest,
  canSpawnAgent,
  gatewaySupportsAgentSpawn,
  type AgentProfile,
  type AgentSpawnRequest,
  type SpawnedAgent,
} from './agent-spawn';

/**
 * The gateway refused an answer because the app's picture of the menu is stale.
 * Never retried: see rule 2 in `pane-approval.ts`.
 */
export class ApprovalConflictError extends Error {
  constructor(readonly code: ApprovalConflictCode) {
    super(`The approval changed before it could be answered (${code}).`);
    this.name = 'ApprovalConflictError';
  }
}

/** How a client names its answer: by option number, or by what it means. */
export interface ApprovalAnswerRequest {
  option?: number;
  decision?: NamedApprovalDecision;
  /**
   * The fingerprint the menu was read with. Optimistic concurrency: leaving it
   * out lets the gateway answer whatever is pending, which is precisely what
   * must not happen from a notification minutes old.
   */
  fingerprint?: string;
}

/**
 * A gateway address to talk to. The screen uses the connected one, but a
 * notification may arrive for a server that is not currently selected, so the
 * approval calls can be pointed at a stored record instead.
 */
export interface GatewayEndpoint {
  url: string;
  token: string;
  deviceId?: string;
  transportKey?: string;
  transport?: typeof GATEWAY_TRANSPORT;
}

function endpointFetch(endpoint: GatewayEndpoint, input: string, init: RequestInit = {}) {
  return endpoint.transport === GATEWAY_TRANSPORT && endpoint.deviceId && endpoint.transportKey
    ? encryptedGatewayFetch(input, init, REQUEST_TIMEOUT_MS, endpoint)
    : gatewayFetch(input, init);
}

function approvalPath(sessionId: string, paneId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/approval`;
}

async function approvalConflict(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: unknown } }
    | null;
  const code = body?.error?.code;
  if (isApprovalConflictCode(code)) throw new ApprovalConflictError(code);
  // A 409 the app has no name for is still a conflict: the safe reading is
  // "your picture is stale", which is what every code in this family means.
  throw new ApprovalConflictError('approval_changed');
}

/**
 * What the pane is waiting on, if anything.
 *
 * A gateway without `pane_approvals` answers 404, which is reported as "no
 * approval here" rather than as a failure -- the same silent degradation the
 * parts endpoint gets. Callers should still gate on the capability so an old
 * gateway is never polled at all.
 */
export async function readPaneApproval(
  sessionId: string,
  paneId: string,
  endpoint?: GatewayEndpoint
): Promise<PaneApprovalState | null> {
  if (isDemoActive()) return null;
  const base = (endpoint?.url ?? currentBaseUrl).replace(/\/$/, '');
  const token = endpoint?.token ?? currentToken;
  if (!base) throw new Error('Not connected to a server.');

  const target = endpoint ?? { url: base, token: token ?? '' };
  const response = await endpointFetch(target, `${base}${approvalPath(sessionId, paneId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (response.status === 404 || response.status === 501) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return paneApprovalFromResponse(await response.json());
}

/**
 * Answer the menu the pane is blocked on.
 *
 * Which keys move an agent's cursor is exactly the detail the app should not
 * have to know, so the answer is named rather than typed; raw `send-keys`
 * remains the fallback for a menu no client understands.
 */
export async function answerPaneApproval(
  sessionId: string,
  paneId: string,
  answer: ApprovalAnswerRequest,
  endpoint?: GatewayEndpoint
): Promise<PaneApprovalAnswer> {
  if (isDemoActive()) throw new Error('Approvals are not available in the demo.');
  const base = (endpoint?.url ?? currentBaseUrl).replace(/\/$/, '');
  const token = endpoint?.token ?? currentToken;
  if (!base) throw new Error('Not connected to a server.');

  const target = endpoint ?? { url: base, token: token ?? '' };
  const response = await endpointFetch(target, `${base}${approvalPath(sessionId, paneId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(answer),
  });
  if (response.status === 409) await approvalConflict(response);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  const result = paneApprovalAnswerFromResponse(await response.json());
  if (!result) throw new Error('The server did not report the approval state.');
  return result;
}

export function configureGateway(record: GatewayRecord | null): void {
  // Demo mode is a separate, offline code path: while it is on, every function
  // below short-circuits to bundled data and never touches the network.
  setDemoActive(isDemoRecord(record));
  configureApi(
    record?.url ?? '',
    record?.token ?? null,
    record?.deviceId ?? null,
    record?.transportKey ?? null,
    record?.transport === GATEWAY_TRANSPORT ? record.transport : null
  );
}

/**
 * Whether the connected gateway's transport is the encrypted one. An event
 * stream cannot be sealed as one finite response, so an encrypted connection
 * streams sealed records instead -- see {@link encryptedEventStreamRequest}
 * and `sse-record.ts`.
 */
export function gatewayUsesEncryptedTransport(token: string | null): boolean {
  return Boolean(
    token &&
      token === currentToken &&
      currentDeviceId &&
      currentTransportKey &&
      currentTransport === GATEWAY_TRANSPORT
  );
}

/** Everything `use-pane-events` needs to open an encrypted event stream. */
export interface EncryptedStreamRequest {
  /** Sent instead of Authorization: the token travels inside the envelope. */
  headers: Record<string, string>;
  /** The AAD the request was sealed under; every record's AAD begins with it. */
  requestAad: string;
  /** The request envelope's nonce, which the per-stream key derivation binds. */
  requestNonce: string;
  /** The device transport key material the per-stream key derives from. */
  material: Uint8Array;
}

/**
 * Seal the request that opens `/api/sessions/{id}/events` for an encrypted
 * record, and hand back what the stream decryptor needs to open its records.
 *
 * The gateway authenticates this exactly like any other encrypted GET -- the
 * envelope rides `X-Muqun-Envelope`, replay-cached and clock-checked -- but
 * answers with standard SSE whose events are sealed one by one, because a
 * stream that never ends cannot ride the one-envelope response path. Answers
 * null when the connected gateway does not use the encrypted transport.
 */
export function encryptedEventStreamRequest(url: string): EncryptedStreamRequest | null {
  if (
    !currentToken ||
    !currentDeviceId ||
    !currentTransportKey ||
    currentTransport !== GATEWAY_TRANSPORT
  ) {
    return null;
  }
  const aad = requestAad(url, 'GET');
  const material = transportKeyMaterial(currentTransportKey);
  const plaintext: EncryptedRequestPayload = {
    token: currentToken,
    body: base64Url(QuickCrypto.Buffer.alloc(0)),
  };
  const envelope = encryptJson(material, 'request', aad, plaintext);
  return {
    headers: {
      'X-Muqun-Transport': '1',
      'X-Muqun-Device': currentDeviceId,
      'X-Muqun-Envelope': base64Url(
        QuickCrypto.Buffer.from(JSON.stringify(envelope), 'utf8')
      ),
    },
    requestAad: aad,
    requestNonce: envelope.nonce,
    material,
  };
}

/**
 * Whether a JSON value has the shape of a sealed envelope rather than a plain
 * pairing payload. `claimPairing` needs this to tell the two apart: a device
 * pairing manually has no QR key, so it cannot know ahead of time whether the
 * Gateway is going to answer its claim in the clear (`Disabled`) or sealed
 * with the one-time code it just spent (`Required`, see `codeMaterial` below)
 * -- the response is the first place that becomes known.
 */
function looksLikeEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === 'number'
    && typeof record.timestamp_ms === 'number'
    && typeof record.nonce === 'string'
    && typeof record.ciphertext === 'string'
  );
}

/**
 * Pairing talks to an address the user just typed or scanned, which is not yet
 * trusted. It deliberately bypasses the shared client so it cannot repoint the
 * global base URL that in-flight background requests are already using.
 *
 * `codeMaterial` is the manual-pairing counterpart to `transportKey`: a QR's
 * key seals both legs of the exchange, but a typed pairing code is only known
 * once the claim step runs, and only the gateway's response to that one claim
 * is worth sealing (see `codePairingMaterial` and `CODE_PAIRING_CLAIM_AAD`).
 * The request that carries the code stays in the clear either way. Response
 * sealing prevents an accidental plaintext credential response, but it does
 * not make manual pairing over untrusted HTTP resistant to observation: that
 * requires HTTPS, a private encrypted network, or a future PAKE protocol.
 */
async function pairingRequest<T>(
  gatewayUrl: string,
  path: string,
  body: Record<string, unknown>,
  transportKey?: string,
  codeMaterial?: Uint8Array,
  requireCodeEncryption = false
): Promise<T> {
  const aad = `POST ${path}`;
  const material = transportKey ? pairingKeyMaterial(transportKey) : null;
  const requestEnvelope = material
    ? encryptJson(material, 'pairing-request', aad, body)
    : null;
  const response = await gatewayFetch(`${gatewayUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      requestEnvelope ?? body
    ),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const answer = await response.json();
  if (material) {
    return decryptJson<T>(
      material,
      'pairing-response',
      `${aad}\n${requestEnvelope!.nonce}`,
      answer as EncryptedEnvelope
    );
  }
  if (codeMaterial && looksLikeEncryptedEnvelope(answer)) {
    return decryptJson<T>(codeMaterial, 'pairing-response', CODE_PAIRING_CLAIM_AAD, answer);
  }
  if (codeMaterial && requireCodeEncryption) {
    throw new Error('Gateway did not return an encrypted pairing response.');
  }
  return answer as T;
}

export async function requestPairing(
  gatewayUrl: string,
  requestId: string,
  deviceName: string,
  installId?: string,
  transportKey?: string
): Promise<PairingRequestResponse> {
  return pairingRequest(gatewayUrl, '/api/pair/request', {
    request_id: requestId,
    device_name: deviceName,
    ...(installId ? { install_id: installId } : {}),
  }, transportKey);
}

export async function claimPairing(
  gatewayUrl: string,
  requestId: string,
  code: string,
  transportKey?: string,
  codeMaterial?: Uint8Array,
  requireCodeEncryption = false
): Promise<PairingPayload> {
  return pairingRequest(gatewayUrl, '/api/pair/claim', {
    request_id: requestId,
    code,
  }, transportKey, codeMaterial, requireCodeEncryption);
}

/**
 * Ask one server, by name, whether it is there.
 *
 * Deliberately not `loadHealth()`: that one talks to whichever gateway is
 * globally configured, and repointing the shared client to answer a status dot
 * would break whatever else is mid-request. This takes its endpoint as an
 * argument and touches nothing global.
 *
 * It also gets its own, much shorter deadline. Everything else in this file is
 * work the user asked for and is willing to wait on; a status light is not, and
 * a card that spends eight seconds deciding what colour to be has already
 * failed. Anything that is not a clean answer -- refused, timed out, 500,
 * unauthorised -- is reported the same way, as "not answering": the list has no
 * use for the distinction, and every failure resolves to the same grey dot.
 *
 * The one request here that does not go through `fetchWithin`, and it is safe
 * only because it reads no body: `response.ok` is answered by the headers, so
 * there is nothing left on the wire that could stall. Anyone who adds a
 * `.json()` below has to move this onto the budget with the rest of them --
 * clearing an abort timer the moment the headers land is exactly the mistake
 * `request-budget` exists to have stopped making.
 */
export async function probeGatewayReachable(
  endpoint: GatewayEndpoint,
  timeoutMs: number
): Promise<boolean> {
  const base = endpoint.url.replace(/\/$/, '');
  if (!base) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response =
      endpoint.transport === GATEWAY_TRANSPORT && endpoint.deviceId
        ? await encryptedGatewayFetch(
            `${base}/health`,
            { headers: activeLocaleHeaders(), signal: controller.signal },
            timeoutMs,
            endpoint
          )
        : await nitroFetch(`${base}/health`, {
            headers: {
              ...activeLocaleHeaders(),
              ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}),
            },
            signal: controller.signal,
          });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadHealth(): Promise<HealthResponse> {
  const health = isDemoActive()
    ? (demoHealth() as HealthResponse)
    : (await getHealth() as HealthResponse);
  assertSupportedHerdr(health);
  return health;
}

export async function loadSessions(): Promise<SessionsResponse> {
  if (isDemoActive()) return demoSessions() as SessionsResponse;
  return getApiSessions() as Promise<SessionsResponse>;
}

export async function loadWorkspaces(sessionId: string): Promise<HerdrEntity[]> {
  if (isDemoActive()) return demoWorkspaces();
  return normalizeGatewayEntities(await getApiSessionsBySessionIdWorkspaces({ sessionId }), ['workspaces', 'items']);
}

export async function loadTabs(sessionId: string): Promise<HerdrEntity[]> {
  if (isDemoActive()) return demoTabs();
  return normalizeGatewayEntities(await getApiSessionsBySessionIdTabs({ sessionId }), ['tabs', 'items']);
}

export async function loadPanes(sessionId: string): Promise<HerdrEntity[]> {
  if (isDemoActive()) return demoPanes();
  return normalizeGatewayEntities(await getApiSessionsBySessionIdPanes({ sessionId }), ['panes', 'items']);
}

export async function loadAgents(sessionId: string): Promise<HerdrEntity[]> {
  if (isDemoActive()) return demoAgents();
  return normalizeGatewayEntities(await getApiSessionsBySessionIdAgents({ sessionId }), ['agents', 'items']);
}

/**
 * The agent kinds this host will start, for the New Task picker.
 *
 * Raw rather than generated, like the asset and approval endpoints: the spawn
 * family is additive and not in the OpenAPI client yet. Server-wide rather than
 * per-session, because what is installed on a machine is a fact about the
 * machine.
 */
export async function loadAgentProfiles(): Promise<AgentProfile[]> {
  if (isDemoActive()) return agentProfilesFromResponse(demoAgentProfiles());

  const response = await gatewayFetch(gatewayUrl('/api/agents/catalog'), {
    headers: gatewayAuthHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  return agentProfilesFromResponse(await response.json());
}

/**
 * Directories this session has worked in, newest first.
 *
 * An empty list is a perfectly good answer -- a session that has only ever sat
 * in one place has nothing to offer -- so a gateway that does not keep this
 * list is not an error, it is a sheet where the path is typed.
 */
export async function loadRecentCwds(sessionId: string): Promise<string[]> {
  if (isDemoActive()) return recentCwdsFromResponse(demoRecentCwds());

  const response = await gatewayFetch(
    gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/recent-cwds`),
    { headers: gatewayAuthHeaders() }
  );
  // The one endpoint of the three that is allowed to be missing on a gateway
  // that has the other two: it is a convenience, and the manual field below it
  // does the same job.
  if (response.status === 404 || response.status === 501) return [];
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  return recentCwdsFromResponse(await response.json());
}

/**
 * Start an agent, and say which pane it landed in.
 *
 * The refusal path matters as much as the happy one: an agent kind this host
 * does not have, or a directory outside the session's workspaces, comes back as
 * a 4xx whose body names which. That message is carried through verbatim in the
 * thrown error so `describeGatewayFailure` can lift it -- the alternative is a
 * sheet that says "could not start" about three fields at once.
 */
export async function spawnAgent(
  sessionId: string,
  request: AgentSpawnRequest
): Promise<SpawnedAgent> {
  if (isDemoActive()) {
    const spawned = spawnedAgentFromResponse(demoSpawnedAgent(request));
    if (!spawned) throw new Error('The server did not say which panel it made.');
    return spawned;
  }

  const response = await gatewayFetch(
    gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/agents/spawn`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...gatewayAuthHeaders() },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  const spawned = spawnedAgentFromResponse(await response.json());
  // Same rule as `create()` in the quick actions sheet: without a pane id there
  // is nothing to send the phone to, and an empty one clears the terminal
  // instead of opening anything.
  if (!spawned) throw new Error('The server did not say which panel it made.');
  return spawned;
}

/**
 * Stop what one agent is doing.
 *
 * `target` is whatever the gateway names an agent by -- its id, or the pane it
 * runs in. Which agent gets interrupted is the gateway's business; the app's
 * only job is to name the one on screen and not to guess at a keystroke.
 */
export async function interruptAgent(sessionId: string, target: string): Promise<void> {
  if (isDemoActive()) return;

  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(target)}/interrupt`
    ),
    { method: 'POST', headers: gatewayAuthHeaders() }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
}

export async function createWorkspace(
  sessionId: string,
  data: { cwd?: string; label?: string; focus?: boolean }
): Promise<{ workspaceId: string; paneId: string }> {
  if (isDemoActive()) return { workspaceId: 'ws-1', paneId: 'pane-1' };
  const value = await postApiSessionsBySessionIdWorkspaces({ sessionId }, data);
  return createdPaneTarget(value);
}

export async function renameWorkspace(
  sessionId: string,
  workspaceId: string,
  label: string
): Promise<void> {
  if (isDemoActive()) return;
  await patchApiSessionsBySessionIdWorkspacesByWorkspaceId({ sessionId, workspaceId }, { label });
}

export async function deleteWorkspace(sessionId: string, workspaceId: string): Promise<void> {
  if (isDemoActive()) return;
  await deleteApiSessionsBySessionIdWorkspacesByWorkspaceId({ sessionId, workspaceId });
}

export async function focusWorkspace(sessionId: string, workspaceId: string): Promise<void> {
  await postApiSessionsBySessionIdWorkspacesByWorkspaceIdFocus({ sessionId, workspaceId });
}

export async function createTab(
  sessionId: string,
  data: { workspace_id?: string; cwd?: string; label?: string; focus?: boolean }
): Promise<{ workspaceId: string; paneId: string }> {
  if (isDemoActive()) return { workspaceId: 'ws-1', paneId: 'pane-1' };
  const value = await postApiSessionsBySessionIdTabs({ sessionId }, data);
  return createdPaneTarget(value);
}

/**
 * A create call answers with the new container's root pane. Pulling the ids out
 * lets the caller select what it just made instead of guessing from a refresh,
 * which was landing on the old focused workspace.
 */
function createdPaneTarget(value: unknown): { workspaceId: string; paneId: string } {
  const result = (value as { result?: Record<string, unknown> })?.result ?? value;
  const pane =
    (result as { root_pane?: Record<string, unknown>; pane?: Record<string, unknown> })?.root_pane ??
    (result as { pane?: Record<string, unknown> })?.pane ??
    {};
  const paneId = typeof pane.pane_id === 'string' ? pane.pane_id : '';
  const workspaceId = typeof pane.workspace_id === 'string' ? pane.workspace_id : '';
  return { workspaceId, paneId };
}

export async function renameTab(sessionId: string, tabId: string, label: string): Promise<void> {
  if (isDemoActive()) return;
  await patchApiSessionsBySessionIdTabsByTabId({ sessionId, tabId }, { label });
}

export async function deleteTab(sessionId: string, tabId: string): Promise<void> {
  if (isDemoActive()) return;
  await deleteApiSessionsBySessionIdTabsByTabId({ sessionId, tabId });
}

export async function focusTab(sessionId: string, tabId: string): Promise<void> {
  await postApiSessionsBySessionIdTabsByTabIdFocus({ sessionId, tabId });
}

export async function getPane(sessionId: string, paneId: string): Promise<HerdrEntity> {
  return normalizeGatewayEntity(await getApiSessionsBySessionIdPanesByPaneId({ sessionId, paneId }));
}

export async function renamePane(sessionId: string, paneId: string, label: string): Promise<void> {
  if (isDemoActive()) return;
  await patchApiSessionsBySessionIdPanesByPaneId({ sessionId, paneId }, { label });
}

export async function deletePane(sessionId: string, paneId: string): Promise<void> {
  if (isDemoActive()) return;
  await deleteApiSessionsBySessionIdPanesByPaneId({ sessionId, paneId });
}

export async function focusPane(sessionId: string, paneId: string): Promise<void> {
  await postApiSessionsBySessionIdPanesByPaneIdFocus({ sessionId, paneId });
}

export async function splitPane(
  sessionId: string,
  paneId: string,
  data: {
    direction: string;
    ratio?: number;
    command?: string[];
    cwd?: string;
    env?: Record<string, unknown>;
  }
): Promise<{ workspaceId: string; paneId: string }> {
  if (isDemoActive()) return { workspaceId: 'ws-1', paneId: 'pane-1' };
  const value = await postApiSessionsBySessionIdPanesByPaneIdSplit({ sessionId, paneId }, data);
  return createdPaneTarget(value);
}

export async function zoomPane(
  sessionId: string,
  paneId: string,
  mode: 'on' | 'off' | 'toggle' = 'on'
): Promise<unknown> {
  return postApiSessionsBySessionIdPanesByPaneIdZoom({ sessionId, paneId }, { mode });
}

export async function getAgent(sessionId: string, target: string): Promise<HerdrEntity> {
  return normalizeGatewayEntity(await getApiSessionsBySessionIdAgentsByTarget({ sessionId, target }));
}

export async function focusAgent(sessionId: string, target: string): Promise<void> {
  await postApiSessionsBySessionIdAgentsByTargetFocus({ sessionId, target });
}

/**
 * `recent-unwrapped` is scrollback: what the pane has printed. A full-screen
 * program like an editor does not print, it draws, so for those `visible` -- the
 * screen as it stands right now -- is the only source that shows anything.
 */
export type PaneOutputSource = 'recent-unwrapped' | 'visible';

export async function readPaneOutput(
  sessionId: string,
  paneId: string,
  format: 'ansi' | 'text' = 'ansi',
  lines = INITIAL_PANE_OUTPUT_LINES,
  source: PaneOutputSource = 'recent-unwrapped'
): Promise<string> {
  if (isDemoActive()) return demoPaneOutput(paneId, lines);
  const lineLimit = Math.max(1, Math.min(MAX_PANE_OUTPUT_LINES, Math.round(lines)));
  const value = await getApiSessionsBySessionIdPanesByPaneIdOutput(
    { sessionId, paneId },
    { source, lines: String(lineLimit), format }
  );
  return extractPaneOutput(value);
}

function extractPaneOutput(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || depth > 4) {
    return JSON.stringify(value, null, 2) ?? String(value ?? '');
  }

  const response = value as PaneOutputResponse & Record<string, unknown>;
  if (typeof response.text === 'string') return response.text;
  if (typeof response.output === 'string') return response.output;
  if (typeof response.content === 'string') return response.content;
  if (Array.isArray(response.lines)) return response.lines.join('\n');
  for (const key of ['read', 'result', 'data']) {
    if (response[key] !== undefined) return extractPaneOutput(response[key], depth + 1);
  }
  return JSON.stringify(value, null, 2);
}

/**
 * The innermost `read` object of a pane-output response -- the same envelope
 * {@link extractPaneOutput} pulls its string out of, kept whole instead so a
 * `range` riding alongside `output` survives to the caller. Mirrors
 * `extractPaneOutput`'s own walk (`text`/`output`/`content`/`lines`, then
 * unwrap `read`/`result`/`data` and try again) so the two never disagree about
 * which object in the envelope is "the read". `undefined` wherever that walk
 * finds nothing read-shaped, which `paneReadRange` already treats as "no
 * range" -- a gateway or pane that never sends one costs nothing extra here.
 */
function extractPaneReadEnvelope(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const response = value as PaneOutputResponse & Record<string, unknown>;
  if (
    typeof response.text === 'string'
    || typeof response.output === 'string'
    || typeof response.content === 'string'
    || Array.isArray(response.lines)
  ) {
    return response;
  }
  for (const key of ['read', 'result', 'data']) {
    if (response[key] !== undefined) {
      const found = extractPaneReadEnvelope(response[key], depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** What a pane-output read hands back: the text, and the envelope it rode in
 * on so a caller paging by range can see its `range` (via {@link
 * paneReadRange}) without a second request. */
export interface PaneOutputRead {
  output: string;
  read: unknown;
}

/**
 * The widening-tail read, byte-for-byte the same request {@link
 * readPaneOutput} already makes -- same query shape, same clamping -- just
 * handing back the response's `read` envelope alongside the text. A pane or
 * gateway that never sends a `range` (herdr, and anything older than range
 * addressing) hands back `read` with no `range` on it, which is exactly what
 * it does today; nothing about the request or the response changes for them.
 */
export async function readPaneTail(
  sessionId: string,
  paneId: string,
  format: 'ansi' | 'text' = 'ansi',
  lines = INITIAL_PANE_OUTPUT_LINES,
  source: PaneOutputSource = 'recent-unwrapped'
): Promise<PaneOutputRead> {
  if (isDemoActive()) return { output: demoPaneOutput(paneId, lines), read: null };
  const lineLimit = Math.max(1, Math.min(MAX_PANE_OUTPUT_LINES, Math.round(lines)));
  const value = await getApiSessionsBySessionIdPanesByPaneIdOutput(
    { sessionId, paneId },
    { source, lines: String(lineLimit), format }
  );
  return { output: extractPaneOutput(value), read: extractPaneReadEnvelope(value) };
}

/**
 * The range-addressed read: `start`/`end` in place of `lines`, so the page
 * costs its own rows rather than the whole tail beneath it. The gateway wants
 * `start` and `end` together with `start < end`
 * (`muqun-gateway::validate_output_range`), which {@link nextPageRange}
 * already guarantees for every range it hands back.
 */
export async function readPaneRange(
  sessionId: string,
  paneId: string,
  start: number,
  end: number,
  format: 'ansi' | 'text' = 'ansi',
  source: PaneOutputSource = 'recent-unwrapped'
): Promise<PaneOutputRead> {
  if (isDemoActive()) return demoPaneRange(paneId, start, end);
  const value = await getApiSessionsBySessionIdPanesByPaneIdOutput(
    { sessionId, paneId },
    {
      source,
      format,
      start: String(Math.max(0, Math.round(start))),
      end: String(Math.max(0, Math.round(end))),
    }
  );
  return { output: extractPaneOutput(value), read: extractPaneReadEnvelope(value) };
}

/**
 * The key row and slash commands for whatever this pane is running, resolved by
 * the gateway. Keeping the table on the gateway means a newly supported agent
 * arrives with a gateway update rather than an app release.
 */
export async function loadPaneShortcuts(
  sessionId: string,
  paneId: string
): Promise<PaneShortcuts> {
  if (isDemoActive()) return demoShortcuts(paneId) as PaneShortcuts;
  const value = (await getApiSessionsBySessionIdPanesByPaneIdShortcuts({
    sessionId,
    paneId,
  })) as Partial<PaneShortcuts>;
  return {
    version: typeof value?.version === 'number' ? value.version : 0,
    profile: typeof value?.profile === 'string' ? value.profile : 'shell',
    keys: Array.isArray(value?.keys) ? value.keys.filter(isShortcutKey) : [],
    commands: Array.isArray(value?.commands) ? value.commands.filter(isSlashCommand) : [],
  };
}

function isShortcutKey(value: unknown): value is ShortcutKey {
  const entry = value as ShortcutKey | undefined;
  return Boolean(entry) && typeof entry?.key === 'string' && typeof entry?.label === 'string';
}

function isSlashCommand(value: unknown): value is SlashCommand {
  const entry = value as SlashCommand | undefined;
  return Boolean(entry) && typeof entry?.command === 'string';
}

export async function sendPaneText(sessionId: string, paneId: string, text: string): Promise<void> {
  if (isDemoActive()) return;
  await postApiSessionsBySessionIdPanesByPaneIdSendText({ sessionId, paneId }, { text });
}

export async function sendPaneKeys(sessionId: string, paneId: string, keys: string[]): Promise<void> {
  if (isDemoActive()) return;
  await postApiSessionsBySessionIdPanesByPaneIdSendKeys({ sessionId, paneId }, { keys });
}

export async function sendAgentText(sessionId: string, target: string, text: string): Promise<void> {
  if (isDemoActive()) return;
  await postApiSessionsBySessionIdAgentsByTargetSend({ sessionId, target }, { text });
}

export interface PairedDevice {
  id: string;
  name: string;
  paired_unix_ms: number;
  last_seen_unix_ms: number;
  /** True for the device making the request, which must not revoke itself by accident. */
  current: boolean;
}

export async function loadPairedDevices(): Promise<PairedDevice[]> {
  if (isDemoActive()) return [];
  const value = (await getApiPairings()) as { devices?: PairedDevice[] };
  return Array.isArray(value?.devices) ? value.devices : [];
}

export async function revokePairedDevice(deviceId: string): Promise<void> {
  await deleteApiPairingsByDeviceId({ deviceId });
}

/**
 * Revoke this installation from a stored gateway before its local credential
 * is deleted. This request is scoped to the supplied record instead of the
 * globally selected gateway, so Home can unpair any saved server safely.
 */
export async function revokeOwnGatewayPairing(record: GatewayRecord): Promise<void> {
  const baseUrl = record.url.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${record.token}` };
  const endpoint: GatewayEndpoint = {
    url: record.url,
    token: record.token,
    deviceId: record.deviceId,
    transportKey: record.transportKey,
    transport: record.transport,
  };
  const listResponse = await endpointFetch(endpoint, `${baseUrl}/api/pairings`, { headers });
  if (!listResponse.ok) {
    throw new Error(`HTTP ${listResponse.status}: ${await listResponse.text()}`);
  }

  const value = (await listResponse.json()) as { devices?: PairedDevice[] };
  const currentDevice = value.devices?.find((device) => device.current);
  if (!currentDevice) {
    throw new Error('Gateway did not identify this paired device.');
  }

  const revokeResponse = await endpointFetch(
    endpoint,
    `${baseUrl}/api/pairings/${encodeURIComponent(currentDevice.id)}`,
    { method: 'DELETE', headers }
  );
  if (!revokeResponse.ok) {
    throw new Error(`HTTP ${revokeResponse.status}: ${await revokeResponse.text()}`);
  }
}

export async function registerDevicePushToken(data: DevicePushTokenRegistration): Promise<void> {
  if (isDemoActive()) return;
  await postApiDevicesPushToken(data);
}

export async function unregisterDevicePushToken(token: string): Promise<void> {
  await deleteApiDevicesPushToken({ token });
}

export async function sendTestNotification(data: TestNotificationRequest = {}): Promise<void> {
  await postApiNotificationsTest(data);
}

export const gatewayTransport: GatewayTransport = {
  loadHealth,
  loadSessions,
  loadWorkspaces,
  loadTabs,
  loadPanes,
  loadAgents,
};
