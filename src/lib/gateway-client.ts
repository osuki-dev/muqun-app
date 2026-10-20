import { protectTemporaryCacheEntry } from './cache-cleanup';
import { nativeImageCache } from './native-image-cache';
import { parseGitWorktrees, type GitWorktreeInventory } from './git-worktrees';
import * as TransportSecureStore from 'expo-secure-store';
import { TransportNegotiation, type TransportVersion } from './transport-negotiation';
import { AudioPlaybackError } from '@/lib/audio-playback-session';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { isHostPathSource } from './message-images';
import { fetch as nitroFetch, Response as NitroResponse } from 'react-native-nitro-fetch';
import QuickCrypto from 'react-native-quick-crypto';
import { assertDeliveryCurrent, deliverPasteAndEnter } from './bound-delivery';

import {
  configure,
  deleteApiSessionsBySessionIdPanesByPaneId,
  deleteApiSessionsBySessionIdTabsByTabId,
  deleteApiPairingsByDeviceId,
  deleteApiSessionsBySessionIdWorkspacesByWorkspaceId,
  getApiPairings,
  getApiSessionsBySessionIdAgents,
  getApiSessionsBySessionIdAgentsByTarget,
  getApiSessionsBySessionIdPanes,
  getApiSessionsBySessionIdSnapshot,
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
import type { CapturedHistoryPage, CapturedHistoryRead } from './terminal-history-pull';
import {
  CAPTURED_HISTORY_PAGE_ROWS,
  parseCapturedSegmentsPage,
  type CapturedSegmentsRead,
} from './terminal-history-segments';
import {
  answerHasNoBody,
  headerRecord,
  isStreamingRequest,
  startRequestBudget,
  withBodyDeadline,
} from './request-budget';
import {
  normalizeGatewayEntities,
  normalizeGatewayEntity,
  type GatewayEntity,
} from './gateway-entities';
import {
  GatewayTransportRefusalError,
  retryReplayedRead,
  classifyTransportRefusal,
} from './gateway-refusal';
import {
  bearerLeavesGateway,
  CLEARTEXT_TOKEN_REFUSAL,
  endpointCredentialRoute,
} from './gateway-request-policy';
import {
  decodeSealedBody,
  ENVELOPE_ACCEPT_ENCODINGS,
  ENVELOPE_ACCEPT_HEADER,
} from './envelope-encoding';
import {
  encodeMultipart,
  multipartBoundary,
  multipartContentType,
  utf8Bytes,
  type MultipartPart,
} from './multipart';
import {
  assertAssetGateway,
  assetFromUploadedPdf,
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
import { NO_GATEWAY_CAPABILITIES, panePartsFromResponse, type PaneParts } from './pane-parts';
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
  parseAgentVcsDiscard,
  parseAgentVcsFilePatch,
  parseAgentVcsFiles,
  type AgentVcsDiscard,
  type AgentVcsFilePatch,
  type AgentVcsFiles,
  type VcsFilesMode,
} from './agent-protocol';
// Re-exported further down as well; `export … from` binds nothing in this
// module, and the three loaders below parse their answers with these.
import {
  DIFF_CONTEXT_LINES,
  FILE_PATCH_MAX_LINES,
  gitDiffPageFromResponse,
  gitStatusFromResponse,
  paneContextFromResponse,
  type GitFilePatchPage,
  type GitStatus,
  type PaneContext,
} from './git-diff';
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
  demoGitDiff,
  demoGitStatus,
  demoGitWorktrees,
  demoSendAgentText,
  demoAssetContentUri,
  demoAudioBytes,
  demoAssetText,
  demoHealth,
  demoPanes,
  demoPaneContext,
  demoPaneFiles,
  demoPaneOutput,
  demoPaneRange,
  demoPaneParts,
  demoRecentCwds,
  demoSessionAssets,
  demoSessions,
  demoSpawnedAgent,
  demoShortcuts,
  demoLaunchLazygit,
  demoTabs,
  demoWorkspaces,
  isDemoActive,
  isDemoRecord,
  setDemoActive,
} from './demo-gateway';
import type { GatewayRecord } from './gateway-storage';
import { demoCapturedHistory } from './demo-captured-history';
import { withSessionAvailability } from './session-switcher';
import { validatePairingTransport, type PairingPayload } from './pairing';
import {
  CODE_PAIRING_CLAIM_AAD,
  GATEWAY_TRANSPORT,
  decryptJson,
  encryptJson,
  pairingKeyMaterial,
  transportKeyMaterial,
  type EncryptedEnvelope,
} from './gateway-transport';
import { dedupeKey, withRequestDedupe } from '@/lib/request-dedupe';
import {
  endpointIsAbsent,
  sessionSnapshotFromAnswer,
  snapshotServesAgents,
  type SessionSnapshot,
} from '@/lib/session-snapshot';
import { assertSupportedHerdr } from './herdr-compatibility';
import { GatewayTunnelUnavailableError, directGatewayBaseUrl } from './ssh-tunnel';
import { MAX_ASSET_TEXT_BYTES } from './text-preview';
import { noteGatewayGeneration } from '@/stores/gateway-connection-generation';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { copyCachedOriginalImageFile, downloadOriginalImageFile } from './image-original-file';
import {
  IMAGE_RANGE_BYTES,
  readLimitedImageBody,
  assertImageEnvelopeLimit,
  fetchBoundedImageResponse,
  readOriginalImageVersion,
  IMAGE_VERSION_BYTES,
} from './image-original-ranges';
import type { MessageImageAsset } from './message-images';
import {
  gatewayImagePlan,
  IMAGE_PREVIEWS_CAPABILITY,
  readOriginalFirst,
  readThumbnailOnly,
  type PreviewImageDescriptor,
  type PreviewImageSource,
} from './gateway-image-previews';

// Remote gateways may need time to establish a tunnel and answer an agent read.
// Allow a full minute before reporting that the gateway did not answer.
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * A write that starts or steers an agent turn -- creating a session, a
 * prompt, a command -- waits on the agent, not on a lookup: OpenCode has to
 * load the workspace or finish accepting the message before the gateway can
 * answer. Cut off at the read budget, the app gave up on a prompt the gateway
 * then delivered, and a retry sent it twice.
 */
const AGENT_WRITE_TIMEOUT_MS = 60_000;
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

/** Installed nitroFetch buffers unless stream:true; that streaming client ignores
 * redirect:error. Existing Expo fetch streams AND refuses redirects on iOS/Android. */
