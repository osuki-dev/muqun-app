import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { DeliveryOwnership } from '@/lib/bound-delivery';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

import {
  annotateEntry,
  isBusy,
  markFailed,
  markUploaded,
  markUploading,
  removeEntry,
  requeue,
  stageFiles,
  startableIds,
  uploadedPaths,
  type AttachmentDestination,
} from '@/lib/attachment-queue';
import {
  compressPickedImage,
  describeUploadFailure,
  type PendingAttachment,
  type PickedFile,
} from '@/lib/attachments';
import { uploadAttachment } from '@/lib/gateway-client';

export type AttachmentUploadResult = { path?: string; name?: string };
export type CapturedAttachmentUpload = {
  isCurrent: () => boolean;
  upload: (
    record: GatewayRecord,
    source: PickedFile,
    entryId: string,
    isCurrent: () => boolean
  ) => Promise<AttachmentUploadResult>;
};
export interface AttachmentUploadOptions {
  /** Capture custom scope before a native picker opens, never when it returns. */
  captureUpload: () => CapturedAttachmentUpload;
  maxAttachments?: number;
  /** Task callers may ignore presentation-only record changes. Legacy callers stay strict. */
  sameRecord?: (a: GatewayRecord | null, b: GatewayRecord | null) => boolean;
}
export interface AttachmentUploads {
  attachments: PendingAttachment[];
  /** Stage files and start uploading them straight away. */
  addFiles: (files: PickedFile[]) => void;
  capturePicker: () => { addFiles: (files: PickedFile[]) => void; isCurrent: () => boolean };
  /** Re-send one file that failed, from its own tile. */
  retryUpload: (id: string) => void;
  removeAttachment: (id: string) => void;
  annotateAttachment: (
    id: string,
    caption: string,
    use: import('@/lib/attachment-queue').AttachmentUse
  ) => void;
  clearAttachments: () => void;
  /** Settled entries for opaque receipt callers; no fabricated filesystem paths. */
  captureEntries: () => PendingAttachment[];
  awaitEntries: (ids?: readonly string[]) => Promise<PendingAttachment[] | null>;
  restartUpload: (id: string) => void;
  /** Something is still queued or in flight, which Send has to wait out. */
  uploading: boolean;
  /**
   * Settle: resolve once nothing is queued or in flight, with every uploaded
   * path in strip order, or `null` if any staged file ended in error.
   */
  awaitUploads: () => Promise<string[] | null>;
}

/**
 * Owns the composer's staged attachments and their uploads.
 *
 * Picking is what starts the transfer. By the time Send is tapped the files are
 * usually already on the gateway, so the message goes out immediately instead
 * of holding the send button while several photos climb a home uplink -- which
 * is what the previous upload-on-send arrangement did.
 *
 * The ref is the store and the state is its render mirror. The upload pool
 * reads and writes entries between awaits, and a ref synchronised by an effect
 * would still be showing the previous pass by the time it did.
 */
