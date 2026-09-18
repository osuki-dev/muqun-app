import { expect, test } from 'bun:test';

import {
  advanceFontInstall,
  fontInstallBar,
  fontInstallCancellable,
  fontInstallPercent,
  type FontInstallEvent,
  type FontInstallState,
} from '@/theme/font-install-phase';

/** Run a whole sequence through the reducer, the way the sheet does. */
function run(events: FontInstallEvent[], from: FontInstallState | null = null) {
  return events.reduce(advanceFontInstall, from);
}

/** The phase after each event, which is what a reader actually watches. */
function phases(events: FontInstallEvent[]): (string | null)[] {
  let state: FontInstallState | null = null;
  return events.map((event) => {
    state = advanceFontInstall(state, event);
    return state?.phase ?? null;
  });
}

const START_DOWNLOAD: FontInstallEvent = { kind: 'start', mode: 'download' };
const START_IMPORT: FontInstallEvent = { kind: 'start', mode: 'import' };

test('a download with a Content-Length walks connecting, downloading, checking, registering, done', () => {
  expect(
    phases([
      START_DOWNLOAD,
      { kind: 'bytes', bytesWritten: 0, totalBytes: 4_000_000 },
      { kind: 'bytes', bytesWritten: 2_000_000, totalBytes: 4_000_000 },
      { kind: 'step', phase: 'checking' },
      { kind: 'step', phase: 'registering' },
      { kind: 'done' },
    ])
  ).toEqual(['connecting', 'downloading', 'downloading', 'checking', 'registering', 'done']);
});

test('a known total draws a determinate bar and a percentage', () => {
  const state = run([
    START_DOWNLOAD,
    { kind: 'bytes', bytesWritten: 1_000_000, totalBytes: 4_000_000 },
  ]);
  expect(state).not.toBeNull();
  expect(fontInstallBar(state!)).toEqual({
    mode: 'determinate',
    completed: 1_000_000,
    total: 4_000_000,
  });
  expect(fontInstallPercent(state!)).toBe(25);
});

test('a server that sends no Content-Length still gets a bar, and a byte count', () => {
  // The case the sheet used to draw nothing at all for: GitHub's raw host
  // streams chunked, so `totalBytes` never arrives and the row had no bar,
  // no phase and no sign that anything was happening.
  const state = run([START_DOWNLOAD, { kind: 'bytes', bytesWritten: 1_258_291, totalBytes: null }]);
  expect(state?.phase).toBe('downloading');
  expect(fontInstallBar(state!)).toEqual({ mode: 'indeterminate' });
  expect(fontInstallPercent(state!)).toBeNull();
  // And the one number it does know is kept, because "1.2 MB" is the only
  // evidence of progress an unmeasured transfer can offer.
  expect(state?.receivedBytes).toBe(1_258_291);
});

test('a total of zero is no total, not a division by zero', () => {
  const state = run([START_DOWNLOAD, { kind: 'bytes', bytesWritten: 512, totalBytes: 0 }]);
  expect(state?.totalBytes).toBeNull();
  expect(fontInstallBar(state!)).toEqual({ mode: 'indeterminate' });
});

test('the phases before and after the transfer have no fraction to draw', () => {
  for (const phase of ['connecting', 'checking', 'registering'] as const) {
    const state = run([
      START_DOWNLOAD,
      { kind: 'bytes', bytesWritten: 10, totalBytes: 100 },
      { kind: 'step', phase },
    ]);
    // `connecting` is refused as a backwards step, so only the two later ones
    // actually move; either way none of them is a measured transfer.
    if (phase === 'connecting') {
      expect(state?.phase).toBe('downloading');
    } else {
      expect(state?.phase).toBe(phase);
      expect(fontInstallBar(state!)).toEqual({ mode: 'indeterminate' });
      expect(fontInstallPercent(state!)).toBeNull();
    }
  }
});

test('done fills the bar whether or not the run ever knew its size', () => {
  const measured = run([
    START_DOWNLOAD,
    { kind: 'bytes', bytesWritten: 1, totalBytes: 4_000_000 },
    { kind: 'done' },
  ]);
  expect(fontInstallBar(measured!)).toEqual({
    mode: 'determinate',
    completed: 4_000_000,
    total: 4_000_000,
  });
  expect(fontInstallPercent(measured!)).toBe(100);

  const unmeasured = run([
    START_DOWNLOAD,
    { kind: 'bytes', bytesWritten: 900, totalBytes: null },
    { kind: 'done' },
  ]);
  expect(fontInstallBar(unmeasured!)).toEqual({ mode: 'determinate', completed: 1, total: 1 });
  expect(fontInstallPercent(unmeasured!)).toBe(100);
});

test('an import walks copying, checking, registering, done', () => {
  expect(
    phases([
      START_IMPORT,
      { kind: 'step', phase: 'checking' },
      { kind: 'step', phase: 'registering' },
      { kind: 'done' },
    ])
  ).toEqual(['copying', 'checking', 'registering', 'done']);
});

