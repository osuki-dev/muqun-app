/**
 * The transcript routes on the wire: the paired Gateway's device
 * authentication and sealed transport, through the shared client.
 *
 * Refusals keep their Gateway error code (`TranscriptReadError`), because the
 * reader acts on them: a lost cursor starts again from the newest page, a
 * missing transcript is not retried.
 */

import {
  configuredGatewayServerId,
  gatewayAuthHeaders,
  gatewayFetch,
  gatewayUrl,
} from './gateway-client';
import { readApiError } from './gateway-refusal';
import {
  parseTranscriptHead,
  parseTranscriptPage,
  transcriptPath,
  TranscriptReadError,
  type TranscriptHead,
  type TranscriptPage,
  type TranscriptPageQuery,
  type TranscriptReaderSource,
  type TranscriptRoute,
} from './agent-transcripts';
import { asRecord } from './record';

async function readTranscript(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await gatewayFetch(gatewayUrl(path), {
    method: 'GET',
    headers: gatewayAuthHeaders(),
    signal,
  });
  if (response.ok) return response.json();
  const body = await response.text();
  const error = readApiError(body);
  throw new TranscriptReadError(
    error.code ?? `http_${response.status}`,
    response.status,
    error.message ?? `Transcript read failed: ${response.status}`
  );
}

export async function readAgentTranscriptPage(
  route: TranscriptRoute,
  query: TranscriptPageQuery,
  signal?: AbortSignal
): Promise<TranscriptPage> {
  const page = await readTranscript(
    transcriptPath(route, '', {
      limit: String(query.limit),
      ...(query.before ? { before: query.before } : {}),
    }),
    signal
  );
  return parseTranscriptPage(page);
}

export async function readAgentTranscriptHead(
  route: TranscriptRoute,
  signal?: AbortSignal
): Promise<TranscriptHead> {
  const answer = await readTranscript(transcriptPath(route, '/head', {}), signal);
  const envelope = asRecord(answer);
  const head = parseTranscriptHead(asRecord(envelope?.data) ?? envelope);
  if (!head) throw new Error('Invalid transcript head');
  return head;
}

/**
 * A reader source bound to one computer: a read that lands after the App has
 * moved to another computer is refused rather than drawn under the wrong pane.
 */
export function agentTranscriptSource(
  serverId: string,
  route: TranscriptRoute
): TranscriptReaderSource {
  const own = () => {
    if (configuredGatewayServerId() !== serverId) throw new Error('Transcript owner changed');
  };
  return {
    page: (query, signal) => {
      own();
      return readAgentTranscriptPage(route, query, signal);
    },
    head: (signal) => {
      own();
      return readAgentTranscriptHead(route, signal);
    },
  };
}
