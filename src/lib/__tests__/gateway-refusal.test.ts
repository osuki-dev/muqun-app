// The defect these hold down: a phone whose device record the gateway had lost
// was told `Gateway did not return an encrypted response (HTTP 403)`. The
// gateway had in fact said exactly what was wrong -- `invalid_token`, in
// plaintext, because its encrypted-transport middleware refuses before it can
// seal anything -- and the app threw the body away and reported the missing
// seal instead. Re-pairing was the fix, and nothing on screen said so.
//
// So: every code the gateway can emit before it seals is classified here, the
// pairing family is separated from the transient and the internal, and the
// three ways a body can tell us nothing (unknown code, not JSON, empty) all
// still land somewhere honest.
import { describe, expect, test } from 'bun:test';

import { classifyTransportRefusal, GatewayTransportRefusalError } from '../gateway-refusal';

/** The shape the gateway's `api_error` writes, verbatim. */
function apiError(code: string, message = 'refused'): string {
  return JSON.stringify({ error: { code, message } });
}

describe('the pairing family', () => {
  // The reported incident exactly: the device record was destroyed by a gateway
  // data-loss bug, so the device id in `X-Muqun-Device` matched nothing and the
  // lookup in `decrypt_transport_request` refused with 403 `invalid_token`.
  test('an unknown device id needs pairing again', () => {
    const refusal = classifyTransportRefusal(403, apiError('invalid_token', 'invalid token'));
    expect(refusal.reason).toBe('not-paired');
    expect(refusal.needsPairing).toBe(true);
    expect(refusal.retryable).toBe(false);
  });

  // Same code, different cause: the device is known but the token it presented
  // does not match the stored hash. Also only fixed by pairing again.
  test('a token that does not match the stored hash needs pairing again', () => {
    expect(classifyTransportRefusal(403, apiError('invalid_token')).needsPairing).toBe(true);
  });

  test('a device with no transport key needs pairing again', () => {
    const refusal = classifyTransportRefusal(
      426,
      apiError('device_repair_required', 'pair this device again to enable encrypted transport')
    );
    expect(refusal.reason).toBe('not-paired');
    expect(refusal.needsPairing).toBe(true);
  });

  // A 500 that still means "pair again": the stored key exists and will not
  // decode, which is the corrupt-key sibling of `device_repair_required`.
  // Retrying cannot rewrite a key; pairing can.
  test('an unusable stored transport key needs pairing again, and is not retried', () => {
    const refusal = classifyTransportRefusal(500, apiError('transport_key_unavailable'));
    expect(refusal.reason).toBe('stored-key-unusable');
    expect(refusal.needsPairing).toBe(true);
    expect(refusal.retryable).toBe(false);
  });
});

describe('refusals that pairing cannot fix', () => {
  // The reason status alone is not enough to classify with: this is a 403 like
  // `invalid_token`, and telling this reader to pair again would send them
  // through a whole flow that leaves them exactly where they started.
  test('a host the gateway does not answer to is not a pairing problem', () => {
    const refusal = classifyTransportRefusal(403, apiError('unknown_host'));
    expect(refusal.reason).toBe('unknown-host');
    expect(refusal.needsPairing).toBe(false);
    expect(refusal.retryable).toBe(false);
  });

  test('a sealed request that would not open is not a pairing problem', () => {
    const refusal = classifyTransportRefusal(403, apiError('invalid_envelope'));
    expect(refusal.reason).toBe('unreadable-request');
    expect(refusal.needsPairing).toBe(false);
  });

  test('a missing device header says only that the request was refused', () => {
    const refusal = classifyTransportRefusal(401, apiError('missing_transport_device'));
    expect(refusal.reason).toBe('refused');
    expect(refusal.needsPairing).toBe(false);
  });
});

describe('transient refusals', () => {
  test('a replayed nonce is worth another attempt', () => {
    const refusal = classifyTransportRefusal(
      409,
      apiError('replayed_request', 'request was already used')
    );
    expect(refusal.reason).toBe('already-handled');
    expect(refusal.retryable).toBe(true);
    expect(refusal.needsPairing).toBe(false);
  });

  test('the gateway failing against itself is worth another attempt', () => {
    for (const code of ['device_lock_failed', 'replay_cache_failed', 'response_too_large']) {
      const refusal = classifyTransportRefusal(500, apiError(code));
      expect(refusal.reason).toBe('server-fault');
      expect(refusal.retryable).toBe(true);
      expect(refusal.needsPairing).toBe(false);
    }
  });
});

describe('bodies that explain nothing', () => {
  // A gateway newer than this build. It must not become a pairing prompt just
  // because it happened to answer 403.
  test('an unknown code is refused, not diagnosed', () => {
    const refusal = classifyTransportRefusal(403, apiError('some_future_code'));
    expect(refusal.reason).toBe('refused');
    expect(refusal.needsPairing).toBe(false);
    expect(refusal.code).toBe('some_future_code');
    expect(refusal.detail).toBe('HTTP 403 · some_future_code');
  });

  test('an unknown 5xx code is still worth another attempt', () => {
    expect(classifyTransportRefusal(503, apiError('some_future_code')).retryable).toBe(true);
  });

  // What a captive portal answers.
  test('a body that is not JSON still classifies, carrying the status', () => {
    const refusal = classifyTransportRefusal(502, '<html><body>Bad Gateway</body></html>');
    expect(refusal.reason).toBe('refused');
    expect(refusal.code).toBeUndefined();
    expect(refusal.apiMessage).toBeUndefined();
    expect(refusal.detail).toBe('HTTP 502');
    expect(refusal.retryable).toBe(true);
  });

  test('an empty body still classifies, carrying the status', () => {
    const refusal = classifyTransportRefusal(403, '');
    expect(refusal.reason).toBe('refused');
    expect(refusal.code).toBeUndefined();
    expect(refusal.detail).toBe('HTTP 403');
    expect(refusal.needsPairing).toBe(false);
  });

  test('JSON that is not an api_error is not mined for a code', () => {
    expect(classifyTransportRefusal(400, '{"code":"invalid_token"}').code).toBeUndefined();
    expect(classifyTransportRefusal(400, '[]').code).toBeUndefined();
    expect(classifyTransportRefusal(400, 'null').code).toBeUndefined();
    expect(classifyTransportRefusal(400, '{"error":"invalid_token"}').code).toBeUndefined();
  });
});

describe('the diagnostic detail', () => {
  test('the gateway sentence is kept, but off to one side', () => {
    const refusal = classifyTransportRefusal(403, apiError('invalid_token', 'invalid token'));
    expect(refusal.apiMessage).toBe('invalid token');
    expect(refusal.detail).toBe('HTTP 403 · invalid_token');
  });

  test('the thrown error keeps the status and the body', () => {
    const error = new GatewayTransportRefusalError(403, apiError('invalid_token'));
    expect(error.status).toBe(403);
    expect(classifyTransportRefusal(error.status, error.body).reason).toBe('not-paired');
    expect(error.message.startsWith('HTTP 403: ')).toBe(true);
  });

  // A misaddressed proxy answers a whole HTML page, and `error.message` is what
  // ends up in logs and toasts.
  test('an enormous body does not ride around inside the error message', () => {
    const error = new GatewayTransportRefusalError(502, 'x'.repeat(50_000));
    expect(error.body.length).toBe(1000);
    expect(error.message.length).toBeLessThan(1100);
  });
});
