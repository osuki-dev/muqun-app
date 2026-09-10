import { describe, expect, test } from 'bun:test';
import { LocalNotificationPreview, type LocalPreviewPorts } from '../local-notification-preview';
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
