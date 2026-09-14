import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { readBoundWorkArtifactPreview } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { WorkDetail } from '@/lib/work-api';
import type { WorkArtifactPreview } from '@/lib/work-artifacts';

export function useWorkArtifactPreview(
  record: GatewayRecord,
  sessionId: string,
  detail: WorkDetail | null,
  resultId: string | null
) {
  const owner = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState<WorkArtifactPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const invalidate = useCallback(() => {
    owner.current++;
    request.current?.abort();
    request.current = null;
    setPreview(null);
    setLoading(false);
    setFailed(false);
  }, []);
  useLayoutEffect(() => {
    invalidate();
    return invalidate;
  }, [record, sessionId, detail?.task.id, resultId, invalidate]);
  useFocusEffect(useCallback(() => () => invalidate(), [invalidate]));
  async function open(submissionId: string, index: number) {
    const submission = detail?.results.find((result) => result.id === submissionId);
    if (
      !detail ||
      submissionId !== resultId ||
      !submission ||
      !Number.isInteger(index) ||
      index < 0
    )
      return;
    const artifact = submission.artifacts[index];
    if (!artifact) return;
    invalidate();
    const generation = owner.current;
    const abort = new AbortController();
    request.current = abort;
    setLoading(true);
    try {
      const value = await readBoundWorkArtifactPreview(
        record,
        sessionId,
        detail.task.id,
        submissionId,
        index,
        artifact,
        { signal: abort.signal, isCurrent: () => generation === owner.current }
      );
      if (generation === owner.current) setPreview(value);
    } catch {
      if (generation === owner.current) setFailed(true);
    } finally {
      if (generation === owner.current) setLoading(false);
    }
  }
  return { preview, loading, failed, open, close: invalidate };
}
