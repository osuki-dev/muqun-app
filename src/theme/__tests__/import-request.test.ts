import { expect, test } from 'bun:test';
import { ThemeImportRequest } from '../import-request';

test('synchronous picker cleanup during handoff cannot invalidate prepared installation', async () => {
  const request = new ThemeImportRequest();
  const prepared = {
    async install() {
      request.signal.throwIfAborted();
      return 'installed';
    },
  };
  request.handoff(() => {
    // onReady navigates; React may run the old component's cleanup immediately.
    request.cancel();
  });
  expect(await prepared.install()).toBe('installed');
  expect(request.signal.aborted).toBe(false);
});

test('cancel before handoff rejects transfer without calling the destination', () => {
  const request = new ThemeImportRequest();
  let accepted = false;
  request.cancel();
  expect(request.isCanceled).toBe(true);
  expect(() =>
    request.handoff(() => {
      accepted = true;
    })
  ).toThrow();
  expect(accepted).toBe(false);
});

test('failed handoff preserves the error and restores cancellation for rollback', () => {
  const request = new ThemeImportRequest();
  expect(() =>
    request.handoff(() => {
      request.cancel();
      throw new Error('Preview navigation failed');
    })
  ).toThrow('Preview navigation failed');
  expect(request.signal.aborted).toBe(true);
  expect(request.isCanceled).toBe(false);
});

test('an accepted preview cannot transfer twice or affect a later import request', () => {
  const previous = new ThemeImportRequest();
  const current = new ThemeImportRequest();
  previous.handoff(() => {});
  expect(() => previous.handoff(() => {})).toThrow('already transferred');
  previous.cancel();
  expect(current.signal.aborted).toBe(false);
  current.cancel();
  expect(current.signal.aborted).toBe(true);
  expect(previous.signal.aborted).toBe(false);
});