async function fetchImageWithin(
  timeoutMs: number,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  return fetchBoundedImageResponse(expoFetch, requestUrl(input), init, timeoutMs);
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
  /**
   * Set when the gateway took up `X-Muqun-Envelope-Accept` and compressed the
   * body before sealing it. Optional in both directions; see
   * `envelope-encoding`, which also reads the header-map spellings of it.
   */
  content_encoding?: string;
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

export function isGatewayEncryptionDisabled(): boolean {
  if (!__DEV__) return false;
  return (
    process.env.EXPO_PUBLIC_DISABLE_GATEWAY_ENCRYPTION === 'true' ||
    process.env.EXPO_PUBLIC_DISABLE_GATEWAY_ENCRYPTION === '1'
  );
}

function shouldEncryptGatewayRequest(input: RequestInfo | URL): boolean {
  if (isGatewayEncryptionDisabled()) return false;
  if (
    !currentToken ||
    !currentDeviceId ||
    !currentTransportKey ||
    currentTransport !== GATEWAY_TRANSPORT
  )
    return false;
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
  endpoint?: GatewayEndpoint,
  isCurrent: () => boolean = () => true,
  readLimit?: number
): Promise<Response> {
  const started = Date.now();
  const method = (
    init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
  ).toUpperCase();
  const capturedEndpoint = endpoint ?? {
    url: currentBaseUrl,
    token: currentToken ?? '',
    deviceId: currentDeviceId ?? undefined,
    transportKey: currentTransportKey ?? undefined,
  };
  return retryReplayedRead(method, () =>
    sendEncryptedGatewayRequest(
      input,
      { ...init, method },
      Math.max(1, timeoutMs - (Date.now() - started)),
      capturedEndpoint,
      isCurrent,
      undefined,
      readLimit
    )
  );
}

const transportNegotiation = new TransportNegotiation();

function transportPinIdentity(deviceId: string, transportKey: string): string {
  return `muqun.transport-min.${QuickCrypto.createHash('sha256')
    .update(JSON.stringify([deviceId, transportKey]))
    .digest('hex')}`;
}

async function negotiatedTransportVersion(
  endpoint: GatewayEndpoint,
  timeoutMs = REQUEST_TIMEOUT_MS,
  isCurrent: () => boolean = () => true
): Promise<TransportVersion> {
  if (!endpoint.deviceId || !endpoint.transportKey)
    throw new Error('Missing Gateway encryption credentials.');
  const identity = transportPinIdentity(endpoint.deviceId, endpoint.transportKey);
  const started = Date.now();
  return transportNegotiation.version(identity, {
    requiresV2: (error) =>
      error instanceof GatewayTransportRefusalError &&
      error.status === 426 &&
      classifyTransportRefusal(error.status, error.body).code === 'transport_version_required',
    readPin: (key) => TransportSecureStore.getItemAsync(key),
    writePin: (key) =>
      TransportSecureStore.setItemAsync(key, '2', {
        keychainAccessible: TransportSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    probe: async (version) => {
      assertDeliveryCurrent(isCurrent);
      const response = await sendEncryptedGatewayRequest(
        `${endpoint.url.replace(/\/$/, '')}/health`,
        { method: 'GET' },
        Math.max(1, timeoutMs - (Date.now() - started)),
        endpoint,
        isCurrent,
        version
      );
      if (!response.ok)
        throw new Error(`Gateway transport negotiation failed: HTTP ${response.status}`);
      return response.json();
    },
  });
}

async function sendEncryptedGatewayRequest(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  endpoint?: GatewayEndpoint,
  isCurrent: () => boolean = () => true,
  negotiatedVersion?: TransportVersion,
  readLimit?: number
): Promise<Response> {
  const requestStarted = Date.now();
  const token = endpoint ? endpoint.token : currentToken;
  const deviceId = endpoint ? endpoint.deviceId : currentDeviceId;
  const transportKey = endpoint ? endpoint.transportKey : currentTransportKey;
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
  assertDeliveryCurrent(isCurrent);
  const plaintext: EncryptedRequestPayload = {
    token,
    ...(serialized.contentType ? { content_type: serialized.contentType } : {}),
    body: base64Url(serialized.bytes),
  };
  const material = transportKeyMaterial(transportKey);
  const version =
    negotiatedVersion ??
    (await negotiatedTransportVersion(
      endpoint ?? { url: currentBaseUrl, token, deviceId, transportKey },
      timeoutMs,
      isCurrent
    ));
  assertDeliveryCurrent(isCurrent);
  const envelope = encryptJson(material, 'request', aad, plaintext, version);
  const envelopeJson = JSON.stringify(envelope);
  const bodylessMethod = method === 'GET' || method === 'HEAD';
  const outerHeaders = { ...headers };
  for (const name of Object.keys(outerHeaders)) {
    if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'content-type') {
      delete outerHeaders[name];
    }
  }
  const response = await (readLimit === undefined
    ? fetchWithin(
        Math.max(1, timeoutMs - (Date.now() - requestStarted)),
        'Timed out waiting for the server.',
        input,
        {
          ...init,
          method,
          headers: {
            ...outerHeaders,
            'Content-Type': 'application/json',
            'X-Muqun-Transport': '1',
            'X-Muqun-Device': deviceId,
            // Compression cannot happen outside the envelope -- the body on the wire
            // is ciphertext, and ciphertext does not compress -- so it is offered
            // for the inside of it. A gateway that has never heard of this header
            // answers exactly as it always did. Deliberately not `Accept-Encoding`:
            // Cronet and NSURLSession own that one and decompress transparently, and
            // setting it by hand is how an app ends up holding a body the platform
            // has stopped decoding for it.
            [ENVELOPE_ACCEPT_HEADER]:
              readLimit === undefined ? ENVELOPE_ACCEPT_ENCODINGS : 'identity',
            ...(bodylessMethod
              ? { 'X-Muqun-Envelope': base64Url(QuickCrypto.Buffer.from(envelopeJson, 'utf8')) }
              : {}),
          },
          body: bodylessMethod ? undefined : envelopeJson,
        }
      )
    : fetchImageWithin(Math.max(1, timeoutMs - (Date.now() - requestStarted)), input, {
        ...init,
        method,
        headers: {
          ...outerHeaders,
          'Content-Type': 'application/json',
          'X-Muqun-Transport': '1',
          'X-Muqun-Device': deviceId,
          [ENVELOPE_ACCEPT_HEADER]: 'identity',
          ...(bodylessMethod
            ? { 'X-Muqun-Envelope': base64Url(QuickCrypto.Buffer.from(envelopeJson, 'utf8')) }
            : {}),
        },
        body: bodylessMethod ? undefined : envelopeJson,
      }));
  const limitedBody =
    readLimit === undefined
      ? null
      : await readLimitedImageBody(response, readLimit * 2 + 64 * 1024, init.signal ?? undefined);
  const limitedText = limitedBody ? QuickCrypto.Buffer.from(limitedBody).toString('utf8') : null;
  if (response.headers.get('x-muqun-transport') !== '1') {
    // Not a mystery, and not a transport fault. The gateway's middleware seals
    // a response only once the request has authenticated, so every refusal on
    // the way there -- unknown device, dead token, missing transport key,
    // unknown host -- arrives here in plaintext with the reason in the body.
    // Reading it is the whole difference between telling someone this server no
    // longer knows their device and telling them an encryption marker was
    // missing. `GatewayTransportRefusalError` carries status and body through to
    // `describeGatewayFailure`, which decides what that reason means.
    const refusalBody = limitedText ?? (await response.text().catch(() => ''));
    noteRefusal({ url: requestUrl(input), token: token ?? '' }, response.status, refusalBody);
    throw new GatewayTransportRefusalError(response.status, refusalBody);
  }
  const sealed = (
    limitedText === null ? await response.json() : JSON.parse(limitedText)
  ) as EncryptedEnvelope;
  const payload = decryptJson<EncryptedResponsePayload>(
    material,
    'response',
    `${aad}\n${envelope.nonce}`,
    sealed,
    version
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
  if (readLimit !== undefined) {
    assertImageEnvelopeLimit(payload, readLimit);
  }
  // Inflated before the response is rebuilt, so every caller above reads the
  // body the gateway meant to send and no one downstream has to know whether
  // this connection compressed anything. `headers` comes back describing the
  // bytes that come back with it.
  const { bytes, headers: answerHeaders } = decodeSealedBody(fromBase64Url(payload.body), payload);
  if (readLimit !== undefined && bytes.length > readLimit)
    throw new Error('Encrypted image response exceeds the read limit');
  // Opened with this device's key: the gateway knows this device, whatever
  // the status inside says.
  noteAccepted({ url: requestUrl(input), token: token ?? '' });
  const noBody = answerHasNoBody(method, payload.status);
  // Use the same response implementation as the request transport. React
  // Native's global Response treats a QuickCrypto Buffer as a string-like body
  // on Android, decoding each UTF-8 byte as one character ("⏺" became
  // "â…"). NitroResponse recognises ArrayBuffer views and preserves both JSON
  // UTF-8 and binary asset bodies.
  return new NitroResponse(noBody ? null : (bytes as unknown as BodyInit), {
    status: payload.status,
    headers: answerHeaders,
  }) as unknown as Response;
}

/**
 * Told what every gateway said about the token a request carried: a refusal
 * (401/403/426, with the plaintext body the reason is in) or an acceptance
 * (an answer that took the token -- a sealed response that opened, a 2xx on
 * a route that needed it). Installed by `stores/pairing-faults`, which maps
 * the token back to the record and remembers, or forgets, what the computer
 * said; the client does not know records, only endpoints.
 */
export interface GatewayAuthObserver {
  refused(endpoint: { url: string; token: string }, status: number, body: string): void;
  accepted(endpoint: { url: string; token: string }): void;
}

let authObserver: GatewayAuthObserver | null = null;

export function setGatewayAuthObserver(observer: GatewayAuthObserver | null): void {
  authObserver = observer;
}

/** The statuses a gateway refuses a pairing with; everything else is not about the pairing. */
const PAIRING_REFUSAL_STATUSES = new Set([401, 403, 426]);

function noteRefusal(endpoint: { url: string; token: string }, status: number, body: string) {
  if (!authObserver || !PAIRING_REFUSAL_STATUSES.has(status) || !endpoint.token) return;
  try {
    authObserver.refused(endpoint, status, body);
  } catch {
    // An observer that throws must not turn a refusal into a different error.
  }
}

/** The gateway took this token: whatever was held against its pairing is disproved. */
function noteAccepted(endpoint: { url: string; token: string }) {
  if (!authObserver || !endpoint.token) return;
  try {
    authObserver.accepted(endpoint);
  } catch {
    // Likewise: bookkeeping never changes the answer.
  }
}

/**
 * Report a plaintext refusal without consuming the answer the caller is
 * about to read. Only the pairing statuses pay for the clone; a body that
 * will not clone is reported by status alone.
 */
async function noteRefusedResponse(
  endpoint: { url: string; token: string },
  response: Response
): Promise<void> {
  if (!authObserver) return;
  if (response.ok) {
    noteAccepted(endpoint);
    return;
  }
  if (!PAIRING_REFUSAL_STATUSES.has(response.status)) return;
  let body = '';
  try {
    body = await response.clone().text();
  } catch {
    body = '';
  }
  noteRefusal(endpoint, response.status, body);
}

/** The bearer token a header record carries, or the empty string. */
function bearerOf(headers: Readonly<Record<string, string>>): string {
  const name = Object.keys(headers).find((key) => key.toLowerCase() === 'authorization');
  const value = name ? headers[name] : '';
  return value.replace(/^Bearer\s+/i, '');
}

/** Every gateway call the generated client and this file make, on one budget. */
export const gatewayFetch: typeof globalThis.fetch = (input, init) =>
  gatewayFetchWithin(REQUEST_TIMEOUT_MS, input, init);

/** A write that waits on the agent itself; see `AGENT_WRITE_TIMEOUT_MS`. */
export const gatewayWriteFetch: typeof globalThis.fetch = (input, init) =>
  gatewayFetchWithin(AGENT_WRITE_TIMEOUT_MS, input, init);

/**
 * Identical GETs that are out right now, so a second asker joins rather than
 * asks again. Emptied as each settles -- this is not a cache; see
 * `lib/request-dedupe`.
 */
const inFlightGets = new Map<string, Promise<Response>>();

/** Test seam: the map is process-wide, so suites must be able to reset it. */
export function forgetInFlightGets(): void {
  inFlightGets.clear();
}

/**
 * The narrowest useful place for the dedupe: below every caller, above the
 * transport.
 *
 * Both the generated client and every raw call in this file come through here,
 * and neither knows what the other is doing -- which is the whole reason two
 * screens can ask one gateway the same question twice in the same frame. Doing
 * it here rather than in `api/http-request` also keeps the generated file
 * generated.
 *
 * The key is built before the locale and the token are merged in, because those
 * are module state and so identical for two calls that overlap in time. What a
 * caller passed for itself *is* in the key.
 */
/**
 * How a request may carry credentials beyond the defaults.
 *
 * `plainRecord` is the explicit route for a stored record that has no
 * transport key: the caller named the record, put its bearer token on the
 * request itself, and the request goes out in the clear to that record's
 * origin. The configured gateway's own token is never merged in on this route
 * -- the request is not for the configured gateway -- and the foreign-origin
 * refusal below does not apply, because this is the one route that is allowed
 * to cross it. See `lib/gateway-request-policy`.
 */
interface RequestPolicy {
  plainRecord?: boolean;
}

function gatewayFetchWithin(
  timeoutMs: number,
  input: RequestInfo | URL,
  init?: RequestInit,
  policy?: RequestPolicy
): Promise<Response> {
  return withRequestDedupe(inFlightGets, dedupeKey(input, init, timeoutMs), () =>
    sendGatewayRequest(timeoutMs, input, init, policy)
  );
}

async function sendGatewayRequest(
  timeoutMs: number,
  input: RequestInfo | URL,
  init?: RequestInit,
  policy?: RequestPolicy
): Promise<Response> {
  // The one place worth stamping the locale, because both the generated client
  // and every raw call in this file come through here. Merged underneath the
  // caller's own headers rather than over them, so a request that has a reason
  // to ask for a different language keeps it -- and read per call rather than
  // captured once, so switching language in Settings takes effect on the very
  // next request without reconfiguring anything.
  const headers = {
    ...activeLocaleHeaders(),
    ...(currentToken && !policy?.plainRecord ? { Authorization: `Bearer ${currentToken}` } : {}),
    ...headerRecord(init?.headers),
  };
  if (shouldEncryptGatewayRequest(input)) {
    return encryptedGatewayFetch(input, { ...init, headers }, timeoutMs);
  }
  // Not sealed, so about to go out in the clear. A bearer token addressed to
  // any origin but the configured gateway's is refused here unless the caller
  // took the explicit plain route for a record that has nothing to seal with
  // (`gatewayEndpointFetch`). This is the guard against the bug it replaced:
  // a stored record's catalog read that sent that record's token unsealed
  // because the record was not the one selected.
  if (!policy?.plainRecord && bearerLeavesGateway(requestUrl(input), currentBaseUrl, headers)) {
    throw new Error(CLEARTEXT_TOKEN_REFUSAL);
  }

  // Exempt, and deliberately: see `isStreamingRequest`.
  const response = isStreamingRequest(init)
    ? await nitroFetch(input, { ...init, headers })
    : // "Timed out" is load-bearing, not phrasing. `describeGatewayFailure` reads
      // these messages to decide what kind of failure this was, and a deadline that
      // does not say so is filed as a plain request error: shown to the user
      // verbatim, in English, and marked not worth retrying -- which is the wrong
      // answer on all three counts for a server that simply went quiet.
      await fetchWithin(timeoutMs, 'Timed out waiting for the server.', input, {
        ...init,
        headers,
      });
  await noteRefusedResponse({ url: requestUrl(input), token: bearerOf(headers) }, response);
  return response;
}

export interface HealthResponse {
  ok: boolean;
  gatewayVersion: string;
  apiVersion?: string;
  apiMajor?: number;
  minimumCompatibleApiVersion?: string;
  legacyUnversionedApi?: boolean;
  transport_versions?: number[];
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
    sessionId?: string;
    kind?: string;
    connected?: boolean;
    version?: string | null;
    protocol?: number | null;
    /** See `backends[].capabilities`; this is the same key for this session. */
    capabilities?: string[];
  };
  backends?: {
    sessionId: string;
    kind: string;
    connected: boolean;
    version?: string | null;
    /**
     * What this *session* offers, as opposed to what the gateway build
     * implements. A capability that depends on the terminal on the other side
     * lives here -- `agent_collaboration` is the only one so far.
     *
     * Optional because it is not optional on the gateway: a gateway that has
     * the field always sends it, empty included, so `undefined` means a gateway
     * older than the field and never "this session offers nothing". Readers
     * must tell those two apart; see `collaborationAvailability`.
     */
    capabilities?: string[];
  }[];
}

export interface SessionsResponse {
  sessions?: {
    connected?: boolean;
    id: string;
    label: string;
    socket_path: string;
    /**
     * Which terminal system this session runs on -- `tmux`, `herdr`, or
     * whatever a later gateway grows. Omitted for a Herdr session, which is the
     * default every pre-tmux config is written as, so absent means `herdr`
     * rather than unknown.
     */
    backend?: string;
  }[];
}

export type HerdrEntity = GatewayEntity;

export interface ShortcutKey {
  label: string;
  key: string;
  description?: string;
  keys?: string[];
  text?: string;
  submit?: boolean;
}

export interface SlashCommand {
  command: string;
  description?: string;
  /**
   * What may follow the command, e.g. "[instructions]". Null means the command
   * runs exactly as written, so it is safe to send on a single tap.
   */
  argument_hint?: string | null;
  /** "catalog" for the downloaded built-in command snapshot. */
  source?: string;
}

export interface PaneShortcuts {
  version: number;
  /** Which table the gateway matched: an agent name, "editor", or "shell". */
  profile: string;
  keys: ShortcutKey[];
  /** Optional multi-key and text actions; older Gateways omit this. */
  keyActions?: ShortcutKey[];
  commands: SlashCommand[];
  /**
   * What this pane can take right now: `extended` is false when the program in
   * a tmux pane has not asked for extended keys, so `ctrl+enter` and the like
   * cannot reach it. Older Gateways omit this, which narrows nothing.
   */
  keyboard?: { extended: boolean };
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
  loadSessionSnapshot: (
    sessionId: string,
    health: HealthResponse | null | undefined
  ) => Promise<SessionSnapshot | null>;
  loadWorkspaces: (sessionId: string) => Promise<HerdrEntity[]>;
  loadTabs: (sessionId: string) => Promise<HerdrEntity[]>;
  loadPanes: (sessionId: string) => Promise<HerdrEntity[]>;
  loadAgents: (sessionId: string) => Promise<HerdrEntity[]>;
}

/**
 * The three lists that describe a session's shape, in one answer.
 *
 * Agents are deliberately not among them even though the endpoint returns a
 * set: see `loadSessionSnapshot`.
 */
export type { SessionSnapshot } from '@/lib/session-snapshot';

export interface DevicePushTokenRegistration {
  token: string;
  platform: 'ios' | 'android';
  device_name?: string;
  /** The language the gateway writes this device's notifications in. */
  locale?: string;
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
  transport_encryption?: 'required' | 'disabled';
}

// Kept alongside the generated client's config so raw requests to endpoints the
// codegen doesn't know about (e.g. PATCH /api/meta) can reuse the same base+token.
let currentBaseUrl = '';
let currentToken: string | null = null;
/**
 * The record the client is currently configured for, kept so the base URL can
 * be recomputed when a tunnel opens or closes without a re-pair.
 */
let currentRecord: GatewayRecord | null = null;

/**
 * The one seam a tunnelled record needs. `stores/ssh-tunnels.ts` installs this
 * resolver: for a record whose gateway is reached through an SSH host it
 * returns the live `http://127.0.0.1:<localPort>` while the forward is open, or
 * null when it is not yet up. A direct record ignores it. The client is not
 * forked -- only its base URL is resolved through here, and because the request
 * AAD is path-only (see `requestAad`), repointing the origin to the loopback
 * forward is transparent to the gateway and keeps the encrypted transport
 * intact.
 */
let tunnelBaseUrlResolver: ((record: GatewayRecord) => string | null) | null = null;

export function setGatewayTunnelResolver(
  resolver: ((record: GatewayRecord) => string | null) | null
): void {
  tunnelBaseUrlResolver = resolver;
}

/**
 * A held-open tunnel for one request against a record that is *not* the
 * selected one.
 *
 * {@link setGatewayTunnelResolver} answers "where is this record's forward
 * right now", which is all the selected server needs: a screen is already
 * holding its tunnel up. Unpairing is the other shape -- Home can unpair any
 * saved server, including one no screen has open -- so it needs the forward
 * brought up for the duration of the call and dropped afterwards. The opener is
 * installed by `stores/ssh-tunnels.ts`; `release()` is the matching hold
 * release and must run whether the request succeeded or threw.
 */
export interface GatewayTunnelSession {
  baseUrl: string;
  release: () => void;
}

let tunnelSessionOpener: ((record: GatewayRecord) => Promise<GatewayTunnelSession>) | null = null;

export function setGatewayTunnelSessionOpener(
  opener: ((record: GatewayRecord) => Promise<GatewayTunnelSession>) | null
): void {
  tunnelSessionOpener = opener;
}

/**
 * Run `body` against the address a *stored* record is actually reachable at,
 * holding its SSH forward open for the duration when it is tunnelled.
 *
 * There is deliberately no fallback to `record.url` for a tunnelled record: see
 * {@link GatewayTunnelUnavailableError}. Sending a bearer token to the phone's
 * own loopback because a forward would not open is exactly the leak this
 * feature's threat model is written against.
 */
async function withRecordBaseUrl<T>(
  record: GatewayRecord,
  body: (baseUrl: string) => Promise<T>
): Promise<T> {
  const direct = directGatewayBaseUrl(record);
  if (direct) return body(direct);
  if (!tunnelSessionOpener) {
    throw new GatewayTunnelUnavailableError('No SSH tunnel manager is installed.');
  }
  const session = await tunnelSessionOpener(record);
  try {
    return await body(session.baseUrl.replace(/\/$/, ''));
  } finally {
    session.release();
  }
}

/**
 * The base URL a record's requests should use: the live tunnel URL for a
 * tunnelled record, otherwise the record's own stored URL. Exported so the
 * screens that build their own requests (event stream, reachability) resolve
 * the same address the shared client does.
 */
export function effectiveGatewayBaseUrl(record: GatewayRecord | null): string {
  if (!record) return '';
  if (record.sshTunnel && tunnelBaseUrlResolver) return tunnelBaseUrlResolver(record) ?? '';
  return record.url;
}

/**
 * Recompute the active record's base URL and repoint the client at it, used
 * when a tunnel forward opens or closes under the record already in use. A
 * no-op when nothing is configured or the record is direct.
 */
export function refreshGatewayBaseUrl(): void {
  if (!currentRecord) return;
  const baseUrl = effectiveGatewayBaseUrl(currentRecord);
  if (baseUrl === currentBaseUrl) return;
  configureApi(
    baseUrl,
    currentRecord.token,
    currentRecord.deviceId ?? null,
    currentRecord.transportKey ?? null,
    currentRecord.transport === GATEWAY_TRANSPORT ? currentRecord.transport : null
  );
}
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
  if (
    currentBaseUrl !== baseUrl ||
    currentToken !== token ||
    currentDeviceId !== deviceId ||
    currentTransportKey !== transportKey ||
    currentTransport !== transport
  )
    nativeImageCache.invalidate();
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
  /** Path on this Gateway host only; remote agents need a separate transfer mechanism. */
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
  record: GatewayRecord,
  fileUri: string,
  name: string,
  mime: string,
  isCurrent: () => boolean
): Promise<UploadedAttachment> {
  assertDeliveryCurrent(isCurrent);
  if (isDemoRecord(record)) throw new Error('Attachments are not available in the demo.');
  const captured = { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined };
  return withRecordBaseUrl(captured, async (baseUrl) => {
    assertDeliveryCurrent(isCurrent);
    const endpoint = { ...captured, url: baseUrl };
    if (!baseUrl || !endpoint.token) throw new Error('Not connected to a server.');

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
      headers: { ...activeLocaleHeaders(), Authorization: `Bearer ${endpoint.token}` },
      body: form,
    };
    const response =
      endpoint.transport === GATEWAY_TRANSPORT
        ? await encryptedGatewayFetch(uploadUrl, uploadInit, UPLOAD_TIMEOUT_MS, endpoint, isCurrent)
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
    assertDeliveryCurrent(isCurrent);
    if (!value || typeof value.path !== 'string' || value.path.length === 0) {
      throw new Error('The server did not return a file path.');
    }
    return {
      path: value.path,
      name: typeof value.name === 'string' ? value.name : name,
      size: typeof value.size === 'number' ? value.size : 0,
      mime: typeof value.mime === 'string' ? value.mime : mime,
    };
  });
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

export function gatewayImageConnectionKey(): string {
  return QuickCrypto.createHash('sha256')
    .update(
      JSON.stringify([
        configuredGatewayServerId(),
        currentBaseUrl,
        currentDeviceId,
        currentToken,
        currentTransportKey,
      ])
    )
    .digest('hex');
}

/** Bind URLs, credentials and cache identity to this exact pairing, before any async work. */
export function gatewayImageBinding(asset: MessageImageAsset, capabilities?: readonly string[]) {
  const baseUrl = currentBaseUrl;
  const serverId = configuredGatewayServerId();
  const token = currentToken;
  const deviceId = currentDeviceId;
  const transport = currentTransport;
  const transportKey = currentTransportKey;
  const pairingKey = gatewayImageConnectionKey();
  const observedCapabilities =
    capabilities ?? (serverId ? (useServerCapabilities.getState().byServer[serverId] ?? []) : []);
  const plan = gatewayImagePlan(
    asset,
    {
      serverId: serverId ?? '',
      baseUrl,
      pairingKey,
      headers: gatewayAuthHeaders(),
    },
    observedCapabilities
  );
  if (!plan) return null;
  const rangedOriginal =
    Boolean(plan.version) ||
    (observedCapabilities.includes(IMAGE_PREVIEWS_CAPABILITY) &&
      (plan.original.uri.endsWith(`/api/agent-images/${asset.asset_id}/download`) ||
        plan.original.uri.endsWith(`/api/agent-images/${asset.asset_id}/original`)));
  const assertCurrent = () => {
    if (
      configuredGatewayServerId() !== serverId ||
      currentBaseUrl !== baseUrl ||
      currentToken !== token ||
      currentDeviceId !== deviceId ||
      currentTransportKey !== transportKey ||
      currentTransport !== transport
    )
      throw new Error('The image belongs to a different Gateway connection');
  };
  const requestImage = async (
    source: PreviewImageSource,
    signal: AbortSignal | undefined,
    limit: number,
    headers?: Record<string, string>
  ) => {
    assertCurrent();
    const init = { headers: { ...source.headers, ...headers }, signal, redirect: 'error' as const };
    const response =
      transport === GATEWAY_TRANSPORT
        ? await encryptedGatewayFetch(
            source.uri,
            init,
            ASSET_CONTENT_TIMEOUT_MS,
            {
              url: baseUrl,
              token: token ?? '',
              deviceId: deviceId ?? undefined,
              transportKey: transportKey ?? undefined,
            },
            () => gatewayImageConnectionKey() === pairingKey,
            limit
          )
        : await fetchImageWithin(ASSET_CONTENT_TIMEOUT_MS, source.uri, init);
    try {
      assertCurrent();
      return response;
    } catch (error) {
      await response.body?.cancel().catch(() => undefined);
      throw error;
    }
  };
  const read = async (
    source: PreviewImageSource,
    signal?: AbortSignal
  ): Promise<PreviewImageSource> => {
    assertCurrent();
    if (signal?.aborted) throw new Error('Image read cancelled');
    if (rangedOriginal && (source.uri === plan.original.uri || source.uri === plan.fallback.uri)) {
      const epoch = nativeImageCache.epoch();
      const versionResponse = plan.version
        ? await requestImage(plan.version, signal, IMAGE_VERSION_BYTES)
        : null;
      const fixed = versionResponse
        ? await readOriginalImageVersion(versionResponse, asset.asset_id, signal)
        : undefined;
      assertCurrent();
      if (signal?.aborted) throw new Error('Image read cancelled');
      const fixedSource = fixed
        ? {
            uri: `${baseUrl.replace(/\/$/, '')}${fixed.download_url}`,
            headers: source.headers,
            cacheKey: JSON.stringify([source.cacheKey, fixed.version]),
          }
        : source;
      const cacheKey = fixed
        ? QuickCrypto.createHash('sha256').update(fixedSource.cacheKey!).digest('hex')
        : null;
      if (cacheKey && fixed) {
        let cached: PreviewImageSource | null = null;
        try {
          const path = await nativeImageCache.path(cacheKey);
          if (path) cached = await copyCachedOriginalImageFile(path, fixed);
        } catch {
          // Native eviction/Clear cache can race the lookup and copy: use the authenticated reader.
        }
        if (cached) {
          try {
            assertCurrent();
            if (signal?.aborted) throw new Error('Image read cancelled');
            return cached;
          } catch (error) {
            cached.dispose?.();
            throw error;
          }
        }
      }
      const downloaded = await downloadOriginalImageFile({
        signal,
        size: asset.size,
        assertCurrent,
        acquireVersion: fixed ? async () => fixed : undefined,
        request: (rangeHeaders, rangeSignal) =>
          requestImage(fixedSource, rangeSignal, IMAGE_RANGE_BYTES, rangeHeaders),
      });
      try {
        assertCurrent();
        if (signal?.aborted) throw new Error('Image read cancelled');
        // iOS seeds via Data(contentsOf:), so large originals keep the bounded streaming path.
        if (cacheKey && fixed && fixed.size <= 64 * 1024 * 1024) {
          await nativeImageCache.seed(downloaded.uri, cacheKey, epoch).catch(() => undefined);
        }
        assertCurrent();
        if (signal?.aborted) throw new Error('Image read cancelled');
      } catch (error) {
        downloaded.dispose?.();
        throw error;
      }
      return downloaded;
    }
    const key = source.cacheKey ?? source.uri;
    const limit = source.uri.endsWith('/thumbnail')
      ? 1024 * 1024
      : source.uri.endsWith('/preview')
        ? 4 * 1024 * 1024
        : 25 * 1024 * 1024;
    const response = await requestImage(source, signal, limit);
    let bytes: Uint8Array;
    let extension: string;
    try {
      assertCurrent();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      extension = IMAGE_EXTENSIONS[mime];
      if (!extension) throw new Error('Gateway did not return an image.');
      bytes = await readLimitedImageBody(response, limit, signal);
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
    assertCurrent();
    if (signal?.aborted) throw new Error('Image read cancelled');
    if (bytes.length > 25 * 1024 * 1024) throw new Error('Image exceeds the download limit');
    const directory = new Directory(
      Paths.cache,
      `file-export-${Date.now()}-${Math.floor(Math.random() * 2 ** 32)}`
    );
    const disposeCache = await protectTemporaryCacheEntry(directory);
    const cachedFile = new File(directory, `preview.${extension}`);
    try {
      directory.create();
      cachedFile.create();
      await cachedFile.write(bytes);
    } catch (error) {
      disposeCache();
      throw error;
    }
    return {
      uri: cachedFile.uri,
      cacheKey: key,
      dispose: disposeCache,
    };
  };
  const image: PreviewImageDescriptor = {
    id: plan.id,
    ...plan.preview,
    original: plan.original,
    fallback: plan.fallback,
    deferred: true,
    resolveSource: (signal: AbortSignal) =>
      readOriginalFirst(plan, (source) => read(source, signal), signal),
    resolvePreview:
      plan.preview.uri !== plan.original.uri ? (signal) => read(plan.preview, signal) : undefined,
    resolveOriginal: async (signal) => ({
      ...(await read(plan.original, signal)),
      originalLoaded: true,
    }),
  };
  return {
    image,
    plan,
    // Native image loaders must never receive bearer headers or follow redirects.
    readThumbnail: (signal: AbortSignal) =>
      readThumbnailOnly(plan, (source) => read(source, signal)),
  };
}

export function assetPreviewImage(asset: SessionAsset): PreviewImageDescriptor | null {
  if (asset.gatewayServerId && asset.gatewayServerId !== configuredGatewayServerId()) return null;
  // Listing metadata without derivative fields retains the established asset path.
  if (
    !asset.preview_url &&
    !asset.thumbnail_url &&
    !asset.download_url &&
    !asset.version_url &&
    !asset.preview_declared
  )
    return null;
  return (
    gatewayImageBinding({
      src: asset.path,
      asset_id: asset.id,
      url: `/api/assets/${asset.id}/content`,
      mime: asset.mime,
      thumbnail_url: asset.thumbnail_url,
      preview_url: asset.preview_url,
      download_url: asset.download_url,
      version_url: asset.version_url,
      cache_revision: asset.modified_unix_ms,
      size: asset.size > 0 ? asset.size : undefined,
      preview_declared: asset.preview_declared,
    })?.image ?? null
  );
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

/**
 * That budget, widened for the file actually being asked for.
 *
 * 15 seconds was chosen when nothing larger than 512 KiB could be asked for. A
 * flat budget over a ceiling ten times higher is not a stall guard any more, it
 * is a size limit wearing a clock: five MiB over a phone's uplink is a minute's
 * honest work, and cutting it off at fifteen seconds would refuse the file
 * while blaming the network. So the allowance grows with the file and the floor
 * stays where it is -- a small file that stalls still fails fast, which is the
 * case the budget exists for.
 */
export function assetTextTimeoutMs(bytes: number): number {
  const megabytes = Math.ceil(Math.max(0, bytes) / (1024 * 1024));
  return Math.min(90_000, ASSET_CONTENT_TIMEOUT_MS + megabytes * 10_000);
}

/**
 * The local id of the record the shared client is configured for, or null.
 * The event socket is per server record and opens with this client's base URL
 * and credentials, so it checks it is still talking about the same server.
 */
export function configuredGatewayServerId(): string | null {
  return currentRecord?.serverId ?? null;
}

export function isGatewayConfigured(): boolean {
  return Boolean(currentBaseUrl && currentBaseUrl.trim().length > 0);
}

export function gatewayUrl(path: string): string {
  const baseUrl = currentBaseUrl.replace(/\/$/, '');
  if (!baseUrl) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  return `${baseUrl}${path}`;
}

export function gatewayAuthHeaders(): Record<string, string> {
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
  options: {
    since?: number;
    limit?: number;
    kind?: readonly AssetKind[];
    /**
     * The caller's own cancellation. A files sheet that closes, or a chip that
     * changes the question, abandons the listing it no longer wants: without
     * this the request ran to completion into a screen that had gone, holding a
     * socket for nobody, and its answer could still land after a newer one.
     */
    signal?: AbortSignal;
  } = {}
): Promise<SessionAsset[]> {
  if (isDemoActive()) {
    const assets = demoSessionAssets();
    if (!options.kind?.length) return assets;
    const kindSet = new Set(options.kind);
    return assets.filter((asset) => kindSet.has(asset.kind));
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

  return requestSessionAssets(sessionId, tabId, query, options.signal);
}

function assertFileGateway(serverId: string | null) {
  if (serverId !== configuredGatewayServerId())
    throw new Error('The file belongs to a different Gateway');
}

async function requestSessionAssets(
  sessionId: string,
  tabId: string,
  query: string[],
  signal?: AbortSignal
): Promise<SessionAsset[]> {
  const serverId = configuredGatewayServerId();
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/tabs/${encodeURIComponent(tabId)}/assets?${query.join('&')}`
    ),
    { headers: gatewayAuthHeaders(), signal }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const assets = sessionAssetsFromResponse(await response.json());
  assertFileGateway(serverId);
  return assets.map((asset) => ({ ...asset, gatewayServerId: serverId ?? undefined }));
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
  path: string,
  /** The pane's directory, so a relative path means what it says. */
  cwd?: string
): Promise<SessionAsset | null> {
  if (!isHostPathSource(path)) return null;
  if (/^file:/i.test(path)) {
    if (!/^file:\/\/\//i.test(path)) return null;
    try {
      path = decodeURIComponent(path.slice('file://'.length));
    } catch {
      return null;
    }
  }
  if (isDemoActive()) return findAssetByPath(demoSessionAssets(), path);

  // Every form of the path is worth asking about, including `~`.
  //
  // This used to ask only about paths beginning with `/`, reasoning that `~` is
  // the shell's and not the gateway's. That was the client deciding on the
  // gateway's behalf that a question would fail -- and the gateway is the only
  // party that knows its own home directory, so it is the only one that can
  // answer. An agent that writes a file and prints `~/Desktop/theme.muqun-theme`
  // is describing a file the gateway can read; refusing to ask about it made
  // that file unreachable from the app for no reason the reader could see.
  //
  // A relative path is asked about too, paired with the pane's directory when
  // the caller knows it: `./theme.muqun-theme` means something precise, and it
  // is the form an agent is most likely to print.
  const candidates = [
    path,
    cwd && !path.startsWith('/') && !path.startsWith('~')
      ? `${cwd.replace(/\/+$/, '')}/${path.replace(/^\.\//, '')}`
      : null,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const exact = await requestSessionAssets(sessionId, tabId, [
      `path=${encodeURIComponent(candidate)}`,
    ]);
    const match = findAssetByPath(exact, candidate) ?? findAssetByPath(exact, path);
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
  const serverId = configuredGatewayServerId();
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
  assertFileGateway(serverId);
  const asset = assetFromContentHeaders(assetId, (name) => response.headers.get(name), {
    previewable: response.status !== 415,
  });
  return asset ? { ...asset, gatewayServerId: serverId ?? undefined } : null;
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

/** The folder the gateway keeps uploaded attachments in, as it appears in a host path. */
const UPLOADS_SEGMENT = '/muqun-gateway/uploads/';

/**
 * The name the gateway serves an uploaded attachment under, or null when the
 * path is not one of ours. A timeline item carries the host path OpenCode
 * received (`/home/…/muqun-gateway/uploads/<uuid>.webp`); the phone cannot
 * open that, but `GET /api/uploads/<name>` streams the same bytes back.
 */
export function uploadNameFromPath(path: string): string | null {
  const index = path.indexOf(UPLOADS_SEGMENT);
  if (index < 0) return null;
  const name = path.slice(index + UPLOADS_SEGMENT.length).split(/[/?#]/)[0] ?? '';
  return name.length > 0 ? name : null;
}

export function uploadContentUrl(name: string): string {
  return gatewayUrl(`/api/uploads/${encodeURIComponent(name)}`);
}

/** Like `assetImageSource`, for a file the reader attached themselves. */
export function uploadImageSource(name: string): AssetImageSource | null {
  if (currentTransport === GATEWAY_TRANSPORT) return null;
  return { uri: uploadContentUrl(name), headers: gatewayAuthHeaders(), cacheKey: `upload:${name}` };
}

/** The encrypted-transport path: bytes are authenticated here and decoded from a data URI. */
export async function readUploadImageSource(
  name: string,
  options: { signal?: AbortSignal } = {}
): Promise<AssetImageSource> {
  const direct = uploadImageSource(name);
  if (direct) return direct;
  const response = await encryptedGatewayFetch(
    uploadContentUrl(name),
    { headers: gatewayAuthHeaders(), signal: options.signal },
    ASSET_CONTENT_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const mime = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
  if (!mime.startsWith('image/')) throw new Error('Gateway did not return an image.');
  const bytes = QuickCrypto.Buffer.from(await response.arrayBuffer());
  return {
    uri: `data:${mime};base64,${bytes.toString('base64')}`,
    cacheKey: `upload:${name}:encrypted`,
  };
}

/** Download and authenticate image bytes before handing a data URI to the decoder. */
export async function readAssetImageSource(
  asset: SessionAsset,
  options: { signal?: AbortSignal } = {}
): Promise<AssetImageSource> {
  const direct = assetImageSource(asset);
  if (direct) return direct;
  const response = await encryptedGatewayFetch(
    assetContentUrl(asset.id),
    { headers: gatewayAuthHeaders(), signal: options.signal },
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
 * Where the markdown renderer loads an image an agent embedded by host path
 * (`image_assets`, see `message-images.ts`). On a plain transport that is the
 * gateway URL itself, fetched by the renderer with `gatewayAuthHeaders()`. The
 * renderer cannot open an encrypted transport's envelope, so there it is null
 * and `readMessageImageFile` lands the authenticated bytes in a cache file.
 */
export function messageImageUrl(url: string): string | null {
  if (currentTransport === GATEWAY_TRANSPORT) return null;
  return gatewayUrl(url);
}

/** One download per image per launch, shared by every part that shows it. */
const messageImageFiles = new Map<string, Promise<string>>();

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/avif': 'avif',
};

/** The encrypted-transport path of `messageImageUrl`: a `file://` URI. */
export function readMessageImageFile(asset: { asset_id: string; url: string }): Promise<string> {
  const known = messageImageFiles.get(asset.asset_id);
  if (known) return known;
  const pending = (async () => {
    const response = await encryptedGatewayFetch(
      gatewayUrl(asset.url),
      { headers: gatewayAuthHeaders() },
      ASSET_CONTENT_TIMEOUT_MS
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
    const extension = IMAGE_EXTENSIONS[mime];
    if (!extension) throw new Error('Gateway did not return an image.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const file = new File(Paths.cache, `message-image-${asset.asset_id}.${extension}`);
    if (file.exists) file.delete();
    file.create();
    await file.write(bytes);
    return file.uri;
  })();
  messageImageFiles.set(asset.asset_id, pending);
  // A failure is not remembered: the next render may find the gateway back.
  pending.catch(() => messageImageFiles.delete(asset.asset_id));
  return pending;
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
  const budget = assetTextTimeoutMs(asset.size);
  const response =
    currentTransport === GATEWAY_TRANSPORT
      ? await encryptedGatewayFetch(url, init, budget)
      : await fetchWithin(budget, 'Timed out reading the file.', url, init);
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
 * A packaged theme's bytes, streamed so the reader sees it arrive.
 *
 * `readAssetText` exists for files a viewer shows as text and refuses anything
 * large; a theme package is a ZIP of artwork and is neither. The gateway has
 * always been able to serve it -- the same endpoint that feeds the image viewer
 * -- so what was missing was only a caller that reads bytes and reports
 * progress while it does.
 *
 * `onProgress` is called with bytes received and, when the server declares one,
 * the total. A server that declines to declare a length still reports the
 * bytes, which is enough for a spinner that means something.
 *
 * The ceiling is the importer's own, checked twice: against the declared size
 * before a byte is requested, and against the running total while reading, so a
 * server that under-declares cannot spend more of the phone's memory than the
 * importer would ever accept.
 */
export async function resolveAgentAudioAsset(
  asid: string,
  uri: string,
  signal: AbortSignal
): Promise<SessionAsset> {
  if (isDemoActive()) {
    const asset = demoSessionAssets().find((entry) => entry.id === 'as-demo-audio');
    if (!asset || !uri.endsWith('sample-tone.wav')) throw new Error('Audio output unavailable.');
    return asset;
  }
  const health = await gatewayFetch(gatewayUrl('/health'), {
    headers: gatewayAuthHeaders(),
    signal,
  });
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
  const capabilities = (await health.json()).capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes('agent_audio_assets')) {
    throw new AudioPlaybackError('unsupported');
  }
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/agent-sessions/${encodeURIComponent(asid)}/audio-asset?uri=${encodeURIComponent(uri)}`
    ),
    { headers: gatewayAuthHeaders(), signal }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const envelope = await response.json();
  const asset = sessionAssetsFromResponse({ data: { assets: [envelope?.data?.asset] } })[0];
  if (!asset || asset.kind !== 'audio' || !asset.previewable)
    throw new Error('Audio output unavailable.');
  return asset;
}

export async function resolveAgentFileAsset(
  asid: string,
  uri: string,
  signal: AbortSignal,
  serverId = configuredGatewayServerId()
): Promise<SessionAsset> {
  if (!isHostPathSource(uri)) throw new Error('File output unavailable.');
  assertFileGateway(serverId);
  if (isDemoActive()) {
    const asset = demoSessionAssets().find((entry) => uri.endsWith(entry.name));
    if (!asset) throw new Error('File output unavailable.');
    return asset;
  }
  const upload = assetFromUploadedPdf(uri, serverId);
  if (upload) return upload;
  const health = await gatewayFetch(gatewayUrl('/health'), {
    headers: gatewayAuthHeaders(),
    signal,
  });
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
  const capabilities = (await health.json()).capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes('agent_file_assets')) {
    throw new AudioPlaybackError('unsupported');
  }
  assertFileGateway(serverId);
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/agent-sessions/${encodeURIComponent(asid)}/file-asset?uri=${encodeURIComponent(uri)}`
    ),
    { headers: gatewayAuthHeaders(), signal }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const envelope = await response.json();
  const asset = sessionAssetsFromResponse({ data: { assets: [envelope?.data?.asset] } })[0];
  if (!asset) throw new Error('File output unavailable.');
  assertFileGateway(serverId);
  return { ...asset, gatewayServerId: serverId ?? undefined };
}

export async function readAssetBytes(
  asset: SessionAsset,
  options: {
    signal?: AbortSignal;
    download?: boolean;
    maxBytes: number;
    onProgress?: (received: number, total: number | null) => void;
  }
): Promise<Uint8Array> {
  if (asset.size > options.maxBytes) throw new Error('HTTP 413: This file is too large to open.');
  if (options.signal?.aborted) throw new Error('Operation cancelled.');
  if (asset.localUri) {
    if (!/^(?:file|content):\/\//.test(asset.localUri)) throw new Error('Invalid local file');
    const file = new File(asset.localUri);
    if (file.size > options.maxBytes) throw new Error('HTTP 413: This file is too large.');
    const handle = file.open(FileMode.ReadOnly);
    try {
      // Bound even unknown-size document-provider files before allocating more.
      const bytes = await handle.readBytes(options.maxBytes + 1);
      if (bytes.length > options.maxBytes) throw new Error('HTTP 413: This file is too large.');
      if (options.signal?.aborted) throw new Error('Operation cancelled.');
      options.onProgress?.(bytes.length, bytes.length);
      return bytes;
    } finally {
      handle.close();
    }
  }
  const serverId = configuredGatewayServerId();
  assertAssetGateway(asset, serverId);
  const demoBytes = isDemoActive() ? demoAudioBytes(asset.id) : null;
  if (demoBytes) {
    if (demoBytes.length > options.maxBytes) throw new Error('HTTP 413: This file is too large.');
    options.onProgress?.(demoBytes.length, demoBytes.length);
    return demoBytes;
  }
  if (options.download && !asset.uploadName) {
    const health = await gatewayFetch(gatewayUrl('/health'), {
      headers: gatewayAuthHeaders(),
      signal: options.signal,
    });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    const capabilities = (await health.json()).capabilities;
    if (!Array.isArray(capabilities) || !capabilities.includes('asset_download'))
      throw new AudioPlaybackError('unsupported');
  }
  assertFileGateway(serverId);
  const url = asset.uploadName
    ? uploadContentUrl(asset.uploadName)
    : options.download
      ? assetContentUrl(asset.id).replace(/\/content$/, '/download')
      : assetContentUrl(asset.id);
  const init = { headers: gatewayAuthHeaders(), signal: options.signal };
  // Sized to the file: a 9 MB theme package over a phone's uplink outlasts a
  // flat 15 seconds, and the encrypted transport delivers it whole.
  const timeoutMs = assetTextTimeoutMs(asset.size);
  const response =
    currentTransport === GATEWAY_TRANSPORT
      ? await encryptedGatewayFetch(url, init, timeoutMs)
      : await fetchWithin(timeoutMs, 'Timed out reading the file.', url, init);
  assertFileGateway(serverId);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > options.maxBytes) throw new Error('HTTP 413: This file is too large to open.');
  const total = declared > 0 ? declared : null;

  const reader = response.body?.getReader();
  if (!reader) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length > options.maxBytes) throw new Error('HTTP 413: This file is too large.');
    options.onProgress?.(whole.length, total);
    assertFileGateway(serverId);
    return whole;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.length;
      // Checked while reading, not after: the point of the ceiling is to not
      // hold the bytes, and a check that runs once they are all here has
      // already failed at that.
      if (received > options.maxBytes) throw new Error('HTTP 413: This file is too large.');
      chunks.push(value);
      options.onProgress?.(received, total);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  assertFileGateway(serverId);
  return bytes;
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
  const serverId = configuredGatewayServerId();
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

  const body: unknown = await response.json();
  noteGatewayGeneration(serverId, body);
  return panePartsFromResponse(body);
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
 * The diff viewer's vocabulary, re-exported for the same reason the part,
 * mention and away ones are: a screen reaches for the gateway through a single
 * module.
 */
export {
  AUTO_EXPAND_MAX_LINES,
  DIFF_CONTEXT_LINES,
  DIFF_TAB_WIDTH,
  FILE_PATCH_MAX_LINES,
  GIT_DIFF_CAPABILITY,
  MAX_OPEN_FILES,
  PANE_CONTEXT_CAPABILITY,
  applyPatchPage,
  badgeCount,
  closeFile,
  emptyFilePatchState,
  expandTabs,
  fileHeaderIndices,
  flattenDiffRows,
  gatewaySupportsGitDiff,
  gatewaySupportsPaneContext,
  gitDiffPageFromResponse,
  gitStatusFromResponse,
  openFile,
  paneContextFromResponse,
  NO_PATCH_CARRY,
  parseUnifiedPatch,
  shouldAutoExpand,
  filterFilesBySide,
  sideOfFile,
  stagedParamForSide,
  GIT_DIFF_SIDES,
  widestRow,
  type GitDiffHunk,
  type GitDiffLine,
  type GitDiffLineKind,
  type GitDiffRow,
  type GitDiffRowType,
  type GitFileChange,
  type GitFilePatchPage,
  type GitFilePatchState,
  type GitFileStatus,
  type GitRepoSummary,
  type GitStatus,
  type GitDiffSide,
  type PaneAgentContext,
  type PaneContext,
  type ParsedPatch,
  type PatchCarry,
} from './git-diff';

/**
 * What this pane is: where it is working, whether that is a checkout, and what
 * is running in it.
 *
 * One request rather than four. The app could stitch this from `get_pane`,
 * `recent-cwds`, `shortcuts` and the parts descriptor, three of which repeat
 * work the gateway already did to answer the first -- so the gateway assembles
 * it instead, and `pane_context` is the capability that says it can.
 *
 * A pane outside the session's fence, or one whose directory is not a
 * repository, answers `git: null`. That is the ordinary answer and not an
 * error: a failure here would be a host-probing oracle, which is why
 * `pane_files` already answers the same way.
 */
export async function loadPaneContext(
  sessionId: string,
  paneId: string,
  signal?: AbortSignal
): Promise<PaneContext> {
  if (isDemoActive()) return paneContextFromResponse(demoPaneContext(paneId));

  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/context`
    ),
    { headers: gatewayAuthHeaders(), signal }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return paneContextFromResponse(await response.json());
}

/** Only Git-linked checkouts of this pane's authorized repository are offered. */
export async function loadGitWorktrees(
  sessionId: string,
  paneId: string,
  signal?: AbortSignal
): Promise<GitWorktreeInventory> {
  if (isDemoActive()) {
    const inventory = parseGitWorktrees(demoGitWorktrees(paneId));
    if (!inventory) throw new Error('Invalid worktree inventory');
    return inventory;
  }
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/git/worktrees`
    ),
    { headers: gatewayAuthHeaders(), signal }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const inventory = parseGitWorktrees(await response.json());
  if (!inventory) throw new Error('Invalid worktree inventory');
  return inventory;
}

/**
 * Which files in this pane's checkout have changed, and by how much.
 *
 * The union of the index and the working tree, one entry per path: v1 shows
 * what is different from `HEAD`, not a three-way split of where each change is
 * staged. `truncated` is the gateway saying it stopped counting, and the sheet
 * has to say so rather than present a cut list as the whole answer.
 *
 * No patch text comes back here. The list is O(changed files) and the patch is
 * fetched per file on expand, which is the whole reason this cannot freeze on a
 * large repository -- there is no "the whole diff" request in the API at all.
 */
export async function loadGitStatus(
  sessionId: string,
  paneId: string,
  signal?: AbortSignal,
  worktree?: string
): Promise<GitStatus> {
  if (isDemoActive()) return gitStatusFromResponse(demoGitStatus(paneId, worktree));

  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(
        paneId
      )}/git/status${worktree ? `?worktree=${encodeURIComponent(worktree)}` : ''}`
    ),
    { headers: gatewayAuthHeaders(), signal }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return gitStatusFromResponse(await response.json());
}

/**
 * One page of one file's unified patch.
 *
 * `from` is a line offset into the file's whole patch and `lines` is how much
 * of it to send; the gateway cuts the page at a hunk boundary, so every page
 * starts at a `diff --git` or an `@@` line and parses on its own. That is what
 * lets "show more" append hunks instead of re-reading the file from the top.
 *
 * Everything is clamped on the way out as well as on the way in. The gateway
 * clamps too -- it has to, it is the one running `git` -- but asking within the
 * range keeps the echoed `end` equal to what was requested, which makes a
 * mismatch a real signal rather than a rounding difference.
 */
export async function loadGitFileDiff(
  sessionId: string,
  paneId: string,
  path: string,
  options: {
    from?: number;
    lines?: number;
    context?: number;
    oldPath?: string | null;
    /** Absent: working tree against HEAD. `true`: index against HEAD. `false`: working tree against index. */
    staged?: boolean;
    worktree?: string;
  } = {},
  signal?: AbortSignal
): Promise<GitFilePatchPage> {
  const from = Math.max(0, Math.round(options.from ?? 0));
  const lines = Math.max(
    1,
    Math.min(FILE_PATCH_MAX_LINES, Math.round(options.lines ?? FILE_PATCH_MAX_LINES))
  );
  const context = Math.max(0, Math.min(25, Math.round(options.context ?? DIFF_CONTEXT_LINES)));

  if (isDemoActive()) {
    return gitDiffPageFromResponse(demoGitDiff(paneId, path, from, lines, options.worktree), path);
  }

  // Assembled by hand rather than through URLSearchParams, whose React Native
  // shim is only a partial one. `staged` exists on the route and v1 never sends
  // it: the list is the union, so there is nothing to select between.
  const query = [
    `path=${encodeURIComponent(path)}`,
    `context=${context}`,
    `from=${from}`,
    `lines=${lines}`,
  ];
  // Both ends of a rename, or git renders the move as a brand-new file and the
  // reader is shown a thousand added lines where one line actually changed.
  if (options.oldPath) query.push(`old_path=${encodeURIComponent(options.oldPath)}`);
  if (options.staged !== undefined) query.push(`staged=${options.staged ? 'true' : 'false'}`);
  if (options.worktree) query.push(`worktree=${encodeURIComponent(options.worktree)}`);
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(
        paneId
      )}/git/diff?${query.join('&')}`
    ),
    { headers: gatewayAuthHeaders(), signal }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return gitDiffPageFromResponse(await response.json(), path);
}

function paneVcsUrl(sessionId: string, paneId: string, rest: string): string {
  return gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/vcs/${rest}`
  );
}

/** The `data` of the gateway's envelope, or the body when it has none. */
function paneEnvelopeData(json: unknown): unknown {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'data' in json) {
    return (json as { data: unknown }).data;
  }
  return json;
}

/** Optional `pane_lazygit`: observe before offering the host's Git TUI. */
export async function paneLazygitAvailable(
  sessionId: string,
  paneId: string,
  worktree?: string
): Promise<boolean> {
  if (isDemoActive()) return Boolean(paneId);
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/lazygit${worktree ? `?worktree=${encodeURIComponent(worktree)}` : ''}`
    ),
    { headers: gatewayAuthHeaders() }
  );
  if (!response.ok) return false;
  const data = paneEnvelopeData(await response.json());
  return Boolean(
    data && typeof data === 'object' && 'available' in data && data.available === true
  );
}

export async function launchPaneLazygit(
  sessionId: string,
  paneId: string,
  worktree?: string
): Promise<{
  paneId: string;
  started: boolean;
}> {
  if (isDemoActive()) return { paneId: demoLaunchLazygit(worktree), started: true };
  const response = await gatewayFetch(
    gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/lazygit${worktree ? `?worktree=${encodeURIComponent(worktree)}` : ''}`
    ),
    { method: 'POST', headers: gatewayAuthHeaders() }
  );
  if (!response.ok) throw new Error('Could not start lazygit on the Gateway host.');
  const data = paneEnvelopeData(await response.json()) as {
    target?: { pane_id?: unknown };
    started?: unknown;
  };
  if (typeof data?.target?.pane_id !== 'string' || !data.target.pane_id)
    throw new Error('The computer did not say which terminal it made.');
  return { paneId: data.target.pane_id, started: data.started === true };
}

/**
 * The pane's changed files, without their patches (`pane_vcs_files`): the
 * agent route `…/vcs/files`, asked of a terminal pane's directory.
 *
 * `null` means this route gave no usable answer -- a refusal, an older
 * gateway, a body that is not a listing -- and is the sheet's cue to fall
 * back to `…/git/status`, which every `git_diff` gateway answers. A pane that
 * is gone (`404 unknown_pane`) is an answer, `reason: 'unknown_pane'`, the way
 * the agent routes answer `workspace_missing`; outside a checkout the route
 * answers `200` with `reason: 'not_a_repository'`.
 */
export async function getPaneVcsFiles(
  sessionId: string,
  paneId: string,
  mode: VcsFilesMode = 'working'
): Promise<AgentVcsFiles | null> {
  if (isDemoActive() || !paneId) return null;
  try {
    const response = await gatewayFetch(paneVcsUrl(sessionId, paneId, `files?mode=${mode}`), {
      headers: gatewayAuthHeaders(),
    });
    if (response.status === 404 && /"unknown_pane"/.test(await response.text())) {
      // The pane is gone: an answer, not a failure, and `…/git/status` would
      // only say the same thing less clearly.
      return { files: [], mode, truncated: false, reason: 'unknown_pane' };
    }
    if (!response.ok) return null;
    return parseAgentVcsFiles(paneEnvelopeData(await response.json()));
  } catch {
    return null;
  }
}

/** One file's patch at `context` lines (`pane_vcs_files`). Throws when there is none to show. */
export async function getPaneVcsFile(
  sessionId: string,
  paneId: string,
  options: { mode: VcsFilesMode; path: string; context: number }
): Promise<AgentVcsFilePatch> {
  // Assembled by hand: React Native's URLSearchParams shim is only a partial one.
  const query = [
    `mode=${options.mode}`,
    `path=${encodeURIComponent(options.path)}`,
    `context=${Math.max(0, Math.round(options.context))}`,
  ].join('&');
  const response = await gatewayFetch(paneVcsUrl(sessionId, paneId, `file?${query}`), {
    headers: gatewayAuthHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const patch = parseAgentVcsFilePatch(paneEnvelopeData(await response.json()));
  if (!patch) throw new Error(`Failed to load the patch for ${options.path}`);
  return patch;
}

/**
 * Throw away one file's uncommitted changes in the pane's checkout
 * (`pane_vcs_files`): a tracked file is restored, an untracked one deleted.
 * Irreversible; the sheet asks first. A refusal throws `HTTP <status>: <body>`,
 * which `agentRequestErrorDetail` reads the gateway's code and sentence from.
 */
export async function discardPaneVcsFile(
  sessionId: string,
  paneId: string,
  path: string
): Promise<AgentVcsDiscard> {
  const response = await gatewayFetch(paneVcsUrl(sessionId, paneId, 'discard'), {
    method: 'POST',
    headers: { ...gatewayAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  let data: unknown = null;
  try {
    data = paneEnvelopeData(await response.json());
  } catch {
    // `204 No Content` is a legitimate answer.
  }
  return parseAgentVcsDiscard(data) ?? { path, action: 'restored' };
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

/**
 * One request to a stored record with that record's own credentials, whichever
 * computer the shared client is pointed at.
 *
 * A record with a transport key is sealed with it; one with no key -- paired
 * before encryption existed -- goes in the clear by its bearer token, and that
 * is the only route on which a token may leave the configured gateway unsealed
 * (`endpointCredentialRoute`).
 */
export function gatewayEndpointFetch(
  endpoint: GatewayEndpoint,
  input: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  // The sealed route joins identical GETs in flight the way the plain route
  // does through `gatewayFetchWithin`: two screens asking a stored computer
  // the same question at once used to be two sealed requests.
  return endpointCredentialRoute(endpoint) === 'sealed'
    ? withRequestDedupe(inFlightGets, dedupeKey(input, init, timeoutMs), () =>
        encryptedGatewayFetch(input, init, timeoutMs, endpoint)
      )
    : gatewayFetchWithin(timeoutMs, input, init, { plainRecord: true });
}

function approvalPath(sessionId: string, paneId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/approval`;
}

async function approvalConflict(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
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
  const response = await gatewayEndpointFetch(target, `${base}${approvalPath(sessionId, paneId)}`, {
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
  const response = await gatewayEndpointFetch(target, `${base}${approvalPath(sessionId, paneId)}`, {
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
  currentRecord = record;
  configureApi(
    // A tunnelled record's real URL is unreachable directly; its base is the
    // loopback forward, resolved live and empty until the forward is up.
    effectiveGatewayBaseUrl(record),
    record?.token ?? null,
    record?.deviceId ?? null,
    record?.transportKey ?? null,
    record?.transport === GATEWAY_TRANSPORT && !isGatewayEncryptionDisabled()
      ? record.transport
      : null
  );
}

/**
 * Whether the connected gateway's transport is the encrypted one. An event
 * stream cannot be sealed as one finite response, so an encrypted connection
 * streams sealed records instead -- see {@link encryptedEventStreamRequest}
 * and `sse-record.ts`.
 */
export function gatewayUsesEncryptedTransport(token: string | null): boolean {
  if (isGatewayEncryptionDisabled()) return false;
  return Boolean(
    token &&
    token === currentToken &&
    currentDeviceId &&
    currentTransportKey &&
    currentTransport === GATEWAY_TRANSPORT
  );
}

/** Everything a caller needs to open an encrypted event stream and read it. */
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
 * Seal the request that opens an event stream for an encrypted record, and
 * hand back what the stream decryptor needs to open its records.
 *
 * Both streams go through here: the device-wide `/api/sessions/{id}/events`
 * that `use-pane-events` opens, and the per-session
 * `/api/agent-sessions/{asid}/stream` that `openAgentSessionStream` does. The
 * AAD is built from the path, so the two are sealed under different keys
 * without this needing to know which is which.
 *
 * The gateway authenticates this exactly like any other encrypted GET -- the
 * envelope rides `X-Muqun-Envelope`, replay-cached and clock-checked -- but
 * answers with standard SSE whose events are sealed one by one, because a
 * stream that never ends cannot ride the one-envelope response path. Answers
 * null when the connected gateway does not use the encrypted transport.
 */
export async function encryptedEventStreamRequest(
  url: string,
  /** Another paired computer's stored credentials; the selected one's when omitted. */
  endpoint?: GatewayEndpoint
): Promise<EncryptedStreamRequest | null> {
  const token = endpoint ? endpoint.token : currentToken;
  const deviceId = endpoint ? endpoint.deviceId : currentDeviceId;
  const transportKey = endpoint ? endpoint.transportKey : currentTransportKey;
  const transport = endpoint ? endpoint.transport : currentTransport;
  if (!token || !deviceId || !transportKey || transport !== GATEWAY_TRANSPORT) {
    return null;
  }
  const version = await negotiatedTransportVersion(
    endpoint ?? { url: currentBaseUrl, token, deviceId, transportKey }
  );
  const aad = requestAad(url, 'GET');
  const material = transportKeyMaterial(transportKey);
  const plaintext: EncryptedRequestPayload = {
    token,
    body: base64Url(QuickCrypto.Buffer.alloc(0)),
  };
  const envelope = encryptJson(material, 'request', aad, plaintext, version);
  return {
    headers: {
      'X-Muqun-Transport': '1',
      'X-Muqun-Device': deviceId,
      'X-Muqun-Envelope': base64Url(QuickCrypto.Buffer.from(JSON.stringify(envelope), 'utf8')),
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
    typeof record.version === 'number' &&
    typeof record.timestamp_ms === 'number' &&
    typeof record.nonce === 'string' &&
    typeof record.ciphertext === 'string'
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
 * not conceal the submitted code. Manual pairing supports HTTP and HTTPS,
 * including LAN and Tailscale addresses, without inferring network protection
 * from a hostname or IP range.
 */
async function pairingRequest<T>(
  gatewayUrl: string,
  path: string,
  body: Record<string, unknown>,
  transportKey?: string,
  codeMaterial?: Uint8Array,
  requireCodeEncryption = false
): Promise<T> {
  const pairingUrl = validatePairingTransport(gatewayUrl, transportKey);
  const aad = `POST ${path}`;
  const material = transportKey ? pairingKeyMaterial(transportKey) : null;
  const requestEnvelope = material ? encryptJson(material, 'pairing-request', aad, body) : null;
  const response = await fetchWithin(
    REQUEST_TIMEOUT_MS,
    'Timed out waiting for the server.',
    `${pairingUrl}${path}`,
    {
      method: 'POST',
      headers: { ...activeLocaleHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(requestEnvelope ?? body),
      credentials: 'omit',
      redirect: 'error',
    }
  );
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
  return pairingRequest(
    gatewayUrl,
    '/api/pair/request',
    {
      request_id: requestId,
      device_name: deviceName,
      ...(installId ? { install_id: installId } : {}),
    },
    transportKey
  );
}

export async function claimPairing(
  gatewayUrl: string,
  requestId: string,
  code: string,
  transportKey?: string,
  codeMaterial?: Uint8Array,
  requireCodeEncryption = false
): Promise<PairingPayload> {
  return pairingRequest(
    gatewayUrl,
    '/api/pair/claim',
    {
      request_id: requestId,
      code,
    },
    transportKey,
    codeMaterial,
    requireCodeEncryption
  );
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
 * The one request here that does not go through `fetchWithin`. It does read a
 * body, so the deadline has to cover the body -- and it does: the abort signal
 * is the fetch's own, and `clearTimeout` sits in a `finally` that runs after
 * the `json()` below has settled, not the moment the headers land. Clearing it
 * early is exactly the mistake `request-budget` exists to have stopped making,
 * so anyone reordering this has to keep the clear behind the last `await`.
 *
 * ## Why the body is read at all
 *
 * `/health` is the same answer the workspace prewarm needs, and the dot was
 * already paying for it. Throwing it away meant the home screen asked one
 * gateway for `/health` twice within a few hundred milliseconds -- once for the
 * dot, once for the warm. So `onHealth` hands the parsed body straight back to
 * the caller, which files the capabilities *and* keeps the health for the warm
 * to reuse (`stores/server-reachability`, `lib/workspace-snapshot`).
 *
 * The body is passed up unvalidated on purpose: this function knows a gateway
 * answered, not that it answered with something this app version understands.
 * Deciding that is `assertSupportedHerdr`'s job, and the reachability store
 * runs it before recording a health anyone may build on.
 */
export async function probeGatewayReachable(
  endpoint: GatewayEndpoint,
  timeoutMs: number,
  onHealth?: (health: unknown) => void,
  /** The HTTP status the gateway answered with, when it answered at all. */
  onStatus?: (status: number) => void
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
    await noteRefusedResponse({ url: `${base}/health`, token: endpoint.token }, response);
    onStatus?.(response.status);
    if (response.ok && onHealth) {
      try {
        onHealth(await response.json());
      } catch {
        // A gateway that answers 200 with something unreadable is still
        // reachable, which is the only question this function was asked.
      }
    }
    return response.ok;
  } catch (error) {
    // A sealed request refused before it authenticated comes back in the
    // clear and is thrown with its status; that status is the answer.
    if (error instanceof GatewayTransportRefusalError) onStatus?.(error.status);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadHealth(): Promise<HealthResponse> {
  if (isDemoActive()) {
    const demo = demoHealth() as HealthResponse;
    assertSupportedHerdr(demo);
    return demo;
  }
  const serverId = configuredGatewayServerId();
  const health = (await getHealth()) as HealthResponse;
  noteGatewayGeneration(serverId, health);
  assertSupportedHerdr(health);
  return health;
}

export async function loadSessions(): Promise<SessionsResponse> {
  if (isDemoActive()) return demoSessions() as SessionsResponse;
  const sessions = (await getApiSessions()) as SessionsResponse;
  return sessions.sessions?.some((session) => typeof session.connected !== 'boolean')
    ? withSessionAvailability(sessions, (await getHealth()) as HealthResponse)
    : sessions;
}

/** Read a saved Gateway with its own credentials, without configuring the live connection. */
export async function readGatewayRecordJson(record: GatewayRecord, path: string): Promise<unknown> {
  if (!path.startsWith('/api/') || path.includes('://'))
    throw new Error('Invalid Gateway read path');
  const captured = { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined };
  return withRecordBaseUrl(captured, async (baseUrl) => {
    const init = {
      method: 'GET',
      headers: { Authorization: `Bearer ${captured.token}`, ...activeLocaleHeaders() },
    };
    const url = `${baseUrl}${path}`;
    // Joined with any identical read of this record already in flight: Home
    // and the dock asked a stored computer for the same list twice at launch.
    const response = await withRequestDedupe(
      inFlightGets,
      dedupeKey(url, init, REQUEST_TIMEOUT_MS),
      () =>
        captured.transport === GATEWAY_TRANSPORT
          ? encryptedGatewayFetch(url, init, REQUEST_TIMEOUT_MS, { ...captured, url: baseUrl })
          : fetchWithin(REQUEST_TIMEOUT_MS, 'Timed out waiting for the server.', url, init)
    );
    await noteRefusedResponse({ url, token: captured.token }, response);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
}

/** Delete on the named computer, without repointing the active terminal or retrying the write. */
export async function deleteGatewayRecordJson(record: GatewayRecord, path: string): Promise<void> {
  if (!path.startsWith('/api/') || path.includes('://'))
    throw new Error('Invalid Gateway delete path');
  if (isDemoRecord(record)) throw new Error('Demo sessions cannot be closed remotely.');
  const captured = { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined };
  await withRecordBaseUrl(captured, async (baseUrl) => {
    const response = await gatewayEndpointFetch(
      { ...captured, url: baseUrl },
      `${baseUrl}${path}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${captured.token}`, ...activeLocaleHeaders() },
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  });
}

/** Inspect a saved machine without switching the active terminal's credentials. */
export async function loadRecordSessions(record: GatewayRecord): Promise<SessionsResponse> {
  if (isDemoRecord(record)) return demoSessions() as SessionsResponse;
  return withRecordBaseUrl(record, async (baseUrl) => {
    const init = {
      headers: { Authorization: `Bearer ${record.token}`, ...activeLocaleHeaders() },
    };
    async function read(path: string) {
      const url = `${baseUrl}${path}`;
      const response = await withRequestDedupe(
        inFlightGets,
        dedupeKey(url, init, REQUEST_TIMEOUT_MS),
        () =>
          record.transport === GATEWAY_TRANSPORT
            ? encryptedGatewayFetch(url, init, REQUEST_TIMEOUT_MS, { ...record, url: baseUrl })
            : fetchWithin(REQUEST_TIMEOUT_MS, 'Timed out waiting for the server.', url, init)
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }
    const sessions = (await read('/api/sessions')) as SessionsResponse;
    return sessions.sessions?.some((session) => typeof session.connected !== 'boolean')
      ? withSessionAvailability(sessions, (await read('/health')) as HealthResponse)
      : sessions;
  });
}

/**
 * Gateways that answered `/api/sessions/{id}/snapshot` with "no such route",
 * by base URL.
 *
 * The batched endpoint is not in `/health`'s capability list, so there is no
 * flag to read -- and guessing from `gatewayVersion` is exactly what `AGENTS.md`
 * forbids. What is left is the strongest form of detection available: ask the
 * endpoint. A gateway too old to have it says 404 once per launch and is
 * remembered here; every later call takes the three-request path with no probe
 * and no penalty.
 *
 * Keyed by base URL because the client is repointed per server, and this is a
 * fact about a machine rather than about the app. Deliberately not persisted: a
 * gateway upgraded under a running app gets its one 404 again on the next
 * launch, which is the cheapest possible way to notice the upgrade.
 */
const snapshotEndpointMissing = new Set<string>();

/**
 * Workspaces, tabs and panes in one round trip.
 *
 * Three of the requests the workspace prewarm made were these, asked
 * separately: `/workspaces`, `/tabs`, `/panes` against one session, in
 * parallel, each paying its own round trip on a radio where the round trip is
 * most of the cost. The gateway has answered all three at once since the
 * batched route landed, and nothing in the app was calling it.
 *
 * ## Whether the agents in that answer are used
 *
 * That depends on the gateway, and it asks rather than guesses --
 * `snapshotServesAgents` on the `/health` this call is handed. A gateway
 * announcing `session_snapshot` returns the same agent array `/agents` returns,
 * so the answer is complete and the entity load is one request. One that does
 * not announce it derives its agents from the panes and omits `instance_id` and
 * `target`, both of which are read straight off this array, so its agents come
 * back null and the caller asks `/agents` beside this. `lib/session-snapshot`
 * has the full reasoning.
 *
 * ## Asking versus probing for the route itself
 *
 * A gateway that announces the capability has the route by definition, so the
 * "have we 404'd here before" memory is neither consulted nor needed for it.
 * The probe is what is left for a gateway whose `/health` says nothing: those
 * are tried once, and a 404 is remembered per base URL so the three-call path
 * costs nothing extra afterwards.
 *
 * An announcement that does not hold -- a 404 from a gateway that claimed the
 * route, which means a proxy in front of it rather than the gateway itself --
 * is still remembered and still degrades to the old path, because the reader
 * losing their head start is not an acceptable answer to somebody's reverse
 * proxy.
 *
 * Null means the gateway has no such route -- not that it failed. Any other
 * failure is raised, because a session that genuinely cannot be read is not
 * something to paper over with three more requests.
 */
export async function loadSessionSnapshot(
  sessionId: string,
  health: HealthResponse | null | undefined
): Promise<SessionSnapshot | null> {
  const servesAgents = snapshotServesAgents(health);
  if (isDemoActive())
    return {
      workspaces: demoWorkspaces(),
      tabs: demoTabs(),
      panes: demoPanes(),
      agents: servesAgents ? demoAgents() : null,
    };
  const base = currentBaseUrl;
  if (!servesAgents && snapshotEndpointMissing.has(base)) return null;
  let answer: unknown;
  try {
    answer = await getApiSessionsBySessionIdSnapshot({ sessionId });
  } catch (error) {
    if (!endpointIsAbsent(error)) throw error;
    snapshotEndpointMissing.add(base);
    return null;
  }
  // The panes in this answer have been through the gateway's scrollback
  // observe/amend pass exactly as `/panes` has, so a pane's `scroll` says the
  // same thing here as there and pull-for-earlier is unaffected.
  return sessionSnapshotFromAnswer(answer, servesAgents);
}

/** Test seam: the miss set is process-wide, so suites must be able to reset it. */
export function forgetSnapshotEndpointSupport(): void {
  snapshotEndpointMissing.clear();
}

export async function loadWorkspaces(sessionId: string): Promise<HerdrEntity[]> {
  if (isDemoActive()) return demoWorkspaces();
  return normalizeGatewayEntities(await getApiSessionsBySessionIdWorkspaces({ sessionId }), [
    'workspaces',
    'items',
  ]);
}

export async function loadTabs(sessionId: string): Promise<HerdrEntity[]> {
  if (isDemoActive()) return demoTabs();
  return normalizeGatewayEntities(await getApiSessionsBySessionIdTabs({ sessionId }), [
    'tabs',
    'items',
  ]);
}

export async function loadPanes(sessionId: string): Promise<HerdrEntity[]> {
  if (isDemoActive()) return demoPanes();
  return normalizeGatewayEntities(await getApiSessionsBySessionIdPanes({ sessionId }), [
    'panes',
    'items',
  ]);
}

export async function loadAgents(sessionId: string): Promise<HerdrEntity[]> {
  if (isDemoActive()) return demoAgents();
  return normalizeGatewayEntities(await getApiSessionsBySessionIdAgents({ sessionId }), [
    'agents',
    'items',
  ]);
}

/**
 * The agent kinds this host will start, for the New Task picker.
 *
 * Raw rather than generated, like the asset and approval endpoints: the spawn
 * family is additive and not in the OpenAPI client yet. Server-wide rather than
 * per-session, because what is installed on a machine is a fact about the
 * machine.
 */
export async function loadAgentProfiles(
  /** Another paired computer, asked through its stored address. */
  endpoint?: GatewayEndpoint
): Promise<AgentProfile[]> {
  if (isDemoActive()) return agentProfilesFromResponse(demoAgentProfiles());

  const response = endpoint
    ? await gatewayEndpointFetch(
        endpoint,
        `${endpoint.url.replace(/\/$/, '')}/api/agents/catalog`,
        {
          headers: { Authorization: `Bearer ${endpoint.token}` },
        }
      )
    : await gatewayFetch(gatewayUrl('/api/agents/catalog'), {
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
export async function spawnBoundAgent(
  record: GatewayRecord,
  sessionId: string,
  request: AgentSpawnRequest,
  isCurrent: () => boolean
): Promise<SpawnedAgent> {
  assertDeliveryCurrent(isCurrent);
  const captured = { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined };
  const body = JSON.stringify(request);
  if (isDemoRecord(captured)) {
    const spawned = spawnedAgentFromResponse(demoSpawnedAgent({ ...request }));
    if (!spawned) throw new Error('The server did not say which panel it made.');
    return spawned;
  }
  let acknowledged: SpawnedAgent | undefined;
  try {
    return await withRecordBaseUrl(captured, async (baseUrl) => {
      assertDeliveryCurrent(isCurrent);
      const endpoint = { ...captured, url: baseUrl };
      if (!baseUrl || !endpoint.token) throw new Error('Not connected to a server.');
      const url = `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/agents/spawn`;
      const init: RequestInit = {
        method: 'POST',
        headers: {
          ...activeLocaleHeaders(),
          'Content-Type': 'application/json',
          Authorization: `Bearer ${endpoint.token}`,
        },
        body,
      };
      const response =
        endpoint.transport === GATEWAY_TRANSPORT
          ? await encryptedGatewayFetch(url, init, 60_000, endpoint, isCurrent)
          : await fetchWithin(60_000, 'Timed out waiting for the server.', url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const spawned = spawnedAgentFromResponse(await response.json());
      if (!spawned) throw new Error('The server did not say which panel it made.');
      // Once transmitted, retain the real outcome for history/recovery. The
      // caller still owns deciding whether its current UI may be updated.
      acknowledged = spawned;
      return spawned;
    });
  } catch (failure) {
    // A tunnel cleanup failure must not turn a known creation into an unknown
    // outcome that invites another spawn. Never retry either kind of failure.
    if (acknowledged) return acknowledged;
    throw failure;
  }
}

/**
 * `POST /api/tasks` on the selected computer. The gateway creates the agent
 * session and sends the goal before it answers, so this gets the spawn's
 * budget rather than the ordinary read's.
 */
export async function postLedgerTask(body: Record<string, string | string[]>): Promise<unknown> {
  const response = await gatewayFetchWithin(60_000, gatewayUrl('/api/tasks'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...gatewayAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Open task: ${response.status} ${await response.text()}`);
  return response.json();
}

export async function spawnAgent(
  sessionId: string,
  request: AgentSpawnRequest
): Promise<SpawnedAgent> {
  if (isDemoActive()) {
    const spawned = spawnedAgentFromResponse(demoSpawnedAgent(request));
    if (!spawned) throw new Error('The server did not say which panel it made.');
    return spawned;
  }

  // Starting an interactive agent can take 30 seconds before it is ready.
  // The ordinary 8-second read budget would abandon a successful creation.
  const response = await gatewayFetchWithin(
    60_000,
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
    (result as { root_pane?: Record<string, unknown>; pane?: Record<string, unknown> })
      ?.root_pane ??
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
  return normalizeGatewayEntity(
    await getApiSessionsBySessionIdPanesByPaneId({ sessionId, paneId })
  );
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
  return normalizeGatewayEntity(
    await getApiSessionsBySessionIdAgentsByTarget({ sessionId, target })
  );
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
  const serverId = configuredGatewayServerId();
  const value = await getApiSessionsBySessionIdPanesByPaneIdOutput(
    { sessionId, paneId },
    { source, lines: String(lineLimit), format }
  );
  noteGatewayGeneration(serverId, value);
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
    typeof response.text === 'string' ||
    typeof response.output === 'string' ||
    typeof response.content === 'string' ||
    Array.isArray(response.lines)
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
  const serverId = configuredGatewayServerId();
  const value = await getApiSessionsBySessionIdPanesByPaneIdOutput(
    { sessionId, paneId },
    { source, lines: String(lineLimit), format }
  );
  noteGatewayGeneration(serverId, value);
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
  const serverId = configuredGatewayServerId();
  const value = await getApiSessionsBySessionIdPanesByPaneIdOutput(
    { sessionId, paneId },
    {
      source,
      format,
      start: String(Math.max(0, Math.round(start))),
      end: String(Math.max(0, Math.round(end))),
    }
  );
  noteGatewayGeneration(serverId, value);
  return { output: extractPaneOutput(value), read: extractPaneReadEnvelope(value) };
}

/** `data` of a `/history` answer, as the pull needs it; `null` when it is not one. */
export function parseCapturedHistoryPage(value: unknown): CapturedHistoryPage | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.rows)) return null;
  return {
    rows: data.rows.filter((row): row is string => typeof row === 'string'),
    hasMore: data.has_more === true,
    nextBefore: typeof data.next_before === 'string' && data.next_before ? data.next_before : null,
    captureEpoch: data.capture_epoch ?? null,
    snapshotId: typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    generation: typeof data.generation === 'string' ? data.generation : null,
    availability: data.availability === 'not_captured' ? 'not_captured' : 'captured',
  };
}

/**
 * A page of the pane's captured history (`GET .../panes/{p}/history`):
 * output the gateway kept as it served it, oldest first, for the panes it
 * keeps (alternate-screen ones, and those without native scrollback). Never
 * throws: a refusal comes back with its status, for the pull to decide on.
 */
export async function readPaneHistory(
  sessionId: string,
  paneId: string,
  before: string | null,
  limit = 200
): Promise<CapturedHistoryRead> {
  if (isDemoActive()) {
    return {
      ok: true,
      page: {
        rows: [],
        hasMore: false,
        nextBefore: null,
        captureEpoch: null,
        availability: 'not_captured',
      },
    };
  }
  const query = new URLSearchParams({
    format: 'ansi',
    limit: String(Math.max(1, Math.min(500, limit))),
  });
  if (before) query.set('before', before);
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/history?${query.toString()}`;
  try {
    const res = await gatewayFetch(gatewayUrl(path), {
      method: 'GET',
      headers: gatewayAuthHeaders(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: new Error(`HTTP ${res.status}: ${body}`) };
    }
    const json = (await res.json()) as unknown;
    const data =
      json && typeof json === 'object' && 'data' in json ? (json as { data: unknown }).data : json;
    const page = parseCapturedHistoryPage(data);
    if (!page) {
      return { ok: false, status: 502, error: new Error('HTTP 502: unreadable history page') };
    }
    return { ok: true, page };
  } catch (error) {
    return { ok: false, status: null, error };
  }
}

/** Segment cursors stay on this endpoint, request shape and captured pairing. */
export async function readPaneHistorySegments(
  record: GatewayRecord,
  sessionId: string,
  paneId: string,
  before: string | null,
  limit = CAPTURED_HISTORY_PAGE_ROWS
): Promise<CapturedSegmentsRead> {
  const request = { sessionId, paneId, limit: Math.max(1, Math.min(500, Math.round(limit))) };
  const query = new URLSearchParams({ format: 'ansi', limit: String(request.limit) });
  if (before) query.set('before', before);
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}/history/segments?${query.toString()}`;
  try {
    const value = isDemoRecord(record)
      ? demoCapturedHistory(sessionId, paneId, before, request.limit)
      : await readGatewayRecordJson(record, path);
    const page = parseCapturedSegmentsPage(value, request);
    return page
      ? { ok: true, page }
      : { ok: false, status: 502, error: new Error('HTTP 502: unreadable captured history') };
  } catch (error) {
    const status =
      error instanceof Error ? Number(error.message.match(/^HTTP (\d{3})\b/)?.[1]) : NaN;
    return { ok: false, status: Number.isFinite(status) ? status : null, error };
  }
}

/**
 * The key row and slash commands for whatever this pane is running, resolved by
 * the gateway. Keeping the table on the gateway means a newly supported agent
 * arrives with a gateway update rather than an app release.
 */
export async function loadPaneShortcuts(sessionId: string, paneId: string): Promise<PaneShortcuts> {
  if (isDemoActive()) return demoShortcuts(paneId) as PaneShortcuts;
  const value = (await getApiSessionsBySessionIdPanesByPaneIdShortcuts({
    sessionId,
    paneId,
  })) as Partial<PaneShortcuts>;
  return {
    version: typeof value?.version === 'number' ? value.version : 0,
    profile: typeof value?.profile === 'string' ? value.profile : 'shell',
    keys: Array.isArray(value?.keys) ? value.keys.filter(isShortcutKey) : [],
    ...(Array.isArray(value?.keyActions)
      ? { keyActions: value.keyActions.filter(isShortcutKey) }
      : {}),
    commands: Array.isArray(value?.commands) ? value.commands.filter(isSlashCommand) : [],
    ...(typeof value?.keyboard?.extended === 'boolean'
      ? { keyboard: { extended: value.keyboard.extended } }
      : {}),
  };
}

/** Two shortcut answers say the same thing (the fields are plain JSON, in wire order). */
export function samePaneShortcuts(a: PaneShortcuts | null, b: PaneShortcuts | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
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

/** One immutable host and tunnel lease for the entire composed paste/ACK/Enter operation. */
export async function sendBoundPaneText(
  record: GatewayRecord,
  sessionId: string,
  paneId: string,
  text: string,
  submit: boolean,
  isCurrent: () => boolean
): Promise<void> {
  assertDeliveryCurrent(isCurrent);
  if (isDemoRecord(record)) return;
  const captured = { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined };
  await withRecordBaseUrl(captured, async (baseUrl) => {
    const endpoint = { ...captured, url: baseUrl };
    if (!baseUrl || !endpoint.token) throw new Error('Not connected to a server.');
    const panePath = `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/panes/${encodeURIComponent(paneId)}`;
    async function post(action: string, body: object) {
      assertDeliveryCurrent(isCurrent);
      const init = {
        method: 'POST',
        headers: {
          ...activeLocaleHeaders(),
          'Content-Type': 'application/json',
          Authorization: `Bearer ${endpoint.token}`,
        },
        body: JSON.stringify(body),
      };
      const response =
        endpoint.transport === GATEWAY_TRANSPORT
          ? await encryptedGatewayFetch(
              `${panePath}/${action}`,
              init,
              REQUEST_TIMEOUT_MS,
              endpoint,
              isCurrent
            )
          : await fetchWithin(
              REQUEST_TIMEOUT_MS,
              'Timed out waiting for the server.',
              `${panePath}/${action}`,
              init
            );
      // Consume the ACK before the next request and before releasing the tunnel.
      const reply = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${reply}`);
    }
    await deliverPasteAndEnter(
      () => post('send-text', { text }),
      submit ? () => post('send-keys', { keys: ['enter'] }) : null,
      isCurrent
    );
  });
}

export async function sendPaneKeys(
  sessionId: string,
  paneId: string,
  keys: string[]
): Promise<void> {
  if (isDemoActive()) return;
  await postApiSessionsBySessionIdPanesByPaneIdSendKeys({ sessionId, paneId }, { keys });
}

export async function sendAgentText(
  sessionId: string,
  target: string,
  text: string
): Promise<void> {
  if (isDemoActive()) return demoSendAgentText(target, text);
  await postApiSessionsBySessionIdAgentsByTargetSend({ sessionId, target }, { text });
}

export interface PairedDevice {
  id: string;
  name: string;
  paired_unix_ms: number;
  last_seen_unix_ms: number;
  /** True for the device making the request, which must not revoke itself by accident. */
  current: boolean;
  /** `gateway` for another of the owner's computers (a linked peer's login). */
  kind?: string;
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
  // Through the record's own forward when it is tunnelled -- never its stored
  // `url`, which for a loopback-only gateway names *this phone's* loopback.
  await withRecordBaseUrl(record, async (baseUrl) => {
    const headers = { Authorization: `Bearer ${record.token}` };
    const endpoint: GatewayEndpoint = {
      url: baseUrl,
      token: record.token,
      deviceId: record.deviceId,
      transportKey: record.transportKey,
      transport: record.transport,
    };
    const listResponse = await gatewayEndpointFetch(endpoint, `${baseUrl}/api/pairings`, {
      headers,
    });
    if (!listResponse.ok) {
      throw new Error(`HTTP ${listResponse.status}: ${await listResponse.text()}`);
    }

    const value = (await listResponse.json()) as { devices?: PairedDevice[] };
    const currentDevice = value.devices?.find((device) => device.current);
    if (!currentDevice) {
      throw new Error('Gateway did not identify this paired device.');
    }

    const revokeResponse = await gatewayEndpointFetch(
      endpoint,
      `${baseUrl}/api/pairings/${encodeURIComponent(currentDevice.id)}`,
      { method: 'DELETE', headers }
    );
    if (!revokeResponse.ok) {
      throw new Error(`HTTP ${revokeResponse.status}: ${await revokeResponse.text()}`);
    }
  });
}

async function writeDevicePushToken(
  record: GatewayRecord,
  method: 'POST' | 'DELETE',
  data: DevicePushTokenRegistration | { token: string }
): Promise<void> {
  if (isDemoRecord(record)) return;
  const captured = { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined };
  await withRecordBaseUrl(captured, async (baseUrl) => {
    const endpoint = { ...captured, url: baseUrl };
    const url = `${baseUrl}/api/devices/push-token`;
    const init = {
      method,
      headers: {
        ...activeLocaleHeaders(),
        Authorization: `Bearer ${captured.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    };
    // Explicit legacy HTTP and SSH keep their own credentials, even if the
    // shared client changes to an encrypted computer while token lookup waits.
    const response =
      captured.transport === GATEWAY_TRANSPORT
        ? await encryptedGatewayFetch(url, init, REQUEST_TIMEOUT_MS, endpoint)
        : await fetchWithin(REQUEST_TIMEOUT_MS, 'Timed out waiting for the server.', url, init);
    if (!response.ok) {
      const text = await response.text();
      noteRefusal({ url, token: captured.token }, response.status, text);
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    noteAccepted({ url, token: captured.token });
    const answer = (await response.json()) as { ok?: unknown } | null;
    if (answer?.ok !== true) throw new Error('HTTP 502: unreadable push registration receipt');
  });
}

export async function registerDevicePushToken(
  record: GatewayRecord,
  data: DevicePushTokenRegistration
): Promise<void> {
  await writeDevicePushToken(record, 'POST', data);
}

export async function unregisterDevicePushToken(
  record: GatewayRecord,
  token: string
): Promise<void> {
  await writeDevicePushToken(record, 'DELETE', { token });
}

export async function sendTestNotification(data: TestNotificationRequest = {}): Promise<void> {
  await postApiNotificationsTest(data);
}

export const gatewayTransport: GatewayTransport = {
  loadHealth,
  loadSessions,
  loadSessionSnapshot,
  loadWorkspaces,
  loadTabs,
  loadPanes,
  loadAgents,
};
