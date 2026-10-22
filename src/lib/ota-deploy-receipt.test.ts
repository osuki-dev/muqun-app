import { expect, test } from 'bun:test';
import { deployedOtaReleaseIds, prepareOtaNotesEnablement } from '../../scripts/publish-ota-notes';

const ios = '01a0586e-a286-7a74-a959-6d2c770b8793';
const android = '01a0586e-a286-7a74-a959-6d2c770b8794';
const both = `Deployment successful\n    iOS ID:     ${ios}\n    Android ID: ${android}\n`;

test('verified notes defer enablement and invalid notes leave the release disabled', async () => {
  let enabled = 0;
  const release = {
    id: ios,
    enabled: false,
    channel_id: 'preview-id',
    platform: 'ios',
    strategy: 'FINGERPRINT',
    fingerprint_hash: 'a'.repeat(64),
    message: 'Fixed',
    operation: 'DEPLOY',
    revision: 3,
  };
  const core = {
    getRelease: async () => release,
    findChannelByName: async () => ({ id: 'preview-id' }),
    updateReleasePolicy: async (input: { expectedRevision: number }) => {
      expect(input.expectedRevision).toBe(3);
      enabled++;
      return { release: { ...release, enabled: true } };
    },
  } as unknown as Parameters<typeof prepareOtaNotesEnablement>[0];
  const target = { channel: 'preview', platform: 'ios' as const, fingerprintHash: 'a'.repeat(64) };
  const api = {
    publish: async () => {},
    get: async () => ({ releaseId: ios, locale: 'en', markdown: 'Fixed' }),
  };
  const enable = await prepareOtaNotesEnablement(core, api, ios, { en: 'Fixed' }, target);
  expect(enabled).toBe(0);
  await expect(
    prepareOtaNotesEnablement(core, { ...api, get: async () => null }, ios, { en: 'Fixed' }, target)
  ).rejects.toThrow('readback failed');
  expect(enabled).toBe(0);
  await enable();
  expect(enabled).toBe(1);
});

test('official single and dual-platform receipts preserve the platform to release mapping', () => {
  expect(deployedOtaReleaseIds(`Deployment successful\n ID: ${android}`, ['android'])).toEqual([
    { platform: 'android', releaseId: android },
  ]);
  expect(deployedOtaReleaseIds(both, ['ios', 'android'])).toEqual([
    { platform: 'ios', releaseId: ios },
    { platform: 'android', releaseId: android },
  ]);
});

test('missing, duplicate and reused receipts stop publication instead of guessing a release', () => {
  for (const output of [
    '',
    both + both,
    both.replace(android, ios),
    both.replace(`    Android ID: ${android}\n`, ''),
  ]) {
    expect(() => deployedOtaReleaseIds(output, ['ios', 'android'])).toThrow();
  }
  expect(() => deployedOtaReleaseIds(both, ['android'])).toThrow();
});
