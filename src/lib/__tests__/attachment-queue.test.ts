import { describe, expect, test } from 'bun:test';

import {
  annotateEntry,
  assertAttachmentDestination,
  sameAttachmentDestination,
  hasFailures,
  isBusy,
  markFailed,
  markUploaded,
  markUploading,
  MAX_CONCURRENT_UPLOADS,
  MAX_UPLOAD_BYTES,
  removeEntry,
  requeue,
  stageFiles,
  startableIds,
  uploadedPaths,
  type PendingAttachment,
  type PickedFile,
} from '../attachment-queue';

function pick(name: string, size?: number): PickedFile {
  return { uri: `file:///local/${name}`, name, mime: 'image/jpeg', size };
}

function stage(...files: PickedFile[]): PendingAttachment[] {
  return stageFiles([], files);
}

function statuses(queue: PendingAttachment[]): string[] {
  return queue.map((entry) => entry.status);
}

describe('staging', () => {
  test('a pick is queued, not merely held', () => {
    const queue = stage(pick('a.jpg'), pick('b.jpg'));
    expect(statuses(queue)).toEqual(['pending', 'pending']);
    expect(isBusy(queue)).toBe(true);
  });

  test('staging appends rather than replacing, so a second pick joins the first', () => {
    const first = stage(pick('a.jpg'));
    const both = stageFiles(first, [pick('b.jpg')]);
    expect(both.map((entry) => entry.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(both[0].id).not.toBe(both[1].id);
  });

  test('an oversized pick fails at staging without opening a socket', () => {
    const queue = stage(pick('huge.jpg', MAX_UPLOAD_BYTES + 1));
    expect(queue[0].status).toBe('error');
    expect(queue[0].error).toContain('10MB');
    expect(startableIds(queue)).toEqual([]);
    expect(isBusy(queue)).toBe(false);
  });

  test('a pick of unknown size is trusted, since the picker did not measure it', () => {
    const queue = stage(pick('unknown.jpg', undefined));
    expect(queue[0].status).toBe('pending');
  });

  test('staging nothing leaves the queue untouched', () => {
    const queue = stage(pick('a.jpg'));
    expect(stageFiles(queue, [])).toBe(queue);
  });
});

describe('the upload pool', () => {
  test('starts queued entries in pick order, up to the concurrency limit', () => {
    const queue = stage(pick('a.jpg'), pick('b.jpg'), pick('c.jpg'), pick('d.jpg'));
    const started = startableIds(queue, 3);
    expect(started).toEqual([queue[0].id, queue[1].id, queue[2].id]);
  });

  test('counts what is already in flight, so a retry cannot open an extra socket', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'), pick('c.jpg'), pick('d.jpg'));
    for (const id of startableIds(queue, 3)) queue = markUploading(queue, id);
    expect(startableIds(queue, 3)).toEqual([]);
  });

  test('a finished upload frees exactly one slot', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'), pick('c.jpg'), pick('d.jpg'));
    for (const id of startableIds(queue, 3)) queue = markUploading(queue, id);
    queue = markUploaded(queue, queue[0].id, { path: '/uploads/a.jpg' });
    expect(startableIds(queue, 3)).toEqual([queue[3].id]);
  });

  test('the default limit is the pool size', () => {
    const files = Array.from({ length: MAX_CONCURRENT_UPLOADS + 2 }, (_, index) =>
      pick(`${index}.jpg`)
    );
    expect(startableIds(stage(...files))).toHaveLength(MAX_CONCURRENT_UPLOADS);
  });
});

