import { describe, expect, test } from 'bun:test';
import { ThemeAssetLifecycle } from '../asset-lifecycle';

describe('theme image lifetime', () => {
  test('non-authoritative recovery suspends collection even after previous successful hydration', () => {
    const lifecycle = new ThemeAssetLifecycle();
    lifecycle.replaceReferences(['old']);
    expect(lifecycle.canCollect('unknown')).toBe(true);
    expect(lifecycle.replaceReferences(null)).toBe(false);
    expect(lifecycle.canCollect('unknown')).toBe(false);
    expect(lifecycle.canCollect('old')).toBe(false);
    lifecycle.replaceReferences(['new']);
    expect(lifecycle.canCollect('old')).toBe(true);
    expect(lifecycle.canCollect('new')).toBe(false);
  });
  test('never collects before metadata is known or while a theme references an image', () => {
    const lifecycle = new ThemeAssetLifecycle();
    expect(lifecycle.canCollect('image')).toBe(false);
    expect(lifecycle.replaceReferences(['image', 'image'])).toBe(true);
    expect(lifecycle.replaceReferences(['image'])).toBe(false);
    expect(lifecycle.canCollect('image')).toBe(false);
    expect(lifecycle.canCollect('orphan')).toBe(true);
    lifecycle.replaceReferences([]);
    expect(lifecycle.canCollect('image')).toBe(true);
  });

  test('overlapping previews retain bytes independently and release idempotently', () => {
    const lifecycle = new ThemeAssetLifecycle();
    lifecycle.replaceReferences([]);
    const first = lifecycle.reserve(['image', 'image']);
    const second = lifecycle.reserve(['image']);
    first();
    first();
    expect(lifecycle.canCollect('image')).toBe(false);
    second();
    expect(lifecycle.canCollect('image')).toBe(true);
  });

  test('metadata commit takes ownership before a preview releases its reservation', () => {
    const lifecycle = new ThemeAssetLifecycle();
    lifecycle.replaceReferences([]);
    const release = lifecycle.reserve(['image']);
    lifecycle.replaceReferences(['image']);
    release();
    expect(lifecycle.canCollect('image')).toBe(false);
  });

  test('serializes installers, blocks cleanup while queued, and unlocks after failure', async () => {
    const lifecycle = new ThemeAssetLifecycle();
    lifecycle.replaceReferences([]);
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const order: number[] = [];
    const first = lifecycle.install(async () => {
      order.push(1);
      await wait;
      throw new Error('copy failed');
    });
    const failed = first.catch((error: Error) => error.message);
    const second = lifecycle.install(async () => {
      order.push(2);
      expect(lifecycle.canCollect('orphan')).toBe(false);
      return 'installed';
    });
    await Promise.resolve();
    expect(order).toEqual([1]);
    expect(lifecycle.canCollect('orphan')).toBe(false);
    finish();
    expect(await failed).toBe('copy failed');
    expect(await second).toBe('installed');
    expect(order).toEqual([1, 2]);
    expect(lifecycle.canCollect('orphan')).toBe(true);
  });
});
