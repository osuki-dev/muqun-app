import { describe, expect, test } from 'bun:test';

import {
  agentSocketFrameAad,
  AgentSocketProtocolError,
  deriveAgentSocketKeys,
  parseAgentSocketFrame,
  PlainAgentSocketCodec,
  SealedAgentSocketCodec,
  serializeAgentSocketFrame,
} from '../agent-socket-codec';
import { streamRecordNonce } from '../sse-record';
import { GatewayFrameSealer, socketTestCrypto } from './socket-seal';

const material = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const connectionId = 'conn-fixture';
const requestNonce = 'req-nonce-fixture';
const requestAad = 'GET /api/ws';

function expectProtocolError(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught instanceof AgentSocketProtocolError).toBe(true);
}

function codec(): SealedAgentSocketCodec {
  return new SealedAgentSocketCodec({
    crypto: socketTestCrypto,
    material,
    requestAad,
    requestNonce,
  });
}

describe('the vector documented in the gateway agent API', () => {
  const keys = deriveAgentSocketKeys(socketTestCrypto, material, connectionId, requestNonce);

  test('derives both direction keys', () => {
    expect(Buffer.from(keys.server).toString('hex')).toBe(
      'b2154a41fe5ff8e4d2d48e2452f5ae1ac7db5dde927a6a836cff95affd0617c4'
    );
    expect(Buffer.from(keys.client).toString('hex')).toBe(
      '9bce31da785ad2c07b7a1778afc4c1e1ae044ffd3628e917830c069a07065f1d'
    );
  });

  test('server seq 3 pong', () => {
    const aad = agentSocketFrameAad(requestAad, connectionId, 3);
    expect(aad).toBe('GET /api/ws\nconn-fixture\n3');
    expect(socketTestCrypto.seal(keys.server, streamRecordNonce(3), aad, '{"t":"pong"}')).toBe(
      'OEEP-5TQCD9LdcHsM3giEcyEyokt8XYFIAIRqw'
    );
    expect(
      socketTestCrypto.open(
        keys.server,
        streamRecordNonce(3),
        aad,
        'OEEP-5TQCD9LdcHsM3giEcyEyokt8XYFIAIRqw'
      )
    ).toBe('{"t":"pong"}');
  });

  test('client seq 0 ping, as the codec seals it', () => {
    const sealed = codec();
    // The client direction needs the connection id, which only the first
    // server frame carries.
    const gateway = new GatewayFrameSealer(material, connectionId, requestNonce);
    sealed.openServer(gateway.seal('{"t":"hello","connection_id":"conn-fixture","protocol":1}'));
    expect(JSON.parse(sealed.sealClient('{"t":"ping"}'))).toEqual({
      seq: 0,
      c: 'V6OgtEmv9QE7CX2BmkcpLomsJYuJgW0aMASrVA',
    });
  });
});