describe('per-entry transitions', () => {
  test('an upload that lands carries its path and the name the gateway chose', () => {
    let queue = stage(pick('a.jpg'));
    const { id } = queue[0];
    queue = markUploading(queue, id);
    expect(queue[0].status).toBe('uploading');
    queue = markUploaded(queue, id, { path: '/uploads/uuid.jpg', name: 'uuid.jpg' });
    expect(queue[0]).toMatchObject({
      status: 'done',
      remotePath: '/uploads/uuid.jpg',
      name: 'uuid.jpg',
    });
  });

  test('a gateway that renames nothing leaves the local name alone', () => {
    let queue = stage(pick('holiday.jpg'));
    queue = markUploaded(queue, queue[0].id, { path: '/uploads/uuid.jpg' });
    expect(queue[0].name).toBe('holiday.jpg');
  });

  test('a failure keeps its message on the entry it belongs to', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'));
    queue = markFailed(queue, queue[1].id, 'Could not upload the file.');
    expect(statuses(queue)).toEqual(['pending', 'error']);
    expect(queue[1].error).toBe('Could not upload the file.');
    expect(hasFailures(queue)).toBe(true);
  });

  test('retrying clears the error and re-queues only that entry', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'));
    queue = markUploading(queue, queue[0].id);
    queue = markFailed(queue, queue[1].id, 'Could not upload the file.');
    queue = requeue(queue, queue[1].id);
    expect(statuses(queue)).toEqual(['uploading', 'pending']);
    expect(queue[1].error).toBe(undefined);
  });

  test('retrying an oversized file refuses again instead of spending the uplink', () => {
    let queue = stage(pick('huge.jpg', MAX_UPLOAD_BYTES + 1));
    queue = requeue(queue, queue[0].id);
    expect(queue[0].status).toBe('error');
    expect(startableIds(queue)).toEqual([]);
  });

  test('retrying something already done or in flight changes nothing', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'));
    queue = markUploading(queue, queue[0].id);
    queue = markUploaded(queue, queue[1].id, { path: '/uploads/b.jpg' });
    expect(requeue(queue, queue[0].id)).toBe(queue);
    expect(requeue(queue, queue[1].id)).toBe(queue);
  });

  test('a result for an entry that was removed mid-upload is dropped, not resurrected', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'));
    const removedId = queue[0].id;
    queue = markUploading(queue, removedId);
    queue = removeEntry(queue, removedId);
    queue = markUploaded(queue, removedId, { path: '/uploads/a.jpg' });
    expect(queue).toHaveLength(1);
    expect(queue[0].name).toBe('b.jpg');
  });

  test('removing the last busy entry settles the queue', () => {
    let queue = stage(pick('a.jpg'));
    queue = markUploading(queue, queue[0].id);
    expect(isBusy(queue)).toBe(true);
    expect(isBusy(removeEntry(queue, queue[0].id))).toBe(false);
  });
});

describe('what Send collects', () => {
  test('paths come back in strip order, matching the tiles', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'), pick('c.jpg'));
    // Finishing out of order is the normal case with a pool.
    queue = markUploaded(queue, queue[2].id, { path: '/uploads/c.jpg' });
    queue = markUploaded(queue, queue[0].id, { path: '/uploads/a.jpg' });
    queue = markUploaded(queue, queue[1].id, { path: '/uploads/b.jpg' });
    expect(uploadedPaths(queue)).toEqual(['/uploads/a.jpg', '/uploads/b.jpg', '/uploads/c.jpg']);
  });

  test('one failure withholds the whole set rather than sending a short message', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'));
    queue = markUploaded(queue, queue[0].id, { path: '/uploads/a.jpg' });
    queue = markFailed(queue, queue[1].id, 'Could not upload the file.');
    expect(uploadedPaths(queue)).toBeNull();
  });

  test('removing the failure makes the rest sendable again', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'));
    queue = markUploaded(queue, queue[0].id, { path: '/uploads/a.jpg' });
    queue = markFailed(queue, queue[1].id, 'Could not upload the file.');
    queue = removeEntry(queue, queue[1].id);
    expect(uploadedPaths(queue)).toEqual(['/uploads/a.jpg']);
  });

  test('an empty queue collects an empty set, not a failure', () => {
    expect(uploadedPaths([])).toEqual([]);
    expect(isBusy([])).toBe(false);
  });

  test('a queue that is still busy is not yet complete', () => {
    let queue = stage(pick('a.jpg'), pick('b.jpg'));
    queue = markUploaded(queue, queue[0].id, { path: '/uploads/a.jpg' });
    expect(isBusy(queue)).toBe(true);
    queue = markUploading(queue, queue[1].id);
    expect(isBusy(queue)).toBe(true);
    queue = markUploaded(queue, queue[1].id, { path: '/uploads/b.jpg' });
    expect(isBusy(queue)).toBe(false);
  });
});

