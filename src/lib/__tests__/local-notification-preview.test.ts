import { describe, expect, test } from 'bun:test';
import {
  LocalNotificationPreview,
  LocalPreviewFocus,
  type LocalPreviewPorts,
  type PreviewPermission,
} from '../local-notification-preview';
import { noticeFromPush } from '../in-app-notifications';

function fixture() {
  const calls: string[] = [];
  let enabled = true;
  let permission = { granted: true, status: 'granted', canAskAgain: true };
  const ports: LocalPreviewPorts = {
    enabled: () => enabled,
    prepare: async () => {
      calls.push('channel');
    },
    permission: async () => {
      calls.push('permission');
      return permission;
    },
    requestPermission: async () => {
      calls.push('request');
      return permission;
    },
    schedule: async (request) => {
      calls.push('schedule');
      expect(request.trigger).toBe(null);
      expect(noticeFromPush('local-preview', request.content)?.route).toBe('/settings');
      expect(request.content.title).toBe('Sample');
      return 'local-preview';
    },
  };
  return {
    ports,
    calls,
    disable: () => {
      enabled = false;
    },
    deny: (status = 'denied') => {
      permission = { granted: false, status, canAskAgain: true };
    },
  };
}
const sample = { title: 'Sample', body: 'Local sample' };

describe('local notification preview', () => {
  test('pending permission resolves after route blur without unmount and cannot revive on refocus', async () => {
    for (const granted of [true, false]) {
      const f = fixture();
      const focus = new LocalPreviewFocus();
      const blur = focus.activate();
      f.ports.enabled = focus.capture();
      let settle!: (value: PreviewPermission) => void;
      let started!: () => void;
      const requested = new Promise<void>((resolve) => {
        started = resolve;
      });
      f.ports.permission = () => {
        started();
        return new Promise((resolve) => {
          settle = resolve;
        });
      };
      const result = new LocalNotificationPreview().run(f.ports, sample);
      await requested;
      blur();
      const leaveNewFocus = focus.activate();
      settle({ granted, status: granted ? 'granted' : 'denied', canAskAgain: false });
      expect(await result).toBe('disabled');
      expect(f.calls).toEqual(['channel']);
      expect(focus.capture()()).toBe(true);
      leaveNewFocus();
    }
  });
  test('disabling notifications while the OS request is pending suppresses denial feedback', async () => {
    const f = fixture();
    f.deny('undetermined');
    f.ports.requestPermission = async () => {
      f.disable();
      return { granted: false, status: 'denied', canAskAgain: false };
    };
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('disabled');
    expect(f.calls).toEqual(['channel', 'permission']);
  });
  test('route ownership starts inactive and ignores stale focus cleanup', () => {
    const focus = new LocalPreviewFocus();
    expect(focus.capture()()).toBe(false);
    const oldCleanup = focus.activate();
    const oldOwner = focus.capture();
    expect(oldOwner()).toBe(true);
    const cleanup = focus.activate();
    oldCleanup();
    expect(oldOwner()).toBe(false);
    expect(focus.capture()()).toBe(true);
    cleanup();
    expect(focus.capture()()).toBe(false);
  });
  test('disabled notifications perform no native operations', async () => {
    const f = fixture();
    f.disable();
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('disabled');
    expect(f.calls).toEqual([]);
  });
  test('schedules once through native receipt with an internal settings destination', async () => {
    const f = fixture();
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('scheduled');
    expect(f.calls).toEqual(['channel', 'permission', 'schedule']);
  });
  test('a previous denial never requests permission again', async () => {
    const f = fixture();
    f.deny();
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('permission-denied');
    expect(f.calls).toEqual(['channel', 'permission']);
  });
  test('undetermined permission asks once and does not schedule after denial', async () => {
    const f = fixture();
    f.deny('undetermined');
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('permission-denied');
    expect(f.calls).toEqual(['channel', 'permission', 'request']);
  });
  test('same-tick duplicate taps cannot schedule twice', async () => {
    const f = fixture();
    const preview = new LocalNotificationPreview();
    const first = preview.run(f.ports, sample);
    expect(await preview.run(f.ports, sample)).toBe('busy');
    expect(await first).toBe('scheduled');
    expect(f.calls.filter((call) => call === 'schedule').length).toBe(1);
  });
  test('a newly granted permission schedules without another prompt', async () => {
    const f = fixture();
    f.deny('undetermined');
    f.ports.requestPermission = async () => ({
      granted: true,
      status: 'granted',
      canAskAgain: true,
    });
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('scheduled');
  });
  test('a permission that cannot be requested never prompts', async () => {
    const f = fixture();
    f.ports.permission = async () => ({
      granted: false,
      status: 'undetermined',
      canAskAgain: false,
    });
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('permission-denied');
    expect(f.calls).toEqual(['channel']);
  });
  test('unmount before permission reads prevents permission UI', async () => {
    const f = fixture();
    f.ports.prepare = async () => {
      f.disable();
    };
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('disabled');
    expect(f.calls).toEqual([]);
  });
  test('leaving or disabling while permission resolves prevents scheduling', async () => {
    const f = fixture();
    f.ports.permission = async () => {
      f.disable();
      return { granted: true, status: 'granted', canAskAgain: true };
    };
    expect(await new LocalNotificationPreview().run(f.ports, sample)).toBe('disabled');
    expect(f.calls).toEqual(['channel']);
  });
  test('native errors release the guard but are never retried automatically', async () => {
    const f = fixture();
    const preview = new LocalNotificationPreview();
    f.ports.prepare = async () => {
      throw new Error('native failure');
    };
    await expect(preview.run(f.ports, sample)).rejects.toThrow('native failure');
    expect(f.calls).toEqual([]);
    f.ports.prepare = async () => {};
    expect(await preview.run(f.ports, sample)).toBe('scheduled');
  });
});
