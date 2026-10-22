import { describe, expect, test } from 'bun:test';

import {
  appendStageArtEvent,
  formatStageArtLog,
  parseStageArtLog,
  stageArtErrorText,
  stageArtFileName,
  stageArtRetryEdge,
  stageArtShouldRetry,
  STAGE_ART_RETRIES,
  type StageArtEvent,
} from '../stage-art-log';

const event = (overrides: Partial<StageArtEvent> = {}): StageArtEvent => ({
  at: 1_700_000_000_000,
  slot: 'hero',
  step: 'downsample',
  status: 'failed',
  gpuLost: false,
  ...overrides,
});

describe('appendStageArtEvent', () => {
  test('keeps only the newest events past the limit', () => {
    let log: StageArtEvent[] = [];
    for (let index = 0; index < 5; index += 1)
      log = appendStageArtEvent(log, event({ at: index, file: `${index}.png` }), 3);
    expect(log.map((item) => item.at)).toEqual([2, 3, 4]);
  });

  test('folds a repeat of the newest event into it, counted', () => {
    let log = appendStageArtEvent([], event({ at: 1 }));
    log = appendStageArtEvent(log, event({ at: 2 }));
    log = appendStageArtEvent(log, event({ at: 3 }));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ at: 3, repeat: 3 });
  });

  test('does not fold a different outcome or file', () => {
    let log = appendStageArtEvent([], event());
    log = appendStageArtEvent(log, event({ status: 'retry' }));
    log = appendStageArtEvent(log, event({ status: 'retry', file: 'b.png' }));
    expect(log).toHaveLength(3);
  });
});

describe('parseStageArtLog', () => {
  test('drops malformed input instead of trusting it', () => {
    expect(parseStageArtLog(undefined)).toEqual([]);
    expect(parseStageArtLog('{not json')).toEqual([]);
    expect(parseStageArtLog('{"at":1}')).toEqual([]);
    const kept = event();
    expect(parseStageArtLog(JSON.stringify([kept, { at: 'x' }, null]))).toEqual([kept]);
  });

  test('keeps the newest past the limit', () => {
    const raw = JSON.stringify([event({ at: 1 }), event({ at: 2 }), event({ at: 3 })]);
    expect(parseStageArtLog(raw, 2).map((item) => item.at)).toEqual([2, 3]);
  });
});

describe('privacy of the log', () => {
  test('names files by basename only', () => {
    expect(stageArtFileName('file:///data/user/0/app/files/theme-assets-v1/abc.png')).toBe(
      'abc.png'
    );
    expect(stageArtFileName('file:///private/a/b.webp?v=2#x')).toBe('b.webp');
    expect(stageArtFileName('file:///dir/')).toBeUndefined();
    expect(stageArtFileName(undefined)).toBeUndefined();
  });

  test('cuts errors to one bounded line', () => {
    expect(stageArtErrorText(new Error('a\n  b'))).toBe('a b');
    expect(stageArtErrorText('x'.repeat(500))?.length).toBe(160);
    expect(stageArtErrorText(undefined)).toBeUndefined();
  });

  test('formats newest first', () => {
    const text = formatStageArtLog([event({ at: 0, file: 'old.png' }), event({ at: 1000 })]);
    const [first, second] = text.split('\n');
    expect(first).not.toContain('old.png');
    expect(second).toContain('file=old.png');
  });
});

describe('stageArtShouldRetry', () => {
  test('waits for Home to come back after a failure', () => {
    expect(stageArtShouldRetry({ failures: 1, failedEpoch: 4, epoch: 4 })).toBe(false);
    expect(stageArtShouldRetry({ failures: 1, failedEpoch: 4, epoch: 5 })).toBe(true);
  });

  test('stops after the session budget', () => {
    expect(stageArtShouldRetry({ failures: STAGE_ART_RETRIES, failedEpoch: 0, epoch: 1 })).toBe(
      true
    );
    expect(stageArtShouldRetry({ failures: STAGE_ART_RETRIES + 1, failedEpoch: 0, epoch: 9 })).toBe(
      false
    );
  });

  test('never retries what has not failed', () => {
    expect(stageArtShouldRetry({ failures: 0, failedEpoch: 0, epoch: 3 })).toBe(false);
  });
});

describe('stageArtRetryEdge', () => {
  test('halves the cap per failure down to the floor', () => {
    expect([0, 1, 2, 3, 4].map((failures) => stageArtRetryEdge(2048, failures))).toEqual([
      2048, 1024, 512, 256, 256,
    ]);
  });

  test('never raises a cap already below the floor', () => {
    expect(stageArtRetryEdge(200, 2)).toBe(200);
  });
});
