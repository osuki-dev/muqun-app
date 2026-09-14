import {
  WorkApiError,
  type WorkDetail,
  type WorkRecordKind,
  type WorkRecordPage,
} from './work-api';

const collections = {
  attempt: 'attempts',
  operation: 'operations',
  result: 'results',
  review: 'reviews',
} as const;

/** Execution cannot infer that a lead or unresolved operation is absent from a prefix. */
export function workExecutionRecordsComplete(detail: WorkDetail) {
  return !detail.pages?.attempts.has_more && !detail.pages?.operations.has_more;
}

/** Append only a continuation of the exact displayed revision and collection cursor. */
export function mergeWorkPage<K extends WorkRecordKind>(
  detail: WorkDetail,
  kind: K,
  incoming: WorkRecordPage<K>
): WorkDetail {
  const collection = collections[kind];
  const prior = detail.pages?.[collection];
  const page = incoming.page;
  const existing = detail[collection];
  const reject = () => {
    throw new WorkApiError('refused', 'revision_conflict');
  };
  if (
    !prior?.has_more ||
    prior.snapshot_revision !== detail.task.revision ||
    page.snapshot_revision !== detail.task.revision ||
    page.after_id !== prior.next_after_id ||
    page.has_more !== (page.next_after_id !== null) ||
    (page.has_more && page.next_after_id !== incoming.items.at(-1)?.id)
  )
    return reject();
  const records = new Map(existing.map((item) => [item.id, item] as const));
  const added = [];
  let previous = page.after_id ?? '';
  for (const item of incoming.items) {
    if (item.task_id !== detail.task.id || item.id <= previous) return reject();
    const known = records.get(item.id);
    if (known) {
      // Exact immutable reads can prefetch the selected version beyond this prefix.
      if (!['result', 'review'].includes(kind) || JSON.stringify(known) !== JSON.stringify(item))
        return reject();
    } else added.push(item);
    previous = item.id;
  }
  return {
    ...detail,
    [collection]: [...existing, ...added],
    pages: { ...detail.pages!, [collection]: page },
  };
}