describe('SealedAgentSocketCodec', () => {
  test('opens frames in order and names the connection from the first', () => {
    const sealed = codec();
    const gateway = new GatewayFrameSealer(material, connectionId, requestNonce);
    expect(sealed.connectionId).toBeNull();
    expect(sealed.openServer(gateway.seal('{"t":"hello"}'))).toBe('{"t":"hello"}');
    expect(sealed.connectionId).toBe(connectionId);
    expect(sealed.openServer(gateway.seal('{"t":"pong"}'))).toBe('{"t":"pong"}');
  });

  test('client frames count their own seq and open on the gateway side', () => {
    const sealed = codec();
    const gateway = new GatewayFrameSealer(material, connectionId, requestNonce);
    sealed.openServer(gateway.seal('{"t":"hello"}'));
    sealed.openServer(gateway.seal('{"t":"pong"}'));
    expect(gateway.open(sealed.sealClient('{"t":"subscribe","asid":"a"}'))).toBe(
      '{"t":"subscribe","asid":"a"}'
    );
    expect(gateway.open(sealed.sealClient('{"t":"ping"}'))).toBe('{"t":"ping"}');
  });

  test('refuses to send before the connection is known', () => {
    expectProtocolError(() => codec().sealClient('{"t":"ping"}'));
  });

  test('a gap is refused', () => {
    const sealed = codec();
    const gateway = new GatewayFrameSealer(material, connectionId, requestNonce);
    sealed.openServer(gateway.seal('{"t":"hello"}'));
    gateway.skip();
    expectProtocolError(() => sealed.openServer(gateway.seal('{"t":"pong"}')));
  });

  test('a replayed seq is refused', () => {
    const sealed = codec();
    const gateway = new GatewayFrameSealer(material, connectionId, requestNonce);
    const hello = gateway.seal('{"t":"hello"}');
    sealed.openServer(hello);
    expectProtocolError(() => sealed.openServer(hello));
  });

  test('a frame whose wire seq lies about its nonce fails authentication', () => {
    const sealed = codec();
    const gateway = new GatewayFrameSealer(material, connectionId, requestNonce);
    sealed.openServer(gateway.seal('{"t":"hello"}'));
    gateway.skip();
    expect(() => sealed.openServer(gateway.seal('{"t":"pong"}', 1))).toThrow(
      'A socket frame failed authentication.'
    );
  });

  test('a frame from another upgrade does not open', () => {
    const sealed = codec();
    const other = new GatewayFrameSealer(material, connectionId, 'another-nonce');
    expectProtocolError(() => sealed.openServer(other.seal('{"t":"hello"}')));
  });

  test('the first frame must name its connection', () => {
    const sealed = codec();
    const gateway = new GatewayFrameSealer(material, connectionId, requestNonce);
    const wire = JSON.parse(gateway.seal('{"t":"hello"}')) as Record<string, unknown>;
    delete wire.cid;
    expectProtocolError(() => sealed.openServer(JSON.stringify(wire)));
  });

  test('a plaintext frame on a sealed connection fails closed', () => {
    expectProtocolError(() =>
      codec().openServer('{"t":"hello","connection_id":"conn-fixture","protocol":1}')
    );
  });
});

describe('PlainAgentSocketCodec', () => {
  test('passes frames through both ways', () => {
    const plain = new PlainAgentSocketCodec();
    expect(plain.openServer('{"t":"pong"}')).toBe('{"t":"pong"}');
    expect(plain.sealClient('{"t":"ping"}')).toBe('{"t":"ping"}');
    expect(plain.connectionId).toBeNull();
  });
});

describe('frames', () => {
  test('parses every server frame', () => {
    expect(parseAgentSocketFrame('{"t":"hello","connection_id":"c","protocol":1}')).toEqual({
      t: 'hello',
      connectionId: 'c',
      protocol: 1,
    });
    expect(parseAgentSocketFrame('{"t":"subscribed","asid":"ses_1"}')).toEqual({
      t: 'subscribed',
      asid: 'ses_1',
    });
    expect(parseAgentSocketFrame('{"t":"subscribed","all":true}')).toEqual({
      t: 'subscribed',
      all: true,
    });
    expect(parseAgentSocketFrame('{"t":"resync","asid":""}')).toEqual({ t: 'resync', asid: '' });
    expect(parseAgentSocketFrame('{"t":"pong"}')).toEqual({ t: 'pong' });
    expect(parseAgentSocketFrame('{"t":"error","code":"superseded"}')).toEqual({
      t: 'error',
      code: 'superseded',
    });
  });

  test('an event carries the SSE payload through the SSE parser', () => {
    const frame = parseAgentSocketFrame(
      '{"t":"event","asid":"ses_1","seq":12,"event":"agent.status.changed","data":{"type":"agent.status.changed","asid":"ses_1","seq":12,"status":"busy"}}'
    );
    expect(frame).toMatchObject({
      t: 'event',
      asid: 'ses_1',
      seq: 12,
      event: { type: 'agent.status.changed', asid: 'ses_1', seq: 12, status: 'busy' },
    });
  });

  test('an unknown frame is ignored and rubbish throws', () => {
    expect(parseAgentSocketFrame('{"t":"request","id":1}')).toBeNull();
    expectProtocolError(() => parseAgentSocketFrame('not json'));
  });

  test('serialises client frames as the gateway reads them', () => {
    expect(serializeAgentSocketFrame({ t: 'subscribe', asid: 'ses_1' })).toBe(
      '{"t":"subscribe","asid":"ses_1"}'
    );
    expect(serializeAgentSocketFrame({ t: 'subscribe_all' })).toBe('{"t":"subscribe_all"}');
    expect(serializeAgentSocketFrame({ t: 'ping' })).toBe('{"t":"ping"}');
  });
});
