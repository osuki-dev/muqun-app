import type { HotUpdaterCoreApi } from '@hot-updater/plugin-core';
import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { inspect, stripVTControlCharacters } from 'node:util';
import { OTA_RELEASE_ID, type OtaReleaseNote } from '../src/lib/ota-release-notes';

/** Native archives store independent platform fingerprints; never accept a root hash. */
export function nativeOtaFingerprintHash(input: unknown, platform: 'android' | 'ios'): string {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !Object.hasOwn(input, platform)
  )
    throw new Error('Missing native release fingerprint for the selected platform');
  const selected: unknown = (input as Record<string, unknown>)[platform];
  if (!selected || typeof selected !== 'object' || Array.isArray(selected))
    throw new Error('Invalid native release fingerprint for the selected platform');
  const { sources, hash } = selected as Record<string, unknown>;
  if (!Array.isArray(sources) || typeof hash !== 'string' || !/^[a-f0-9]{32,128}$/i.test(hash))
    throw new Error('Invalid native release fingerprint for the selected platform');
  return hash;
}

/** Arbitrary provider diagnostics belong only in the operator's private log. */
export function recordOtaPublicationFailure(logPath: string, phase: string, error: unknown) {
  try {
    appendFileSync(logPath, `\nOTA failure during ${phase}:\n${inspect(error)}\n`, { mode: 0o600 });
  } catch {
    // A logging error must not expose or replace the original provider failure.
  }
}

/** Cleanup must not reject outside the safe reporting boundary or delete failed-run evidence. */
export async function finishOtaPublication(
  workspace: string,
  succeeded: boolean,
  cleanup: readonly (() => Promise<unknown>)[]
): Promise<boolean> {
  for (const operation of cleanup) {
    try {
      await operation();
    } catch (error) {
      succeeded = false;
      recordOtaPublicationFailure(join(workspace, 'deploy.log'), 'server cleanup', error);
    }
  }
  if (succeeded) {
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
      succeeded = false;
      recordOtaPublicationFailure(join(workspace, 'deploy.log'), 'private log cleanup', error);
    }
  }
  return succeeded;
}

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