export function useAttachmentUploads(
  record: GatewayRecord | null,
  /**
   * Where these files are being staged for, recorded on each entry.
   *
   * Nothing in the ordinary send path asserts it -- a composer message goes to
   * whatever terminal is in front of the reader, which is why this stack binds
   * at the record level and clears the queue when the record changes. It is
   * recorded so the stricter caller can check it: a task addressed to an
   * assistant is addressed to one pane on one connection, and
   * `assertAttachmentDestination` is what refuses a queue that has since drifted.
   *
   * Omitting it leaves entries unbound, and an unbound entry is refused by that
   * check rather than treated as bindable anywhere.
   */
  destination?: () => AttachmentDestination | undefined,
  options?: AttachmentUploadOptions
): AttachmentUploads {
  const sameRecord = options?.sameRecord;
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const mountedRef = useRef(true);
  const [ownership] = useState(() => new DeliveryOwnership());
  const destinations = useRef(
    new Map<
      string,
      {
        record: GatewayRecord;
        isCurrent: () => boolean;
        upload?: CapturedAttachmentUpload['upload'];
      }
    >()
  );
  // Sends parked until the queue drains. They are resolved by whichever upload
  // finishes last, so Send never polls.
  const waitingRef = useRef<((force?: boolean) => boolean)[]>([]);

  const releaseWaiters = useCallback((force = false) => {
    waitingRef.current = waitingRef.current.filter((resume) => !resume(force));
  }, []);

  const commit = useCallback(
    (next: PendingAttachment[]) => {
      attachmentsRef.current = next;
      if (mountedRef.current) setAttachments(next);
      releaseWaiters();
    },
    [releaseWaiters]
  );

  // The pump and an upload call each other, so each reaches the other through a
  // ref rather than through a dependency cycle neither could be declared in.
  const pumpRef = useRef<() => void>(() => {});

  const runUpload = useCallback(
    async (id: string) => {
      const entry = attachmentsRef.current.find((item) => item.id === id);
      const destination = destinations.current.get(id);
      if (!entry || !destination || !destination.isCurrent()) return;
      const isCurrent = () =>
        destination.isCurrent() && destinations.current.get(id) === destination;
      commit(markUploading(attachmentsRef.current, id));
      try {
        // Compression sits here rather than at picking so it costs one file at
        // a time, inside the slot the upload pool already handed out: a
        // nine-photo pick re-encodes three at a time instead of decoding nine
        // camera frames at once, and the strip is showing "uploading" while it
        // happens rather than freezing on the picker's return.
        const source = await compressPickedImage({
          uri: entry.localUri,
          name: entry.name,
          mime: entry.mime,
          size: entry.size,
          width: entry.width,
          height: entry.height,
        });
        if (!isCurrent()) return;
        const uploaded = destination.upload
          ? await destination.upload(destination.record, source, id, isCurrent)
          : await uploadAttachment(
              destination.record,
              source.uri,
              source.name,
              source.mime,
              isCurrent
            );
        if (isCurrent()) commit(markUploaded(attachmentsRef.current, id, uploaded));
      } catch (failure) {
        if (isCurrent())
          commit(markFailed(attachmentsRef.current, id, describeUploadFailure(failure)));
      }
      // A finished upload frees a slot, so whatever is still queued moves up.
      pumpRef.current();
    },
    [commit]
  );

  const pump = useCallback(() => {
    for (const id of startableIds(attachmentsRef.current)) void runUpload(id);
  }, [runUpload]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  useEffect(() => {
    mountedRef.current = true;
    const ownedDestinations = destinations.current;
    return () => {
      mountedRef.current = false;
      ownership.invalidate();
      ownedDestinations.clear();
      // The screen is gone and nothing will resolve these otherwise, so a send
      // that was waiting on the queue is let go rather than left hanging.
      releaseWaiters(true);
    };
  }, [releaseWaiters, ownership]);

  const capturePicker = useCallback(() => {
    const currentRecord = record;
    const selectedDestination = destination?.();
    const capturedDestination = selectedDestination ? { ...selectedDestination } : undefined;
    const capturedUpload = options?.captureUpload();
    const isCurrent = ownership.capture(
      () =>
        mountedRef.current &&
        currentRecord !== null &&
        (capturedUpload?.isCurrent() ?? true) &&
        (sameRecord
          ? sameRecord(useGatewayConnectionStore.getState().record, currentRecord)
          : useGatewayConnectionStore.getState().record === currentRecord)
    );
    const captured = currentRecord
      ? {
          ...currentRecord,
          sshTunnel: currentRecord.sshTunnel ? { ...currentRecord.sshTunnel } : undefined,
        }
      : null;
    return {
      isCurrent,
      addFiles: (files: PickedFile[]) => {
        if (!captured || !isCurrent() || files.length === 0) return;
        const previous = attachmentsRef.current;
        if (
          options?.maxAttachments !== undefined &&
          previous.length + files.length > options.maxAttachments
        )
          throw new Error('Too many attachments.');
        const next = stageFiles(previous, files, capturedDestination);
        for (const entry of next.slice(previous.length))
          destinations.current.set(entry.id, {
            record: captured,
            isCurrent,
            upload: capturedUpload?.upload,
          });
        commit(next);
        pump();
      },
    };
  }, [record, ownership, commit, pump, destination, options, sameRecord]);
  const addFiles = useCallback(
    (files: PickedFile[]) => capturePicker().addFiles(files),
    [capturePicker]
  );

  const retryUpload = useCallback(
    (id: string) => {
      commit(requeue(attachmentsRef.current, id));
      pump();
    },
    [commit, pump]
  );

  const removeAttachment = useCallback(
    (id: string) => {
      // Prevent transmission after compression and discard late replies. A
      // request already sent cannot be recalled or safely retried here.
      destinations.current.delete(id);
      commit(removeEntry(attachmentsRef.current, id));
      pump();
    },
    [commit, pump]
  );

  const clearAttachments = useCallback(() => {
    ownership.invalidate();
    destinations.current.clear();
    commit([]);
  }, [commit, ownership]);

  useFocusEffect(useCallback(() => () => clearAttachments(), [clearAttachments]));
  useEffect(
    () =>
      useGatewayConnectionStore.subscribe((next, previous) => {
        if (
          sameRecord ? !sameRecord(next.record, previous.record) : next.record !== previous.record
        )
          clearAttachments();
      }),
    [clearAttachments, sameRecord]
  );

  const awaitUploads = useCallback(
    () =>
      new Promise<string[] | null>((resolve) => {
        const settle = (force = false) => {
          if (!force && isBusy(attachmentsRef.current)) return false;
          resolve(uploadedPaths(attachmentsRef.current));
          return true;
        };
        if (!settle()) waitingRef.current.push(settle);
      }),
    []
  );
  const awaitEntries = useCallback(
    (ids?: readonly string[]) =>
      new Promise<PendingAttachment[] | null>((resolve) => {
        const selected = ids ? [...ids] : attachmentsRef.current.map((entry) => entry.id);
        const settle = (force = false) => {
          const entries = selected.map((id) =>
            attachmentsRef.current.find((entry) => entry.id === id)
          );
          if (entries.some((entry) => !entry || entry.status === 'error')) {
            resolve(null);
            return true;
          }
          const found = entries as PendingAttachment[];
          if (!force && isBusy(found)) return false;
          resolve(
            found.every((entry) => entry.status === 'done')
              ? found.map((entry) => ({ ...entry }))
              : null
          );
          return true;
        };
        if (!settle()) waitingRef.current.push(settle);
      }),
    []
  );
  const restartUpload = useCallback(
    (id: string) => {
      const entry = attachmentsRef.current.find((item) => item.id === id);
      if (!entry || entry.status === 'uploading' || entry.status === 'pending') return;
      commit(
        attachmentsRef.current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'pending' as const,
                remotePath: undefined,
                error: undefined,
                revision: (item.revision ?? 0) + 1,
                uploadVersion: (item.uploadVersion ?? 0) + 1,
              }
            : item
        )
      );
      pump();
    },
    [commit, pump]
  );

  return {
    attachments,
    awaitEntries,
    captureEntries: () => attachmentsRef.current.map((entry) => ({ ...entry })),
    restartUpload,
    addFiles,
    capturePicker,
    retryUpload,
    removeAttachment,
    annotateAttachment: (id, caption, use) =>
      commit(annotateEntry(attachmentsRef.current, id, { caption, use })),
    clearAttachments,
    uploading: isBusy(attachments),
    awaitUploads,
  };
}
