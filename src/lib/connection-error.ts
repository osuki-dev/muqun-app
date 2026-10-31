export type ConnectionErrorKind =
  | 'dns'
  | 'offline'
  | 'lost'
  | 'timeout'
  | 'certificate'
  | 'connection';

/** Classify the device's failed connection, never a refusal received from the server. */
export function classifyConnectionError(error: unknown): ConnectionErrorKind | null {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current = error;
  for (let depth = 0; current && depth < 6 && !seen.has(current); depth++) {
    seen.add(current);
    const shape = (typeof current === 'object' ? current : {}) as {
      message?: unknown;
      name?: unknown;
      code?: unknown;
      domain?: unknown;
      status?: unknown;
      cause?: unknown;
      userInfo?: { NSUnderlyingError?: unknown };
    };
    const message = typeof shape.message === 'string' ? shape.message : String(current);
    // An agent may discuss DNS or certificates in its own refusal. That is not
    // evidence that this device's connection to the Gateway failed.
    if (
      shape.code === 'agent_error' ||
      (typeof shape.status === 'number' && shape.status >= 100 && shape.status <= 599) ||
      /^(?:HTTP \d{3}\b|[^\n{]*:\s\d{3}(?:\s|$)|[^\n{]*\(\d{3}\)$)/.test(message) ||
      /"error"\s*:\s*\{[\s\S]*?"code"\s*:/.test(message)
    )
      return null;
    parts.push(message);
    if (typeof shape.name === 'string') parts.push(shape.name);
    if (typeof shape.code === 'string') parts.push(shape.code);
    if (
      shape.domain === 'NSURLErrorDomain' &&
      (typeof shape.code === 'number' || typeof shape.code === 'string')
    )
      parts.push(`NSURLErrorDomain Code=${shape.code}`);
    current = shape.cause ?? shape.userInfo?.NSUnderlyingError;
  }
  const text = parts.join('\n');
  const nsCode = Number(text.match(/NSURLErrorDomain[^\n]*?Code\s*=\s*(-\d+)/)?.[1] ?? 0);
  if (
    (nsCode <= -1200 && nsCode >= -1206) ||
    /ERR_(?:CERT_|SSL_)|SSLHandshakeException|CertificateException|CERT_HAS_EXPIRED|CERT_UNTRUSTED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT/i.test(
      text
    )
  )
    return 'certificate';
  if (
    nsCode === -1003 ||
    nsCode === -1006 ||
    /ERR_(?:NAME_NOT_RESOLVED|DNS_)|\b(?:ENOTFOUND|EAI_AGAIN)\b/i.test(text)
  )
    return 'dns';
  if (nsCode === -1009 || /ERR_INTERNET_DISCONNECTED|\bENETDOWN\b/i.test(text)) return 'offline';
  if (
    nsCode === -1005 ||
    /ERR_CONNECTION_(?:CLOSED|RESET)|ERR_NETWORK_CHANGED|\bECONNRESET\b/i.test(text)
  )
    return 'lost';
  if (
    nsCode === -1001 ||
    /ERR_(?:CONNECTION_)?TIMED_OUT|\bETIMEDOUT\b|timed\s*out|timeout/i.test(text)
  )
    return 'timeout';
  // URL loading also reports file, authentication and cancellation errors in
  // this domain. Unknown numeric codes must keep those original meanings.
  if (nsCode && nsCode !== -1004) return null;
  if (
    nsCode === -1004 ||
    /ERR_(?:CONNECTION_|ADDRESS_UNREACHABLE)|\b(?:ECONNREFUSED|ECONNABORTED|ENETUNREACH|EHOSTUNREACH)\b|NetworkError|network request failed|failed to fetch|fetch failed|network error|Cronet(?:UrlRequest| failed)/i.test(
      text
    )
  )
    return 'connection';
  return null;
}
