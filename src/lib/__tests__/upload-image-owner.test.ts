import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';

function harness(encrypted: boolean, changeAt?: 'negotiation' | 'response' | 'body') {
  let serverId = 'source';
  let connectionKey = 'pairing';
  let requests = 0;
  const owner = { serverId, connectionKey };
  const read = runInNewContext(
    transpile(
      `${declaration('src/lib/gateway-client.ts', 'readUploadImageSource')}\nreadUploadImageSource`
    ),
    {
      configuredGatewayServerId: () => serverId,
      gatewayImageConnectionKey: () => connectionKey,
      uploadImageSource: (name: string) =>
        encrypted ? null : { uri: `https://source.invalid/api/uploads/${name}` },
      uploadContentUrl: (name: string) => `https://source.invalid/api/uploads/${name}`,
      gatewayAuthHeaders: () => ({ Authorization: 'Bearer fixture' }),
      IMAGE_DOWNLOAD_TIMEOUT_MS: 1000,
      QuickCrypto: { Buffer },
      encryptedGatewayFetch: async (
        _url: string,
        _init: unknown,
        _timeout: number,
        _endpoint: unknown,
        isCurrent: () => boolean
      ) => {
        if (changeAt === 'negotiation') serverId = 'other';
        if (!isCurrent()) throw new Error('different Gateway');
        requests++;
        if (changeAt === 'response') serverId = 'other';
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          arrayBuffer: async () => {
            if (changeAt === 'body') connectionKey = 'repaired';
            return new Uint8Array([137, 80, 78, 71]).buffer;
          },
        };
      },
    }
  ) as (name: string, options?: { owner?: typeof owner }) => Promise<{ uri: string }>;
  return {
    owner,
    read,
    requests: () => requests,
    changeServer: () => {
      serverId = 'other';
    },
    changePairing: () => {
      connectionKey = 'repaired';
    },
  };
}

test('deferred upload image pages refuse another Gateway or changed pairing before reading', async () => {
  for (const encrypted of [false, true]) {
    for (const change of ['server', 'pairing']) {
      const run = harness(encrypted);
      if (change === 'server') run.changeServer();
      else run.changePairing();
      await expect(run.read('fixture.png', { owner: run.owner })).rejects.toThrow(
        'different Gateway'
      );
      expect(run.requests()).toBe(0);
    }
  }
});

test('upload image ownership is checked during negotiation and after response/body reads', async () => {
  for (const stage of ['negotiation', 'response', 'body'] as const) {
    const run = harness(true, stage);
    await expect(run.read('fixture.png', { owner: run.owner })).rejects.toThrow(
      'different Gateway'
    );
    expect(run.requests()).toBe(stage === 'negotiation' ? 0 : 1);
  }
});

test('an unchanged upload owner retains direct and encrypted image loading', async () => {
  const plain = harness(false);
  expect((await plain.read('fixture.png', { owner: plain.owner })).uri).toBe(
    'https://source.invalid/api/uploads/fixture.png'
  );
  const encrypted = harness(true);
  expect((await encrypted.read('fixture.png', { owner: encrypted.owner })).uri).toBe(
    'data:image/png;base64,iVBORw=='
  );
});
