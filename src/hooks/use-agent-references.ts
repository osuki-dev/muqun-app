import { useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import {
  addAgentImageReference,
  beginAgentReferenceUpload,
  createAgentReferenceDraft,
  editAgentImageReference,
  finishAgentReferenceUpload,
  rebindAgentReferenceDraft,
  removeAgentImageReference,
  type AgentReferenceDraft,
  type AgentReferenceScope,
  type AgentReferenceUse,
} from '@/lib/agent-command-references';
import { compressPickedImage, nextAttachmentId, pickPhotoLibrary } from '@/lib/attachments';
import { assertDeliveryCurrent } from '@/lib/bound-delivery';
import { uploadAttachment } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';

/** Selection and captions remain local until the reviewed task is explicitly sent. */
export function useAgentReferences(
  scope: AgentReferenceScope,
  initial: AgentReferenceDraft | undefined,
  capture: () => () => boolean
) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(() =>
    initial ? rebindAgentReferenceDraft(initial, scope) : createAgentReferenceDraft(scope)
  );
  const current = useRef(draft);
  const revision = useRef(Symbol('reference-selection'));
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  function update(next: AgentReferenceDraft) {
    current.current = next;
    setDraft(next);
  }
  async function pick() {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    setError(null);
    const isCurrent = capture();
    try {
      const files = await pickPhotoLibrary();
      assertDeliveryCurrent(isCurrent);
      if (!files.length) return;
      let next = current.current;
      for (const file of files) {
        next = addAgentImageReference(next, nextAttachmentId(), file);
      }
      revision.current = Symbol('reference-selection');
      update(next);
    } catch {
      if (isCurrent())
        setError(t`Could not add images. Choose up to nine images, each under 10 MB.`);
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  }
  async function prepare(record: GatewayRecord, destinationCurrent: () => boolean) {
    const selection = revision.current;
    const isCurrent = () => selection === revision.current && destinationCurrent();
    assertDeliveryCurrent(isCurrent);
    // Every explicit send re-confirms the destination. Receipts never survive
    // a retry/reconnect and cannot refer to a different machine's filesystem.
    let prepared = rebindAgentReferenceDraft(current.current, scope);
    update(prepared);
    for (const image of prepared.images) {
      assertDeliveryCurrent(isCurrent);
      const started = beginAgentReferenceUpload(prepared, image.id, scope);
      prepared = started.draft;
      update(prepared);
      try {
        const file = await compressPickedImage(image.file);
        assertDeliveryCurrent(isCurrent);
        const receipt = await uploadAttachment(record, file.uri, file.name, file.mime, isCurrent);
        assertDeliveryCurrent(isCurrent);
        prepared = finishAgentReferenceUpload(prepared, started.ticket, receipt, scope);
        if (prepared.images.find((entry) => entry.id === image.id)?.upload?.status !== 'uploaded')
          throw new Error('Invalid upload receipt');
        update(prepared);
      } catch (failure) {
        const pending = prepared;
        prepared = finishAgentReferenceUpload(prepared, started.ticket, null, scope);
        // Keep this editor retryable if it regains focus. The owner-checked
        // draft store rejects its autosave after another editor takes over.
        // Never overwrite a newer local selection or upload attempt.
        if (selection === revision.current && current.current === pending) update(prepared);
        throw failure;
      }
    }
    return prepared;
  }
  return {
    draft,
    picking,
    error,
    pick,
    prepare,
    snapshot: () => current.current,
    captureRevision: () => {
      const selection = revision.current;
      return () => selection === revision.current;
    },
    clear: () => {
      revision.current = Symbol('reference-selection');
      update(createAgentReferenceDraft(scope));
    },
    remove: (id: string) => {
      revision.current = Symbol('reference-selection');
      update(removeAgentImageReference(current.current, id));
    },
    edit: (id: string, caption: string, use: AgentReferenceUse) => {
      revision.current = Symbol('reference-selection');
      update(editAgentImageReference(current.current, id, caption, use));
    },
  };
}
