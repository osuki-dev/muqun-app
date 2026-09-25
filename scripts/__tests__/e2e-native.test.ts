import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  NativeRunner,
  withinScrollViewport,
  appViewport,
  exactSelectorMatches,
  NativeCommandError,
  deviceFlags,
  decodeReply,
  interpolate,
  junit,
  matches,
  requirePass,
  selectFlows,
  snapshotNodes,
  tokenize,
  validateTarget,
  isNotificationFixtureCommand,
  runWithCleanup,
  type Suite,
} from '../e2e-native';

const suite: Suite = {
  version: 1,
  flows: [
    { name: 'tour', program: 'tour', tags: ['full', 'smoke'], platforms: ['ios', 'android'] },
    { name: 'capture', program: 'capture', tags: ['capture'], platforms: ['ios'] },
    { name: 'held', program: 'held', tags: ['full'], platforms: ['ios'], disabled: 'not shipped' },
  ],
  programs: {},
};
const node = { index: 1, ref: 'e2', label: 'Done', rect: { x: 0, y: 0, width: 20, height: 20 } };

describe('native end-to-end gate', () => {
  test('sheet list rows must have their tap center inside the visible scroll viewport', () => {
    const app = {
      ref: 'e1',
      index: 0,
      type: 'Application',
      rect: { x: 0, y: 0, width: 1210, height: 834 },
    };
    const list = {
      ref: 'e2',
      index: 1,
      parentIndex: 0,
      type: 'ScrollView',
      rect: { x: 315, y: 368, width: 580, height: 369 },
    };
    const row = {
      ref: 'e3',
      index: 2,
      parentIndex: 1,
      type: 'Button',
      label: 'Open CHANGELOG.md',
      rect: { x: 335, y: 738, width: 540, height: 44 },
    };
    expect(withinScrollViewport(row, [app, list, row])).toBe(false);
    const scrolled = { ...row, rect: { ...row.rect, y: 650 } };
    expect(withinScrollViewport(scrolled, [app, list, scrolled])).toBe(true);
    const above = { ...row, rect: { ...row.rect, y: 330 } };
    expect(withinScrollViewport(above, [app, list, above])).toBe(false);
    // A source row spans the horizontal canvas; its text can be visible even
    // when the row's center is thousands of points outside the viewport.
    const source = {
      ...row,
      type: 'StaticText',
      rect: { x: 335, y: 400, width: 28000, height: 17 },
    };
    expect(withinScrollViewport(source, [app, list, source])).toBe(true);
  });
  test('flow cleanup follows failure evidence, always closes, and preserves original failure', async () => {
    const order: string[] = [];
    const failure = await runWithCleanup({
      run: async () => {
        order.push('run');
        throw new Error('assertion failed');
      },
      captureFailure: async () => {
        order.push('evidence');
      },
      cleanup: async () => {
        order.push('cleanup');
        throw new Error('permission restore failed');
      },
      close: async () => {
        order.push('close');
      },
    });
    expect(order).toEqual(['run', 'evidence', 'cleanup', 'close']);
    expect(failure?.includes('assertion failed')).toBe(true);
    expect(failure?.includes('permission restore failed')).toBe(true);
    const cleanupFailure = await runWithCleanup({
      run: async () => {},
      captureFailure: async () => {},
      cleanup: async () => {
        throw new Error('restore');
      },
      close: async () => {},
    });
    expect(cleanupFailure?.includes('Flow cleanup failed')).toBe(true);
  });
  test('local notification cleanup never dismisses an unrelated native alert', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'muqun-notification-alert-'));
    try {
      await writeFile(path.join(base, 'dismiss.ad'), 'alert dismiss\n');
      for (const title of [
        'Notifications are not allowed',
        'Allow notifications in system settings to preview them',
        'Trust this server?',
        'Delete data?',
      ]) {
        let dismissed = 0;
        const runner = new NativeRunner(
          suite,
          base,
          base,
          async (args) => {
            if (args[1] === 'get')
              return {
                kind: 'alertStatus',
                alert: {
                  title,
                  buttons: ['Notifications are not allowed', 'Cancel', 'Open settings'],
                },
              };
            dismissed++;
            return {};
          },
          {}
        );
        const expected =
          title === 'Notifications are not allowed' ||
          title === 'Allow notifications in system settings to preview them';
        if (expected) await runner.runSection('dismiss.ad', {});
        else await expect(runner.runSection('dismiss.ad', {})).rejects.toThrow('Only the expected');
        expect(dismissed).toBe(expected ? 1 : 0);
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
  test('notification fixture permission commands are narrowly bounded', () => {
    expect(isNotificationFixtureCommand(['settings', 'permission', 'grant', 'notifications'])).toBe(
      true
    );
    expect(isNotificationFixtureCommand(['settings', 'permission', 'deny', 'notifications'])).toBe(
      true
    );
    expect(isNotificationFixtureCommand(['alert', 'dismiss'])).toBe(true);
    for (const args of [
      ['settings', 'permission', 'reset', 'notifications'],
      ['settings', 'permission', 'grant', 'camera'],
      ['settings', 'clear-app-state'],
      ['settings', 'permission', 'grant', 'notifications', 'extra'],
      ['alert', 'accept'],
    ])
      expect(isNotificationFixtureCommand(args)).toBe(false);
  });
  test('controlled replacements verify the actual value before another edit or navigation', async () => {
    const base = path.resolve(
      fileURLToPath(new URL('../../e2e/agent-device/flows/', import.meta.url))
    );
    for (const [file, value] of [
      ['slash-commands.ad', 'draft'],
      ['agent-shortcuts.ad', 'Keep this custom instruction draft while I inspect the terminal'],
    ]) {
      const lines = (await readFile(path.join(base, file), 'utf8')).split('\n');
      const filled = lines.findIndex((line) => line.startsWith('fill ') && line.includes(value));
      expect(filled >= 0).toBe(true);
      expect(lines[filled + 1].startsWith('wait ')).toBe(true);
      expect(lines[filled + 1].includes(value)).toBe(true);
      expect(lines.some((line) => line.startsWith('is visible ') && line.includes(value))).toBe(
        true
      );
    }
  });
  test('reopening a dismissed slash query observes trigger deletion before typing a new one', async () => {
    const base = path.resolve(fileURLToPath(new URL('../../e2e/agent-device/', import.meta.url)));
    const manifest = JSON.parse(await readFile(path.join(base, 'suite.json'), 'utf8')) as Suite;
    for (const cleared of [true, false]) {
      let value = '/rel';
      let typed = 0;
      const runner = new NativeRunner(
        manifest,
        base,
        '/unused',
        async (args) => {
          if (args[0] === 'fill') {
            if (args[2] === '/mod') typed++;
            if (cleared) value = args[2];
          }
          if (args[0] === 'snapshot') {
            return {
              nodes: [
                {
                  ...node,
                  type: 'android.widget.EditText',
                  identifier: 'terminal-composer-input',
                  label: value || 'Send a message',
                  value,
                },
              ],
            };
          }
          return { pass: args[0] !== 'is' || value === 'draft' };
        },
        {}
      );
      const result = runner.run([{ run: 'flows/slash-commands.ad#s30' }], {});
      if (cleared) await result;
      else await expect(result).rejects.toThrow();
      expect(typed).toBe(cleared ? 1 : 0);
      expect(value).toBe(cleared ? '/mod' : '/rel');
    }
  });
  test('manifest targets reject unsupported constraints instead of broadening a match', () => {
    expect(() => validateTarget({ text: 'Osuki', role: 'radiobutton' })).toThrow(
      'Unsupported native target key: role'
    );
    for (const invalid of [
      null,
      [],
      {},
      'Osuki',
      { id: '' },
      { checked: 'false' },
      { selected: 0 },
      { checked: true },
    ])
      expect(() => validateTarget(invalid)).toThrow();
    expect(() =>
      validateTarget({ id: 'settings-selection:(on|off):theme-osuki', selected: false })
    ).not.toThrow();
    expect(() => validateTarget({ text: 'Osuki', checked: true })).not.toThrow();
  });
  test('Android slash recovery types only into an observed empty composer, never partial input', async () => {
    const base = path.resolve(fileURLToPath(new URL('../../e2e/agent-device/', import.meta.url)));
    const manifest = JSON.parse(await readFile(path.join(base, 'suite.json'), 'utf8')) as Suite;
    const reset = manifest.programs['flows/slash-commands'].find(
      (step) => step.steps?.[0]?.run === 'flows/slash-commands.ad#s16'
    )!;
    for (const initial of ['/', 'Send a message', '/co/', 'capture-error']) {
      let value = initial;
      let typed = 0;
      const runner = new NativeRunner(
        manifest,
        base,
        '/unused',
        async (args) => {
          if (args[0] === 'snapshot') {
            if (initial === 'capture-error') throw new Error('capture failed');
            return {
              nodes: [
                {
                  ...node,
                  type: 'android.widget.EditText',
                  identifier: 'terminal-composer-input',
                  label: value,
                  value,
                },
              ],
            };
          }
          if (args[0] === 'type') {
            typed++;
            value = args[1];
          }
          return { pass: !args[2]?.includes('value="/"') || value === '/' };
        },
        {}
      );
      const result = runner.run([reset], { PLATFORM: 'android' });
      if (initial === '/co/' || initial === 'capture-error') await expect(result).rejects.toThrow();
      else await result;
      expect(typed).toBe(initial === 'Send a message' ? 1 : 0);
    }
  });
  test('private AX Other settings state requires a unique leaf and preserves native precedence', () => {
    const off = {
      ...node,
      type: 'Other',
      label: 'SYSTEM',
      identifier: 'settings-selection:off:segment-system',
    };
    const on = {
      ...off,
      index: 2,
      label: 'DARK',
      identifier: 'settings-selection:on:segment-dark',
      selected: true,
    };
    const actual = snapshotNodes({ nodes: [off, on] });
    expect(matches(actual[0], { selected: false })).toBe(true);
    expect(matches(actual[0], { selected: true })).toBe(false);
    expect(matches(actual[1], { selected: true })).toBe(true);
    expect(matches({ ...off, selected: true }, { selected: false })).toBe(false);
    for (const sameId of [false, true]) {
      const ancestor = { ...off };
      const leaf = {
        ...off,
        index: 2,
        parentIndex: ancestor.index,
        identifier: sameId ? off.identifier : undefined,
      };
      const ambiguous = snapshotNodes({ nodes: [ancestor, leaf] });
      for (const candidate of ambiguous) {
        if (!candidate.identifier) continue;
        expect(matches(candidate, { selected: false })).toBe(false);
        expect(matches(candidate, { selected: true })).toBe(false);
      }
    }
  });
  test('settings controls retain their exact ID instead of duplicate caption labels', async () => {
    const control = {
      ...node,
      type: 'android.view.ViewGroup',
      label: 'SYSTEM',
      identifier: 'settings-selection:off:segment-system',
    };
    const calls: string[][] = [];
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        return args[0] === 'snapshot'
          ? { nodes: [{ ...node, type: 'android.widget.TextView', label: 'SYSTEM' }, control] }
          : { pass: true };
      },
      {}
    );
    expect(await runner.locate({ text: 'SYSTEM' })).toEqual(control);
    expect(calls[1][2]).toContain('id="settings-selection:off:segment-system"');
  });
  test('native selectors containing spaces remain one quoted argument', () => {
    expect(tokenize('press "label=\\"Theme, Osuki\\""')).toEqual(['press', 'label="Theme, Osuki"']);
  });
  test('settings selected IDs expose only exact control state and native selected wins', () => {
    for (const type of ['Button', 'RadioButton', 'android.view.ViewGroup', 'android.view.View']) {
      for (const selected of [true, false]) {
        const control = {
          ...node,
          type,
          identifier: `settings-selection:${selected ? 'on' : 'off'}:segment-system`,
        };
        expect(matches(control, { selected })).toBe(true);
        expect(matches(control, { selected: !selected })).toBe(false);
        expect(matches({ ...control, selected: !selected }, { selected })).toBe(false);
        expect(matches({ ...control, selected: !selected }, { selected: !selected })).toBe(true);
      }
    }
    for (const identifier of [
      'settings-selection:unknown:segment-system',
      'settings-selection:on:',
      'settings-selection:off:segment system',
      'other:settings-selection:on:segment-system',
    ]) {
      const control = { ...node, type: 'android.view.ViewGroup', identifier };
      expect(matches(control, { selected: false })).toBe(false);
      expect(matches(control, { selected: true })).toBe(false);
    }
    const ancestor = {
      ...node,
      type: 'Other',
      identifier: 'settings-selection:on:segment-system',
    };
    expect(matches(ancestor, { selected: true })).toBe(false);
    expect(matches(ancestor, { selected: false })).toBe(false);
  });
  test('exact compound absence selectors preserve native identity and reject unsupported grammar', () => {
    const button = { ...node, type: 'Button', label: 'Summarize progress' };
    expect(exactSelectorMatches(button, 'role=button label="Summarize progress"')).toBe(true);
    expect(exactSelectorMatches(button, 'role=button label="Other"')).toBe(false);
    expect(exactSelectorMatches(button, 'role=statictext label="Summarize progress"')).toBe(false);
    expect(() => exactSelectorMatches(button, 'role=button || label="Other"')).toThrow();
  });
  test('deferred private AX captures retry only reads and never establish false absence', async () => {
    for (const recovers of [false, true]) {
      const calls: string[][] = [];
      const runner = new NativeRunner(
        suite,
        '/unused',
        '/unused',
        async (args) => {
          calls.push(args);
          return {
            nodes: [node],
            ...(recovers && calls.length === 2
              ? {}
              : {
                  snapshotQuality: {
                    state: 'sparse',
                    backend: 'private-ax',
                    reason: 'XCTest-backed snapshot tiers deferred',
                  },
                }),
          };
        },
        {}
      );
      const result = runner.readySnapshot();
      if (recovers) await result;
      else await expect(result).rejects.toThrow('does not establish absence');
      expect(calls).toEqual(Array.from({ length: recovers ? 2 : 3 }, () => ['snapshot']));
    }
  });
  test('recovered private AX sparse-tree captures require a readable recapture', async () => {
    let attempts = 0;
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        expect(args).toEqual(['snapshot']);
        attempts++;
        return attempts === 1
          ? {
              nodes: [node],
              snapshotQuality: {
                state: 'recovered',
                backend: 'private-ax',
                reason: 'snapshot returned no semantic controls or content',
                reasonCode: 'sparse-tree',
              },
            }
          : { nodes: [node] };
      },
      {}
    );
    expect(await runner.readySnapshot()).toEqual([node]);
    expect(attempts).toBe(2);
  });
  test('a transient bare iOS tree at launch is recaptured before asserting absence', async () => {
    let attempts = 0;
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        expect(args).toEqual(['snapshot']);
        attempts++;
        return attempts < 3
          ? {
              nodes: [node],
              snapshotQuality: {
                state: 'sparse',
                backend: 'tree',
                reasonCode: 'sparse-tree',
                reason: 'snapshot returned no semantic controls or content',
              },
            }
          : { nodes: [node] };
      },
      {}
    );
    expect(await runner.readySnapshot()).toEqual([node]);
    expect(attempts).toBe(3);
  });
  test('a busy iOS runner retries the snapshot without repeating an input', async () => {
    const calls: string[][] = [];
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        if (calls.length === 1) throw new Error('runnerErrorCode: RUNNER_BUSY');
        return { nodes: [node] };
      },
      {}
    );
    expect(await runner.readySnapshot()).toEqual([node]);
    expect(calls).toEqual([['snapshot'], ['snapshot']]);
  });
  test('canvas gestures use the app viewport, never the first Android SystemUI status bar', () => {
    const appRect = { x: 0, y: 0, width: 1080, height: 2400 };
    expect(
      appViewport([
        {
          ...node,
          bundleId: 'com.android.systemui',
          rect: { x: 0, y: 0, width: 1080, height: 136 },
        },
        { ...node, bundleId: 'dev.osuki.muqun', rect: appRect },
      ])
    ).toEqual(appRect);
    expect(() => appViewport([{ ...node, bundleId: 'com.android.systemui' }])).toThrow(
      'Missing app viewport'
    );
    expect(appViewport([{ ...node, rect: appRect }, node])).toEqual(appRect);
  });
  test('camera denial is permitted only in the explicit pairing flow context', async () => {
    for (const android of [false, true])
      for (const allowCameraDenial of [false, true]) {
        let denied = false;
        const runner = new NativeRunner(
          suite,
          '/unused',
          '/unused',
          async (args) => {
            if (args[0] === 'snapshot')
              return {
                nodes:
                  android || denied
                    ? [node]
                    : [
                        { ...node, type: 'Alert', label: '“Muqun”想访问相机。' },
                        { ...node, type: 'Button', label: '不允许' },
                      ],
                ...(android ? { androidSnapshot: {} } : {}),
              };
            if (args[0] === 'press' || args[1] === 'dismiss') {
              denied = true;
              return {};
            }
            if (args[0] === 'wait') return {};
            return {
              kind: 'alertStatus',
              alert: denied
                ? null
                : {
                    title: 'Allow Muqun to take pictures and record video?',
                    source: 'permission',
                    packageName: 'com.google.android.permissioncontroller',
                    buttons: ['Only this time', 'Don’t allow'],
                  },
            };
          },
          { allowCameraDenial }
        );
        const result = runner.readySnapshot();
        if (allowCameraDenial) await result;
        else await expect(result).rejects.toThrow();
        expect(denied).toBe(allowCameraDenial);
      }
  });
  test('observation reads reuse a fresh Android clear probe within the TTL', async () => {
    const calls: string[][] = [];
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        if (args[0] === 'snapshot') return { nodes: [node], androidSnapshot: {} };
        return { kind: 'alertStatus', alert: null };
      },
      {}
    );
    await runner.readySnapshot();
    await runner.readySnapshot();
    expect(calls.filter((args) => args[0] === 'snapshot')).toHaveLength(2);
    expect(calls.filter((args) => args[0] === 'alert')).toHaveLength(1);
  });
  test('guarded mutations force a fresh Android alert probe', async () => {
    const calls: string[][] = [];
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        if (args[0] === 'snapshot') return { nodes: [node], androidSnapshot: {} };
        return { kind: 'alertStatus', alert: null };
      },
      {}
    );
    await runner.readySnapshot();
    await runner.readySnapshot(true);
    expect(calls.filter((args) => args[0] === 'alert')).toHaveLength(2);
  });
  test('an expired Android clear probe is refreshed on the next read', async () => {
    const calls: string[][] = [];
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        if (args[0] === 'snapshot') return { nodes: [node], androidSnapshot: {} };
        return { kind: 'alertStatus', alert: null };
      },
      {}
    );
    await runner.readySnapshot();
    (runner as unknown as { lastAlertClearMs: number }).lastAlertClearMs = Date.now() - 60_000;
    await runner.readySnapshot();
    expect(calls.filter((args) => args[0] === 'alert')).toHaveLength(2);
  });
  test('hidden selector absence requires a fresh readable unblocked capture', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'muqun-native-predicate-'));
    try {
      await writeFile(path.join(base, 'hidden.ad'), 'is hidden "id=\\"instructions\\""\n');
      for (const scenario of ['absent', 'present', 'blocked', 'capture-error', 'alert']) {
        const runner = new NativeRunner(
          suite,
          base,
          base,
          async (args) => {
            if (args[0] === 'is')
              throw new NativeCommandError({
                code: 'COMMAND_FAILED',
                details: {
                  reason: 'selector_not_found',
                  predicate: 'hidden',
                  ...(scenario === 'blocked' ? { blockedBy: 'android_foreground_surface' } : {}),
                },
              });
            if (scenario === 'capture-error') throw new Error('capture unavailable');
            return {
              nodes: [
                {
                  ...node,
                  ...(scenario === 'present' ? { identifier: 'instructions' } : {}),
                  ...(scenario === 'alert' ? { type: 'Alert', label: 'Unknown permission' } : {}),
                },
              ],
            };
          },
          {}
        );
        const result = runner.runSection('hidden.ad', {});
        if (scenario === 'absent') await result;
        else await expect(result).rejects.toThrow();
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
  test('Android notification permission is narrowly dismissed and verified', async () => {
    for (const scenario of ['notification', 'unknown', 'still-visible']) {
      let dismissed = false;
      const calls: string[][] = [];
      const runner = new NativeRunner(
        suite,
        '/unused',
        '/unused',
        async (args) => {
          calls.push(args);
          if (args[0] === 'snapshot')
            return { nodes: [node], androidSnapshot: { backend: 'android-helper' } };
          if (args[1] === 'dismiss') {
            dismissed = true;
            return { handled: true };
          }
          return {
            kind: 'alertStatus',
            alert:
              dismissed && scenario !== 'still-visible'
                ? null
                : {
                    title:
                      scenario === 'unknown'
                        ? 'Allow Muqun to access photos?'
                        : 'Allow Muqun to send you notifications?',
                    source: 'permission',
                    packageName: 'com.google.android.permissioncontroller',
                    buttons: ['Allow', 'Don’t allow'],
                  },
          };
        },
        {}
      );
      const result = runner.readySnapshot();
      if (scenario === 'notification') await result;
      else await expect(result).rejects.toThrow();
      expect(calls.filter((args) => args[0] === 'alert' && args[1] === 'dismiss')).toHaveLength(
        scenario === 'unknown' ? 0 : 1
      );
      expect(calls.filter((args) => args[0] === 'press')).toHaveLength(0);
    }
  });
  test('an Android permission race repeats only the read-only predicate after guarded dismissal', async () => {
    let alertVisible = false;
    let probes = 0;
    const calls: string[][] = [];
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        if (args[0] === 'snapshot') return { nodes: [node], androidSnapshot: {} };
        if (args[0] === 'is') {
          if (++probes === 1) {
            alertVisible = true;
            throw new NativeCommandError({
              code: 'COMMAND_FAILED',
              details: {
                blockedBy: 'android_foreground_surface',
                foregroundPackage: 'com.google.android.permissioncontroller',
              },
            });
          }
          return { pass: true };
        }
        if (args[1] === 'dismiss') {
          alertVisible = false;
          return { handled: true };
        }
        return {
          kind: 'alertStatus',
          alert: alertVisible
            ? {
                title: 'Allow Muqun to send you notifications?',
                source: 'permission',
                packageName: 'com.google.android.permissioncontroller',
                buttons: ['Allow', 'Don’t allow'],
              }
            : null,
        };
      },
      {}
    );
    expect(await runner.locate({ text: 'Done' })).toEqual(node);
    expect(probes).toBe(2);
    expect(calls.filter((args) => args[0] === 'press')).toHaveLength(0);
  });
  test('advisory false hittability never retaps and destination assertions decide the result', async () => {
    for (const navigated of [true, false]) {
      const calls: string[][] = [];
      let pressed = false;
      const runner = new NativeRunner(
        suite,
        fileURLToPath(new URL('../../e2e/agent-device', import.meta.url)),
        '/unused',
        async (args) => {
          calls.push(args);
          if (args[0] === 'snapshot')
            return { nodes: [{ ...node, label: pressed && navigated ? 'Destination' : 'Start' }] };
          if (args[0] === 'press') {
            pressed = true;
            return { targetHittable: false };
          }
          return { pass: true };
        },
        {}
      );
      const result = runner.run([
        { target: { text: 'Start' }, mode: 'press', run: 'subflows/open-demo.ad#s1' },
        {
          target: { text: 'Destination' },
          mode: 'visible',
          timeout: 0,
          run: 'subflows/open-demo.ad#s2',
        },
      ]);
      if (navigated) await result;
      else await expect(result).rejects.toThrow('Expected visible: {"text":"Destination"}');
      expect(calls.filter((args) => args[0] === 'press')).toHaveLength(1);
    }
  });
  test('UUIDs and Android serials use their native flags while device names stay names', () => {
    expect(deviceFlags('ios', '3F9A2AF9-AFDC-4B6D-A3B8-523052E29B68')).toEqual([
      '--platform',
      'ios',
      '--udid',
      '3F9A2AF9-AFDC-4B6D-A3B8-523052E29B68',
    ]);
    expect(deviceFlags('ios', 'muqun-collaboration-tests')).toEqual([
      '--platform',
      'ios',
      '--device',
      'muqun-collaboration-tests',
    ]);
    expect(deviceFlags('android', 'emulator-5554')).toEqual([
      '--platform',
      'android',
      '--serial',
      'emulator-5554',
    ]);
    expect(deviceFlags('android', 'emulator-5560')).toEqual([
      '--platform',
      'android',
      '--serial',
      'emulator-5560',
    ]);
    expect(deviceFlags('android', 'R58M123ABC', ['R58M123ABC'])).toEqual([
      '--platform',
      'android',
      '--serial',
      'R58M123ABC',
    ]);
    expect(deviceFlags('android', '127.0.0.1:5555', ['127.0.0.1:5555'])).toEqual([
      '--platform',
      'android',
      '--serial',
      '127.0.0.1:5555',
    ]);
    expect(deviceFlags('android', 'muqun collaboration qa')).toEqual([
      '--platform',
      'android',
      '--device',
      'muqun collaboration qa',
    ]);
  });
  test('keeps capture, disabled and platform scope out of the full gate', () => {
    expect(selectFlows(suite, 'full', 'ios').map((flow) => flow.name)).toEqual(['tour']);
    expect(selectFlows(suite, 'smoke', 'android').map((flow) => flow.name)).toEqual(['tour']);
    expect(selectFlows(suite, 'capture', 'android')).toEqual([]);
    expect(() => selectFlows(suite, 'full', 'ios', 'held')).toThrow('not shipped');
  });
  test('domain tags select the documented full-gate subsets on both platforms', async () => {
    const base = path.resolve(fileURLToPath(new URL('../../e2e/agent-device/', import.meta.url)));
    const manifest = JSON.parse(await readFile(path.join(base, 'suite.json'), 'utf8')) as Suite;
    const domains: Record<string, string[]> = {
      themes: ['theme-document', 'custom-themes'],
      settings: [
        'custom-themes',
        'settings',
        'settings-guide',
        'settings-font',
        'settings-home-layout',
      ],
      terminal: [
        'terminal-interactions',
        'file-mentions',
        'attachments-ui',
        'slash-commands',
        'agent-shortcuts',
        'soft-keyboard',
      ],
      files: [
        'theme-document',
        'file-mentions',
        'attachments-ui',
        'artifacts',
        'large-file-preview',
        'git-diff',
      ],
      agents: ['agent-collaboration', 'agent-session-tree', 'away-digest', 'agent-shortcuts'],
      workspace: [
        'agent-session-tree',
        'demo-tour',
        'settings-home-layout',
        'pad-workspace',
        'switcher-sheet',
        'personal-workspace',
      ],
      connection: ['pairing-manual', 'ssh'],
      localization: ['thai-language'],
    };

    for (const platform of ['ios', 'android']) {
      for (const [tag, expected] of Object.entries(domains)) {
        expect(selectFlows(manifest, tag, platform).map((flow) => flow.name)).toEqual(expected);
      }
    }
    const domainNames = new Set(Object.keys(domains));
    expect(
      selectFlows(manifest, 'full', 'android').filter(
        (flow) => !flow.tags.some((tag) => domainNames.has(tag))
      )
    ).toEqual([]);
  });
  test('false predicates fail even when the command succeeds', () => {
    const result = decodeReply('{"success":true,"data":{"pass":false}}', 0);
    expect(() => requirePass(result)).toThrow('UI assertion failed');
    expect(() => requirePass({})).toThrow();
  });
  test('capture failures and invalid payloads cannot establish absence', () => {
    expect(() => decodeReply('{"success":false,"error":{"code":"CAPTURE_FAILED"}}', 1)).toThrow();
    expect(() => decodeReply('not json', 0)).toThrow();
    expect(() => snapshotNodes({ nodes: [] })).toThrow();
    expect(() => snapshotNodes({ nodes: [node], snapshotQuality: 'unavailable' })).toThrow();
    expect(() =>
      snapshotNodes({ nodes: [node], blockedBy: 'android_foreground_surface' })
    ).toThrow();
  });
  test('whole-string regex preserves suffixes, case and trailing spaces', () => {
    expect(matches(node, { text: 'Don.*' })).toBe(true);
    expect(matches(node, { text: 'Don' })).toBe(false);
    expect(matches(node, { text: '(?i)done' })).toBe(true);
    expect(matches({ ...node, label: 'src/theme.ts ' }, { text: 'src/theme\\.ts ' })).toBe(true);
    expect(matches({ ...node, label: 'src/theme.ts' }, { text: 'src/theme\\.ts ' })).toBe(false);
  });
  test('checked assertions require observed state', () => {
    expect(matches(node, { selected: false })).toBe(true);
    expect(matches(node, { selected: true })).toBe(false);
    expect(matches({ ...node, type: 'android.view.View' }, { selected: false })).toBe(false);
    expect(
      matches({ ...node, type: 'android.view.View', selected: false }, { selected: false })
    ).toBe(true);
    expect(matches({ ...node, value: '1' }, { checked: true })).toBe(true);
    expect(matches({ ...node, checked: false }, { checked: false })).toBe(true);
    expect(matches(node, { checked: false })).toBe(false);
    expect(
      matches(
        { ...node, type: 'android.widget.Switch', label: 'Terminal key row, On' },
        { checked: true }
      )
    ).toBe(true);
    expect(
      matches(
        { ...node, type: 'android.widget.Switch', label: 'Terminal key row, Off' },
        { checked: false }
      )
    ).toBe(true);
    expect(
      matches(
        { ...node, type: 'android.widget.TextView', label: 'Terminal key row, Off' },
        { checked: false }
      )
    ).toBe(false);
  });
  test('token rendering preserves values without shell evaluation', () => {
    expect(tokenize('type "$(whoami) `pwd` hello\\nworld"')).toEqual([
      'type',
      '$(whoami) `pwd` hello\nworld',
    ]);
    expect(interpolate('${TARGET}', { TARGET: 'label="Use spaces"' })).toBe('label="Use spaces"');
    expect(() => interpolate('${MISSING}', {})).toThrow('Missing test input');
  });
  test('the iPad visual press records evidence and cannot bypass guards on other devices', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muqun-e2e-visual-'));
    try {
      await writeFile(path.join(directory, 'visual.ad'), '# section tap\npress 605 778 --visual\n');
      const calls: string[][] = [];
      const runner = new NativeRunner(
        suite,
        directory,
        directory,
        async (args) => {
          calls.push(args);
          return {};
        },
        {}
      );
      await runner.runSection('visual.ad#tap', { DEVICE_KIND: 'ipad' });
      expect(calls.map((args) => args[0])).toEqual(['screenshot', 'press']);
      expect(calls[1]).toEqual(['press', '605', '778']);
      await expect(runner.runSection('visual.ad#tap', { DEVICE_KIND: 'iphone' })).rejects.toThrow(
        'Visual press requires iPad'
      );
      expect(calls).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('a landscape form sheet dismisses outside the keyboard-reduced viewport', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muqun-e2e-popover-'));
    try {
      await writeFile(path.join(directory, 'dismiss.ad'), '# section close\nback --system\n');
      const calls: string[][] = [];
      const runner = new NativeRunner(
        suite,
        directory,
        directory,
        async (args) => {
          calls.push(args);
          if (args[0] === 'snapshot')
            return {
              nodes: [
                { ...node, type: 'Application', rect: { x: 0, y: 0, width: 1210, height: 834 } },
                { ...node, identifier: 'PopoverDismissRegion', type: 'Other' },
                { ...node, label: 'Sheet Grabber', type: 'Button' },
              ],
            };
          return {};
        },
        {}
      );
      await runner.runSection('dismiss.ad#close', {});
      expect(calls.filter((args) => args[0] === 'press')).toEqual([['press', '97', '200']]);
      expect(calls.some((args) => args[0] === 'gesture')).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('catalogue Back ignores an exposed underlying navigation button', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muqun-e2e-catalogue-'));
    try {
      await writeFile(path.join(directory, 'dismiss.ad'), '# section close\nback --system\n');
      const calls: string[][] = [];
      const runner = new NativeRunner(
        suite,
        directory,
        directory,
        async (args) => {
          calls.push(args);
          if (args[0] === 'snapshot')
            return {
              nodes: [
                { ...node, identifier: 'theme-browse-list', type: 'android.widget.ScrollView' },
                { ...node, label: 'Go back', type: 'android.widget.Button' },
              ],
            };
          return { kind: 'alertStatus', alert: null };
        },
        {}
      );
      await runner.runSection('dismiss.ad#close', {});
      expect(calls.filter((args) => args[0] === 'back')).toEqual([['back', '--system']]);
      expect(calls.some((args) => args[0] === 'press')).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('iPad sheet scrolling starts inside the form sheet', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muqun-e2e-sheet-scroll-'));
    try {
      await writeFile(
        path.join(directory, 'scroll.ad'),
        '# section list\nscroll down 2 --in-sheet\n'
      );
      const calls: string[][] = [];
      const runner = new NativeRunner(
        suite,
        directory,
        directory,
        async (args) => {
          calls.push(args);
          if (args[0] === 'snapshot')
            return {
              nodes: [
                { ...node, type: 'Application', rect: { x: 0, y: 0, width: 1210, height: 834 } },
                {
                  ...node,
                  label: 'Sheet Grabber',
                  rect: { x: 567, y: 205, width: 76, height: 25 },
                },
              ],
            };
          return {};
        },
        {}
      );
      await runner.runSection('scroll.ad#list', { DEVICE_KIND: 'ipad' });
      expect(calls.filter((args) => args[0] === 'gesture')).toEqual([
        ['gesture', 'pan', '605', '600', '0', '-305', '400'],
        ['gesture', 'pan', '605', '600', '0', '-305', '400'],
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('an unconfirmed iOS fill observes its committed value before any retry', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muqun-e2e-fill-'));
    try {
      await writeFile(
        path.join(directory, 'fill.ad'),
        '# section input\nfill "id=new-task-prompt" "QA attachment draft"\n'
      );
      const calls: string[][] = [];
      let attempted = false;
      const runner = new NativeRunner(
        suite,
        directory,
        directory,
        async (args) => {
          calls.push(args);
          if (args[0] === 'snapshot')
            return {
              nodes: [
                {
                  ...node,
                  identifier: 'new-task-prompt',
                  type: 'XCUIElementTypeTextField',
                  value: attempted ? 'QA attachment draft' : '',
                },
              ],
            };
          if (args[0] === 'fill') {
            attempted = true;
            throw new NativeCommandError({ code: 'TEXT_INPUT_COMMIT_NOT_OBSERVED' });
          }
          return {};
        },
        {}
      );
      await runner.runSection('fill.ad#input', {});
      expect(calls.filter((args) => args[0] === 'fill')).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('optional absent targets skip, while capture errors still fail', async () => {
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async () => ({ nodes: [node] }),
      {}
    );
    await runner.run([
      { target: { text: 'Missing' }, mode: 'press', optional: true, run: 'never.ad' },
    ]);
    const broken = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async () => {
        throw new Error('capture stalled');
      },
      {}
    );
    await expect(
      broken.run([{ target: { text: 'Missing' }, mode: 'press', optional: true, run: 'never.ad' }])
    ).rejects.toThrow('capture stalled');
  });
  test('an inherited label resolves to its actionable descendant with the role retained', async () => {
    for (const [type, role] of [
      ['Button', 'button'],
      ['XCUIElementTypeTextField', 'textfield'],
      ['android.widget.Switch', 'switch'],
    ]) {
      const parent = { ...node, type: 'Other', index: 1, ref: 'e2' };
      const child = { ...node, type, index: 2, parentIndex: 1, ref: 'e3' };
      const calls: string[][] = [];
      const runner = new NativeRunner(
        suite,
        '/unused',
        '/unused',
        async (args) => {
          calls.push(args);
          return args[0] === 'snapshot' ? { nodes: [parent, child] } : { pass: true };
        },
        {}
      );
      expect((await runner.locate({ text: 'Done' }))?.index).toBe(2);
      expect(calls[1]).toEqual(['is', 'exists', `role="${role}" label="Done" visible=true`]);
      let target = '';
      runner.runSection = async (_reference, env) => {
        target = env.TARGET;
      };
      await runner.run([{ target: { text: 'Done' }, mode: 'press', run: 'unused.ad' }]);
      expect(target).toBe(`role="${role}" label="Done"`);
    }
  });
  test('selector roles use native matcher types, not snapshot display aliases', async () => {
    for (const [type, role] of [
      ['StaticText', 'statictext'],
      ['XCUIElementTypeStaticText', 'statictext'],
      ['android.widget.TextView', 'textview'],
      ['TextView', 'textview'],
      ['android.widget.EditText', 'edittext'],
      ['android.widget.ImageButton', 'imagebutton'],
      ['android.view.ViewGroup', 'viewgroup'],
      ['SearchField', 'searchfield'],
    ]) {
      const calls: string[][] = [];
      const runner = new NativeRunner(
        suite,
        '/unused',
        '/unused',
        async (args) => {
          calls.push(args);
          return args[0] === 'snapshot' ? { nodes: [{ ...node, type }] } : { pass: true };
        },
        {}
      );
      await runner.locate({ text: 'Done' });
      expect(calls[1]).toEqual(['is', 'exists', `role="${role}" label="Done" visible=true`]);
    }
  });
  test('native ambiguity errors are not replaced with a coordinate or a second tap', async () => {
    const button = { ...node, type: 'Button' };
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        if (args[0] === 'snapshot') return { nodes: [button] };
        throw new Error('AMBIGUOUS_MATCH');
      },
      {}
    );
    await expect(runner.locate({ text: 'Done' })).rejects.toThrow('AMBIGUOUS_MATCH');
  });
  test('a generic ancestor cannot satisfy a selected-state or visibility check for its control', async () => {
    const parent = { ...node, type: 'Other' };
    const button = { ...node, type: 'Button', index: 2, parentIndex: 1, selected: true };
    const calls: string[][] = [];
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        return args[0] === 'snapshot' ? { nodes: [parent, button] } : { pass: false };
      },
      {}
    );
    expect(await runner.locate({ text: 'Done', selected: false })).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(await runner.locate({ text: 'Done' })).toBeUndefined();
    expect(calls.at(-1)).toEqual(['is', 'exists', 'role="button" label="Done" visible=true']);
    expect(calls).toHaveLength(3);
  });
  test('negative assertions fail if a matching visible node exists', async () => {
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => (args[0] === 'snapshot' ? { nodes: [node] } : { pass: true }),
      {}
    );
    await expect(
      runner.run([{ target: { text: 'Done' }, mode: 'hidden', timeout: 0 }])
    ).rejects.toThrow('Expected hidden');
    await runner.run([{ target: { text: 'Missing' }, mode: 'hidden', timeout: 0 }]);
  });
  test('conditional branches run only on an observed predicate', async () => {
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async () => ({ nodes: [node] }),
      {}
    );
    await runner.run([{ when: { target: { text: 'Missing' } }, steps: [{ include: 'missing' }] }]);
    await expect(
      runner.run([
        { when: { target: { text: 'Missing' }, absent: true }, steps: [{ include: 'missing' }] },
      ])
    ).rejects.toThrow('Missing program');
  });
  test('reports failures with escaped evidence', () => {
    const report = junit([{ name: 'a&b', seconds: 1, error: '<failed>' }]);
    expect(report).toContain('failures="1"');
    expect(report).toContain('name="a&amp;b"');
    expect(report).toContain('&lt;failed&gt;');
  });
  test('a late Chinese notification request is denied before locating app controls', async () => {
    const alert = { ...node, type: 'Alert', label: '“Muqun”想给你发送通知' };
    const deny = { ...node, type: 'Button', index: 2, label: '不允许' };
    const calls: string[][] = [];
    let denied = false;
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        if (args[0] === 'press') {
          denied = true;
          return {};
        }
        if (args[0] === 'snapshot') return { nodes: denied ? [node] : [alert, deny, node] };
        return { pass: true };
      },
      {}
    );
    expect((await runner.locate({ text: 'Done' }))?.label).toBe('Done');
    // The dialog is let settle and re-read before its button is pressed, so
    // the press never carries the geometry of a frame the dialog has left.
    expect(calls[1]).toEqual(['wait', 'stable', '300', '5000']);
    expect(calls[2]).toEqual(['snapshot']);
    expect(calls[3]).toEqual(['press', 'role="button" label="不允许"']);
    expect(calls[4]).toEqual(['wait', 'stable', '300', '5000']);
    expect(calls[5]).toEqual(['snapshot']);
  });
  test('unknown alerts block even negative and optional app assertions', async () => {
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async () => ({ nodes: [{ ...node, type: 'Alert', label: 'Delete everything?' }] }),
      {}
    );
    await expect(
      runner.run([{ target: { text: 'Missing' }, mode: 'hidden', optional: true }])
    ).rejects.toThrow('Unexpected system alert');
  });
  test('permission denial must actually remove the alert before continuing', async () => {
    const nodes = [
      { ...node, type: 'Alert', label: 'Muqun Would Like to Send You Notifications' },
      { ...node, type: 'Button', label: "Don't Allow" },
    ];
    let presses = 0;
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        if (args[0] === 'press') presses++;
        return { nodes };
      },
      {}
    );
    await expect(runner.readySnapshot()).rejects.toThrow('did not dismiss');
    // Two presses at most: one may race the dialog's last frame, a second
    // that also fails is a real blocker, not a timing accident.
    expect(presses).toBe(2);
  });
  test('scheme confirmation alert is opened before locating controls', async () => {
    const alertNodes = [
      { ...node, type: 'Alert', label: 'Open in “Muqun”?' },
      { ...node, type: 'Button', label: 'Cancel' },
      { ...node, type: 'Button', label: 'Open' },
    ];
    const appNodes = [{ ...node, type: 'Button', label: 'Done' }];
    const calls: string[][] = [];
    let dismissed = false;
    const runner = new NativeRunner(
      suite,
      '/unused',
      '/unused',
      async (args) => {
        calls.push(args);
        if (args[0] === 'press' && args[1].includes('Open')) dismissed = true;
        if (args[0] === 'snapshot') {
          return { nodes: dismissed ? appNodes : alertNodes };
        }
        if (args[0] === 'is') return { pass: true };
        return {};
      },
      {}
    );
    expect((await runner.locate({ text: 'Done' }))?.label).toBe('Done');
    expect(calls.some((call) => call[0] === 'press' && call[1].includes('Open'))).toBe(true);
  });
});

