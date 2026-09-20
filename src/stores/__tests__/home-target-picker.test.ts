import { describe, expect, test } from 'bun:test';

import { useHomeTargetPicker } from '@/stores/home-target-picker';

describe('Home target picker handoff', () => {
  test('a cancelled request returns its original target without changing Home choice', () => {
    const requestId = useHomeTargetPicker.getState().begin('server-a', {});

    useHomeTargetPicker.getState().close(requestId);

    expect(useHomeTargetPicker.getState()).toMatchObject({
      openRequestId: null,
      completedRequestId: requestId,
      completedServerId: 'server-a',
    });
  });

  test('a late row from an older requester cannot change the newer request', () => {
    const firstRequestId = useHomeTargetPicker.getState().begin('server-a', {});
    const secondRequestId = useHomeTargetPicker.getState().begin('server-b', {});

    useHomeTargetPicker.getState().choose(firstRequestId, 'server-c');

    expect(useHomeTargetPicker.getState()).toMatchObject({
      openRequestId: secondRequestId,
      selectedServerId: 'server-b',
      completedRequestId: null,
    });

    useHomeTargetPicker.getState().close(secondRequestId);
  });

  test('a completed request returns the selected target to its requester', () => {
    const requestId = useHomeTargetPicker.getState().begin('server-a', {});

    useHomeTargetPicker.getState().choose(requestId, 'server-b');
    useHomeTargetPicker.getState().close(requestId);

    expect(useHomeTargetPicker.getState()).toMatchObject({
      completedRequestId: requestId,
      completedServerId: 'server-b',
      selectedServerId: 'server-b',
    });
  });

  test('a stale requester cannot replace the current reachability map', () => {
    const firstRequestId = useHomeTargetPicker.getState().begin('server-a', {
      'server-a': 'live',
    } as const);
    const secondRequestId = useHomeTargetPicker.getState().begin('server-b', {
      'server-b': 'offline',
    } as const);

    useHomeTargetPicker.getState().updateReachability(firstRequestId, {
      'server-a': 'offline',
    });

    expect(useHomeTargetPicker.getState()).toMatchObject({
      openRequestId: secondRequestId,
      reachabilityByServer: { 'server-b': 'offline' },
    });

    useHomeTargetPicker.getState().close(secondRequestId);
  });
});