test('an import has no bar to measure until it finishes', () => {
  const copying = run([START_IMPORT]);
  expect(fontInstallBar(copying!)).toEqual({ mode: 'indeterminate' });
  const checking = run([{ kind: 'step', phase: 'checking' }], copying);
  expect(fontInstallBar(checking!)).toEqual({ mode: 'indeterminate' });
  expect(fontInstallBar(run([{ kind: 'done' }], checking)!)).toEqual({
    mode: 'determinate',
    completed: 1,
    total: 1,
  });
});

test('the sequence never runs backwards, whatever arrives late', () => {
  const checking = run([
    START_DOWNLOAD,
    { kind: 'bytes', bytesWritten: 40, totalBytes: 100 },
    { kind: 'step', phase: 'checking' },
  ]);
  // The native download's last progress callback, landing after the checks
  // began. The old row would have gone back to saying "Downloading".
  const late = advanceFontInstall(checking, { kind: 'bytes', bytesWritten: 100, totalBytes: 100 });
  expect(late?.phase).toBe('checking');
  expect(late).toBe(checking);
  // And a step that has already been passed is not re-entered.
  expect(advanceFontInstall(checking, { kind: 'step', phase: 'downloading' })).toBe(checking);
  expect(advanceFontInstall(checking, { kind: 'step', phase: 'connecting' })).toBe(checking);
});

test('bytes never decrease, so the bar cannot animate towards a smaller number', () => {
  const state = run([
    START_DOWNLOAD,
    { kind: 'bytes', bytesWritten: 800, totalBytes: 1000 },
    { kind: 'bytes', bytesWritten: 300, totalBytes: 1000 },
  ]);
  expect(state?.receivedBytes).toBe(800);
});

test('an unchanged progress callback returns the same object, so nothing re-renders', () => {
  const downloading = run([START_DOWNLOAD, { kind: 'bytes', bytesWritten: 500, totalBytes: 1000 }]);
  expect(
    advanceFontInstall(downloading, { kind: 'bytes', bytesWritten: 500, totalBytes: 1000 })
  ).toBe(downloading);
  const done = advanceFontInstall(downloading, { kind: 'done' });
  expect(advanceFontInstall(done, { kind: 'done' })).toBe(done);
});

test('cancelling at any step ends the run', () => {
  const steps: FontInstallEvent[] = [
    START_DOWNLOAD,
    { kind: 'bytes', bytesWritten: 10, totalBytes: 100 },
    { kind: 'step', phase: 'checking' },
    { kind: 'step', phase: 'registering' },
  ];
  for (let index = 1; index <= steps.length; index += 1) {
    const state = run(steps.slice(0, index));
    expect(state).not.toBeNull();
    expect(advanceFontInstall(state, { kind: 'cancelled' })).toBeNull();
  }
});

test('a failure at any step ends the run, including a failure during the import copy', () => {
  const download: FontInstallEvent[] = [
    START_DOWNLOAD,
    { kind: 'bytes', bytesWritten: 10, totalBytes: 100 },
    { kind: 'step', phase: 'checking' },
    { kind: 'step', phase: 'registering' },
  ];
  for (let index = 1; index <= download.length; index += 1) {
    expect(advanceFontInstall(run(download.slice(0, index)), { kind: 'failed' })).toBeNull();
  }
  const importSteps: FontInstallEvent[] = [
    START_IMPORT,
    { kind: 'step', phase: 'checking' },
    { kind: 'step', phase: 'registering' },
  ];
  for (let index = 1; index <= importSteps.length; index += 1) {
    expect(advanceFontInstall(run(importSteps.slice(0, index)), { kind: 'failed' })).toBeNull();
  }
});

test('nothing that arrives after the end starts a run again', () => {
  for (const event of [
    { kind: 'bytes', bytesWritten: 10, totalBytes: 100 },
    { kind: 'step', phase: 'checking' },
    { kind: 'done' },
    { kind: 'failed' },
    { kind: 'cancelled' },
  ] satisfies FontInstallEvent[]) {
    expect(advanceFontInstall(null, event)).toBeNull();
  }
  // Only a start does, and it starts clean rather than resuming the last one.
  const restarted = advanceFontInstall(null, START_DOWNLOAD);
  expect(restarted).toEqual({
    kind: 'download',
    phase: 'connecting',
    receivedBytes: 0,
    totalBytes: null,
  });
});

test('Cancel is offered while the bytes move and withdrawn once they stop', () => {
  expect(fontInstallCancellable(run([START_DOWNLOAD])!)).toBe(true);
  expect(
    fontInstallCancellable(
      run([START_DOWNLOAD, { kind: 'bytes', bytesWritten: 1, totalBytes: 2 }])!
    )
  ).toBe(true);
  for (const phase of ['checking', 'registering', 'done'] as const) {
    const state = run([START_DOWNLOAD, { kind: 'step', phase }])!;
    expect({ phase, cancellable: fontInstallCancellable(state) }).toEqual({
      phase,
      cancellable: false,
    });
  }
  // An import is a local copy that is over before a Cancel could be aimed at.
  expect(fontInstallCancellable(run([START_IMPORT])!)).toBe(false);
});