describe('a foreground the app has not filled yet', () => {
  const sections = [
    '# section launch',
    'open "dev.osuki.muqun" --relaunch',
    '',
    '# section probe',
    'wait stable 400 5000',
    '',
    '# section late',
    'open "dev.osuki.muqun" --relaunch',
    'wait stable 400 5000',
    'wait stable 400 5000',
    'wait stable 400 5000',
    'wait stable 400 5000',
    'wait stable 400 5000',
    'wait stable 400 5000',
    'wait stable 400 5000',
    '',
  ].join('\n');
  const blank = () =>
    new NativeCommandError({
      code: 'COMMAND_FAILED',
      message: 'Android snapshot helper returned insufficient foreground app content',
      retriable: true,
      details: { helperApplicationWindowRootCount: 0, helperSystemUiNodeCount: 34 },
    });
  const harness = async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'e2e-retry-'));
    await writeFile(path.join(base, 'probe.ad'), sections);
    return base;
  };

  test('a capture that finds no app yet is repeated until the app arrives', async () => {
    const base = await harness();
    try {
      let attempts = 0;
      const runner = new NativeRunner(
        suite,
        base,
        '/unused',
        async (args) => {
          if (args[0] !== 'wait') return {};
          attempts++;
          if (attempts <= 2) throw blank();
          return {};
        },
        {}
      );
      await runner.runSection('probe.ad#launch', {});
      await runner.runSection('probe.ad#probe', {});
      expect(attempts).toBe(3);
      expect(runner.appContentRetries.map((retry) => retry.attempt)).toEqual([1, 2]);
      expect(runner.appContentRetries.every((retry) => retry.command === 'wait')).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 20000);

  test('an app that never arrives fails with the error it actually gave', async () => {
    const base = await harness();
    try {
      let attempts = 0;
      const runner = new NativeRunner(
        suite,
        base,
        '/unused',
        async (args) => {
          if (args[0] !== 'wait') return {};
          attempts++;
          throw blank();
        },
        {}
      );
      await runner.runSection('probe.ad#launch', {});
      const failure = await runner.runSection('probe.ad#probe', {}).catch((error) => error);
      expect(failure instanceof NativeCommandError).toBe(true);
      expect((failure as NativeCommandError).details.message).toContain(
        'insufficient foreground app content'
      );
      // The first try plus the whole backoff, and not one attempt more.
      expect(attempts).toBe(6);
      expect(runner.appContentRetries).toHaveLength(5);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 30000);

  test('a COMMAND_FAILED that is not retriable is never repeated', async () => {
    const base = await harness();
    try {
      let attempts = 0;
      const runner = new NativeRunner(
        suite,
        base,
        '/unused',
        async (args) => {
          if (args[0] !== 'wait') return {};
          attempts++;
          throw new NativeCommandError({
            code: 'COMMAND_FAILED',
            message: 'Selector did not match: role="button" id="launch-scene-skip"',
            details: { reason: 'selector_not_found' },
          });
        },
        {}
      );
      await runner.runSection('probe.ad#launch', {});
      const failure = await runner.runSection('probe.ad#probe', {}).catch((error) => error);
      expect(failure instanceof NativeCommandError).toBe(true);
      expect(attempts).toBe(1);
      expect(runner.appContentRetries).toHaveLength(0);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test('a blank foreground past the launch window is the flow failing, not the app arriving', async () => {
    const base = await harness();
    try {
      let attempts = 0;
      const runner = new NativeRunner(
        suite,
        base,
        '/unused',
        async (args) => {
          if (args[0] !== 'wait') return {};
          attempts++;
          // Only the seventh step finds nothing, and by then the window
          // -- six steps -- has closed behind it.
          if (attempts >= 7) throw blank();
          return {};
        },
        {}
      );
      const failure = await runner.runSection('probe.ad#late', {}).catch((error) => error);
      expect(failure instanceof NativeCommandError).toBe(true);
      expect(attempts).toBe(7);
      expect(runner.appContentRetries).toHaveLength(0);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 20000);
});