describe('annotateEntry', () => {
  test('an ordinary attachment carries no caption and no use', () => {
    const [entry] = stageFiles([], [pick('a.jpg')]);
    expect(entry.caption).toBeUndefined();
    expect(entry.use).toBeUndefined();
  });

  test('a caption and a use attach to one entry and leave the rest alone', () => {
    let queue = stageFiles([], [pick('a.jpg'), pick('b.jpg')]);
    queue = annotateEntry(queue, queue[0].id, { caption: 'the header', use: 'may-include' });
    expect(queue[0].caption).toBe('the header');
    expect(queue[0].use).toBe('may-include');
    expect(queue[1].caption).toBeUndefined();
  });

  test('annotating never disturbs an upload that is still running', () => {
    let queue = stageFiles([], [pick('a.jpg')]);
    const id = queue[0].id;
    queue = markUploading(queue, id);
    queue = annotateEntry(queue, id, { caption: 'written mid-flight' });
    expect(queue[0].status).toBe('uploading');
    queue = markUploaded(queue, id, { path: '/uploads/a.jpg' });
    // The reply lands after the caption and must not erase it.
    expect(queue[0].caption).toBe('written mid-flight');
    expect(queue[0].remotePath).toBe('/uploads/a.jpg');
  });

  test('one field can be set without clearing the other', () => {
    let queue = stageFiles([], [pick('a.jpg')]);
    const id = queue[0].id;
    queue = annotateEntry(queue, id, { caption: 'a note', use: 'reference-only' });
    queue = annotateEntry(queue, id, { use: 'may-include' });
    expect(queue[0].caption).toBe('a note');
    expect(queue[0].use).toBe('may-include');
  });

  test('an id that is not in the queue changes nothing', () => {
    const queue = stageFiles([], [pick('a.jpg')]);
    expect(annotateEntry(queue, 'missing', { caption: 'x' })).toEqual(queue);
  });
});

describe('destination binding', () => {
  const here = {
    serverId: 's1',
    sessionId: 'sess',
    sourcePaneId: 'pane',
    connectionGeneration: 1,
  };

  test('a composer attachment records no destination and binds at the record level', () => {
    const [entry] = stageFiles([], [pick('a.jpg')]);
    expect(entry.destination).toBeUndefined();
  });

  test('a file staged for a destination carries it', () => {
    const [entry] = stageFiles([], [pick('a.jpg')], here);
    expect(entry.destination).toEqual(here);
  });

  test('a queue still at its destination passes', () => {
    const queue = stageFiles([], [pick('a.jpg'), pick('b.jpg')], here);
    expect(() => assertAttachmentDestination(queue, here)).not.toThrow();
  });

  test('a reconnect alone moves the destination', () => {
    // The pane and the server are unchanged; the connection behind them is not.
    const queue = stageFiles([], [pick('a.jpg')], here);
    expect(() => assertAttachmentDestination(queue, { ...here, connectionGeneration: 2 })).toThrow(
      'Reference destination changed'
    );
  });

  test('another pane on the same session is another destination', () => {
    const queue = stageFiles([], [pick('a.jpg')], here);
    expect(() => assertAttachmentDestination(queue, { ...here, sourcePaneId: 'other' })).toThrow(
      'Reference destination changed'
    );
  });

  test('a differing command id is another destination', () => {
    const queue = stageFiles([], [pick('a.jpg')], { ...here, commandId: 'one' });
    expect(() => assertAttachmentDestination(queue, { ...here, commandId: 'two' })).toThrow(
      'Reference destination changed'
    );
  });

  test('one drifted entry rejects the whole queue rather than being dropped', () => {
    // A task assembled from a drifted queue is the wrong task, not a smaller one.
    const queue = [
      ...stageFiles([], [pick('a.jpg')], here),
      ...stageFiles([], [pick('b.jpg')], { ...here, sourcePaneId: 'elsewhere' }),
    ];
    expect(() => assertAttachmentDestination(queue, here)).toThrow('Reference destination changed');
  });

  test('an unbound entry is refused, never treated as bindable to anything', () => {
    const queue = stageFiles([], [pick('a.jpg')]);
    expect(() => assertAttachmentDestination(queue, here)).toThrow('Reference destination changed');
  });

  test('an empty queue has nothing to have drifted', () => {
    expect(() => assertAttachmentDestination([], here)).not.toThrow();
  });

  test('sameAttachmentDestination compares every field that addresses an agent', () => {
    expect(sameAttachmentDestination(here, { ...here })).toBe(true);
    for (const change of [
      { serverId: 'other' },
      { sessionId: 'other' },
      { sourcePaneId: 'other' },
      { connectionGeneration: 9 },
      { commandId: 'set' },
    ])
      expect(sameAttachmentDestination(here, { ...here, ...change })).toBe(false);
  });
});
