/**
 * Node primitives standing in for quick-crypto in the event-socket tests, and
 * the gateway's side of a sealed connection so the app is tested against
 * frames it did not itself produce.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';

import {
  agentSocketFrameAad,
  deriveAgentSocketKeys,
  type SocketFrameCrypto,
} from '../agent-socket-codec';
import { streamRecordNonce } from '../sse-record';
import { hkdfSha256 } from './stream-seal';

export const socketTestCrypto: SocketFrameCrypto = {
  hkdf: (material, salt, info) => hkdfSha256(material, salt, info),
  seal(key, nonce, aad, plaintext) {
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    return Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64url');
  },
  open(key, nonce, aad, ciphertext) {
    const sealed = Buffer.from(ciphertext, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    return Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - 16)),
      decipher.final(),
    ]).toString('utf8');
  },
};

/** The gateway's `SealedCodec`: seals server frames, opens client ones, both in order. */
export class GatewayFrameSealer {
  private readonly keys;
  private sendSeq = 0;
  private recvSeq = 0;

  constructor(
    material: Uint8Array,
    private readonly connectionId: string,
    requestNonce: string,
    private readonly requestAad = 'GET /api/ws'
  ) {
    this.keys = deriveAgentSocketKeys(socketTestCrypto, material, connectionId, requestNonce);
  }

  /** One server frame's wire text, with an optional override of the seq on the wire. */
  seal(plaintext: string, wireSeq?: number): string {
    const seq = this.sendSeq;
    this.sendSeq += 1;
    const c = socketTestCrypto.seal(
      this.keys.server,
      streamRecordNonce(seq),
      agentSocketFrameAad(this.requestAad, this.connectionId, seq),
      plaintext
    );
    const onWire = wireSeq ?? seq;
    return seq === 0
      ? JSON.stringify({ seq: onWire, cid: this.connectionId, c })
      : JSON.stringify({ seq: onWire, c });
  }

  /** Skip a server seq, as a dropped frame would. */
  skip(): void {
    this.sendSeq += 1;
  }

  open(wire: string): string {
    const frame = JSON.parse(wire) as { seq: number; c: string };
    if (frame.seq !== this.recvSeq) throw new Error('out_of_order');
    const plaintext = socketTestCrypto.open(
      this.keys.client,
      streamRecordNonce(frame.seq),
      agentSocketFrameAad(this.requestAad, this.connectionId, frame.seq),
      frame.c
    );
    this.recvSeq += 1;
    return plaintext;
  }
}
