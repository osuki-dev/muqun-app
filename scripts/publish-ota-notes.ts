import type { HotUpdaterCoreApi } from '@hot-updater/plugin-core';
import { stripVTControlCharacters } from 'node:util';
import { OTA_RELEASE_ID, type OtaReleaseNote } from '../src/lib/ota-release-notes';

/** The pinned 1.0.0 CLI prints a full commit receipt; never infer a latest release. */
export function deployedOtaReleaseId(output: string): string {
  const receipts = [
    ...stripVTControlCharacters(output).matchAll(
      /Deployment successful[^\n]*\n[^\n]*\bID:\s*([0-9a-f-]{36})\b/g
    ),
  ];
  const id = receipts[0]?.[1];
  if (receipts.length !== 1 || !id || !OTA_RELEASE_ID.test(id))
    throw new Error('No unambiguous Hot Updater deployment receipt; do not retry automatically');
  return id;
}

type NotesApi = {
  publish(releaseId: string, expectedRevision: number, notes: unknown): Promise<void>;
  get(releaseId: string, locale: string): Promise<OtaReleaseNote | null>;
};

export async function publishOtaNotesAndEnable(
  core: Pick<HotUpdaterCoreApi, 'getRelease' | 'findChannelByName' | 'updateReleasePolicy'>,
  api: NotesApi,
  releaseId: string,
  notes: Record<string, string>,
  target: { channel: string; platform: 'android' | 'ios'; fingerprintHash: string }
) {
  const release = await core.getRelease(releaseId);
  const channel = await core.findChannelByName(target.channel);
  if (
    !release ||
    !channel ||
    release.id !== releaseId ||
    release.enabled ||
    release.channel_id !== channel.id ||
    release.platform !== target.platform ||
    release.strategy !== 'FINGERPRINT' ||
    release.fingerprint_hash !== target.fingerprintHash ||
    release.message !== notes.en ||
    release.operation !== 'DEPLOY'
  )
    throw new Error('Deployment receipt does not match the exact disabled release');
  await api.publish(releaseId, release.revision, notes);
  for (const [locale, markdown] of Object.entries(notes)) {
    const readback = await api.get(releaseId, locale);
    if (
      readback?.releaseId !== releaseId ||
      readback.locale !== locale ||
      readback.markdown !== markdown
    )
      throw new Error('OTA notes readback failed; release was not enabled');
  }
  // A concurrent release edit must fail, including an unexpected enablement.
  const enabled = await core.updateReleasePolicy({
    releaseId,
    expectedRevision: release.revision,
    patch: { enabled: true },
  });
  if (enabled.release?.id !== releaseId || !enabled.release.enabled)
    throw new Error('Enablement result is ambiguous; inspect this release before any retry');
}
