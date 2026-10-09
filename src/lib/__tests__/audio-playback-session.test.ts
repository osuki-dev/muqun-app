import { describe, expect, test } from 'bun:test';
import {
  AudioPlaybackSession,
  prepareRecordingAudio,
  releaseRecordingAudio,
  type AudioPlaybackRuntime,
  type AudioPlaybackState,
} from '../audio-playback-session';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(overrides: Partial<AudioPlaybackRuntime> = {}) {
  const calls: string[] = [];
  const states: AudioPlaybackState[] = [];
  let progress!: (position: number, duration: number) => void;
  let end!: () => void;
  let fail!: (error: Error) => void;
  const runtime: AudioPlaybackRuntime = {
    async prepare() {
      calls.push('prepare');
    },
    async start(onProgress, onEnd, onError) {
      calls.push('start');
      progress = onProgress;
      end = onEnd;
      fail = onError;
    },
    async pause() {
      calls.push('pause');
    },
    async resume() {
      calls.push('resume');
    },
    async seek(position) {
      calls.push(`seek:${position}`);
    },
    async stop() {
      calls.push('stop');
    },
    release() {
      calls.push('release');
    },
    ...overrides,
  };
  const session = new AudioPlaybackSession(runtime, (state) => states.push(state));
  return {
    session,
    calls,
    states,
    progress: (position: number, duration: number) => progress(position, duration),
    end: () => end(),
    fail: (error: Error) => fail(error),
  };
}

