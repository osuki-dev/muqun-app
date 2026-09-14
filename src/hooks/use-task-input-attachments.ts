import { DEMO_PAIRING_SERVER_ID } from '@/lib/pairing';
import { pickDemoWorkInput } from '@/lib/demo-work-inputs';
import { workPairingFingerprint } from '@/lib/work-controller-cache';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import QuickCrypto from 'react-native-quick-crypto';
import { useAttachmentUploads } from './use-attachment-uploads';
import { MAX_ATTACHMENTS_PER_PICK } from '@/lib/attachment-queue';
import { uploadBoundTaskInput, readBoundTaskInputReceipt } from '@/lib/gateway-client';
import { utf8Bytes } from '@/lib/multipart';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  TaskInputOwnership,
  sameTaskInputPairing,
  TaskInputUploadJournal,
  TaskInputProjectResolutionError,
  captureTaskInputEntries,
  sameTaskInputVersion,
  taskInputRefs,
  taskInputScopeKey,
  type TaskInputEntrySnapshot,
  type TaskInputScope,
  type TaskInputUpload,
  type TaskInputReceiptReader,
} from '@/lib/task-inputs';

/** Opaque task receipts reuse the upload pool, never the legacy remotePath channel. */
export function useTaskInputAttachments(
  record: GatewayRecord | null,
  scope: TaskInputScope | null,
  upload: TaskInputUpload = uploadBoundTaskInput,
  readReceipt: TaskInputReceiptReader = readBoundTaskInputReceipt
) {
  const [owner] = useState(() => new TaskInputOwnership());
  const journal = useMemo(
    () =>
      new TaskInputUploadJournal(
        () => QuickCrypto.randomBytes(24).toString('hex'),
        upload,
        readReceipt
      ),
    [upload, readReceipt]
  );
  const [projectResolution, setProjectResolution] = useState<{
    requestedProject: string;
    canonicalProject: string;
  } | null>(null);
  const scopeKey = scope ? taskInputScopeKey(scope) : '';
  const pairingKey = record
    ? workPairingFingerprint(record, (value) =>
        QuickCrypto.createHash('sha256').update(value).digest('hex')
      )
    : '';
  const options = useMemo(
    () => ({
      maxAttachments: MAX_ATTACHMENTS_PER_PICK,
      sameRecord: sameTaskInputPairing,
      captureUpload: () => {
        const captured = scope ? { ...scope } : null;
        const isCurrent = captured ? owner.capture(captured) : () => false;
        return {
          isCurrent,
          upload: async (
            record: GatewayRecord,
            file: import('@/lib/attachment-queue').PickedFile,
            entryId: string,
            current: () => boolean
          ) => {
            if (!captured || !current() || !isCurrent())
              throw new Error('Input destination changed.');
            try {
              const receipt = await journal.run(entryId, record, captured, file, {
                isCurrent: () => current() && isCurrent(),
              });
              return { name: receipt.name };
            } catch (error) {
              if (current() && isCurrent() && error instanceof TaskInputProjectResolutionError)
                setProjectResolution({
                  requestedProject: error.requestedProject,
                  canonicalProject: error.receipt.repo_path,
                });
              throw error;
            }
          },
        };
      },
    }),
    [scope, owner, journal]
  );
  const queue = useAttachmentUploads(record, undefined, options);
  const clearQueue = queue.clearAttachments;
  useLayoutEffect(() => {
    owner.invalidate();
    owner.update(scope);
    journal.clear();
    clearQueue();
    setProjectResolution(null);
    return () => {
      owner.invalidate();
    };
    // Scope identity is semantic, not a newly allocated render object.
    // oxlint-disable-next-line react/exhaustive-deps -- scopeKey contains every scope field
  }, [scopeKey, pairingKey, owner, journal, clearQueue]);

  /** Call synchronously at the commit point, before capability reads or any other await. */
  const captureCommit = useCallback(() => {
    if (!scope) throw new Error('Task attachments are unavailable.');
    const captured = { ...scope };
    const snapshots = captureTaskInputEntries(queue.captureEntries());
    const scopeCurrent = owner.capture(captured);
    const queueCurrent = queue.capturePicker().isCurrent;
    const isCurrent = () => scopeCurrent() && queueCurrent();
    return {
      isCurrent,
      settle: async () => {
        const entries = await queue.awaitEntries(snapshots.map((entry) => entry.id));
        if (!isCurrent() || !entries) throw new Error('Input files are not ready.');
        const uploaded = snapshots.map((snapshot, index) => {
          const current = entries[index];
          if (
            snapshot.localUri !== current.localUri ||
            snapshot.uploadVersion !== (current.uploadVersion ?? 0)
          )
            throw new Error('Input file version changed.');
          const receipt = journal.receipt(snapshot.id);
          if (!receipt) throw new Error('Input receipt is unavailable.');
          return receipt;
        });
        return {
          inputRefs: taskInputRefs(uploaded, captured).map((ref, index) => ({
            ...ref,
            caption: snapshots[index].caption,
            use: snapshots[index].use,
          })),
          snapshots,
          isCurrent,
        };
      },
    };
  }, [scope, owner, queue, journal]);
  const removeAttachment = (id: string) => {
    queue.removeAttachment(id);
    journal.remove(id);
  };
  return {
    ...queue,
    pickDemoFiles: record?.serverId === DEMO_PAIRING_SERVER_ID ? pickDemoWorkInput : undefined,
    projectResolution,
    removeAttachment,
    annotateAttachment: (id: string, caption: string, use: 'reference-only' | 'may-include') => {
      if (utf8Bytes(caption).length > 4096) throw new Error('Reference caption is too long.');
      queue.annotateAttachment(id, caption, use);
    },
    captureCommit,
    awaitInputRefs: () => captureCommit().settle(),
    isExpired: (id: string) => (journal.receipt(id)?.expires_at_ms ?? Infinity) <= Date.now(),
    /** Explicit user action creates a new upload key only for a known expired receipt. */
    reuploadExpired: (id: string) => {
      if (journal.renewExpired(id)) queue.restartUpload(id);
    },
    /** New annotations, replacement bytes and later files survive an earlier acknowledgment. */
    clearSubmitted: (snapshots: readonly TaskInputEntrySnapshot[]) => {
      const current = queue.captureEntries();
      for (const snapshot of snapshots) {
        const entry = current.find((item) => item.id === snapshot.id);
        if (entry && sameTaskInputVersion(snapshot, entry)) removeAttachment(entry.id);
      }
    },
  };
}