describe('audio playback ownership', () => {
  test('a decoder failure after startup releases playback and reports an error', async () => {
    const h = fixture();
    await h.session.play();
    h.fail(new Error('Decoder failed'));
    await h.session.pause();
    expect(h.calls.slice(-2)).toEqual(['stop', 'release']);
    expect(h.states.at(-1)?.phase).toBe('error');
    await h.session.close();
    expect(h.calls.filter((call) => call === 'release')).toHaveLength(1);
  });
  test('does not autoplay; coalesces play, pauses, resumes and clamps seeking', async () => {
    const player = fixture();
    expect(player.calls).toEqual([]);
    await Promise.all([player.session.play(), player.session.play()]);
    player.progress(1000, 8000);
    await player.session.pause();
    expect(player.states.at(-1)?.phase).toBe('paused');
    await player.session.play();
    await player.session.seek(20_000);
    await player.session.seek(-200);
    expect(player.calls).toEqual(['prepare', 'start', 'pause', 'resume', 'seek:8000', 'seek:0']);
    await player.session.close();
    await player.session.close();
    expect(player.calls.filter((call) => call === 'release')).toHaveLength(1);
    const count = player.states.length;
    player.progress(4000, 8000);
    expect(player.states).toHaveLength(count);
  });

  test('closing a pending download aborts it without starting native playback', async () => {
    const entered = deferred();
    let aborted = false;
    const player = fixture({
      prepare(signal) {
        entered.resolve();
        return new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('aborted'));
            },
            { once: true }
          )
        );
      },
    });
    const play = player.session.play();
    await entered.promise;
    await player.session.close();
    await play;
    expect(aborted).toBe(true);
    expect(player.calls).toEqual(['stop', 'release']);
    expect(player.states.some((state) => state.phase === 'error')).toBe(false);
  });

  test('replacement waits for pending native startup and pauses the previous player', async () => {
    const entered = deferred();
    const started = deferred();
    const order: string[] = [];
    const first = fixture({
      async start() {
        order.push('first:start');
        entered.resolve();
        await started.promise;
      },
      async pause() {
        order.push('first:pause');
      },
    });
    const second = fixture({
      async start() {
        order.push('second:start');
      },
    });
    const firstPlay = first.session.play();
    await entered.promise;
    const secondPlay = second.session.play();
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    started.resolve();
    await Promise.all([firstPlay, secondPlay]);
    expect(order).toEqual(['first:start', 'first:pause', 'second:start']);
    await first.session.close();
    await second.session.close();
  });

  test('recording pauses playback and blocks it until the matching owner releases', async () => {
    const owner = {};
    const player = fixture();
    await player.session.play();
    await prepareRecordingAudio(owner);
    expect(player.calls.at(-1)).toBe('pause');
    releaseRecordingAudio({});
    const blocked = fixture();
    await blocked.session.play();
    expect(blocked.calls).toEqual(['stop', 'release']);
    expect(blocked.states.at(-1)?.phase).toBe('error');
    releaseRecordingAudio(owner);
    await player.session.play();
    expect(player.calls.at(-1)).toBe('resume');
    await player.session.close();
    const next = fixture();
    await next.session.play();
    expect(next.states.at(-1)?.phase).toBe('playing');
    await next.session.close();
  });

  test('scrolling out pauses without releasing or resetting timing and return never autoplays', async () => {
    const player = fixture();
    await player.session.play();
    player.progress(2500, 8000);
    await player.session.setVisible(false);
    expect(player.states.at(-1)).toEqual({ phase: 'paused', position: 2500, duration: 8000 });
    expect(player.calls).toEqual(['prepare', 'start', 'pause']);
    await player.session.play();
    expect(player.calls).toEqual(['prepare', 'start', 'pause']);
    await player.session.setVisible(true);
    expect(player.states.at(-1)?.phase).toBe('paused');
    await player.session.play();
    expect(player.calls).toEqual(['prepare', 'start', 'pause', 'resume']);
    await player.session.close();
    expect(player.calls.slice(-2)).toEqual(['stop', 'release']);
  });

  test('a download finishing out of view never starts playback and is reused on return', async () => {
    const entered = deferred();
    const downloaded = deferred();
    let downloads = 0;
    const player = fixture({
      async prepare() {
        downloads++;
        entered.resolve();
        await downloaded.promise;
      },
    });
    const play = player.session.play();
    await entered.promise;
    const pause = player.session.setVisible(false);
    downloaded.resolve();
    await Promise.all([play, pause]);
    expect(player.calls).toEqual([]);
    await player.session.setVisible(true);
    expect(player.calls).toEqual([]);
    await player.session.play();
    expect(downloads).toBe(1);
    expect(player.calls).toEqual(['start']);
    await player.session.close();
  });

  test('rapid A/B/A playback switches serialize and preserve both paused players', async () => {
    const first = fixture();
    const second = fixture();
    await Promise.all([first.session.play(), second.session.play(), first.session.play()]);
    expect(first.calls).toEqual(['prepare', 'start', 'pause', 'resume']);
    expect(second.calls).toEqual(['prepare', 'start', 'pause']);
    await Promise.all([first.session.close(), second.session.close()]);
  });

  test('completion during a pending pause stays ended so the next tap replays', async () => {
    const pausing = deferred();
    const entered = deferred();
    const player = fixture({
      async pause() {
        entered.resolve();
        await pausing.promise;
      },
    });
    await player.session.play();
    player.progress(8000, 8000);
    const pause = player.session.pause();
    await entered.promise;
    player.end();
    pausing.resolve();
    await pause;
    expect(player.states.at(-1)?.phase).toBe('ended');
    await player.session.play();
    expect(player.calls).toEqual(['prepare', 'start', 'stop', 'start']);
    expect(player.states.at(-1)?.position).toBe(0);
    await player.session.close();
  });

  test('replay reuses downloaded bytes and starts from the beginning', async () => {
    const player = fixture();
    await player.session.play();
    player.progress(8000, 8000);
    player.end();
    expect(player.states.at(-1)?.phase).toBe('ended');
    await player.session.play();
    expect(player.calls).toEqual(['prepare', 'start', 'stop', 'start']);
    expect(player.states.at(-1)?.position).toBe(0);
    expect(player.states.at(-1)?.phase).toBe('playing');
    await player.session.close();
  });

  test('failed native startup still stops and releases its audio session', async () => {
    const player = fixture({
      async start() {
        throw new Error('decoder failed');
      },
    });
    await player.session.play();
    expect(player.states.at(-1)?.phase).toBe('error');
    expect(player.calls).toEqual(['prepare', 'stop', 'release']);
    await player.session.close();
    expect(player.calls.filter((call) => call === 'release')).toHaveLength(1);
  });
});
