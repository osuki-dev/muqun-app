import { describe, expect, test } from 'bun:test';
import { drawUpdateCurtain, setUpdateCurtain } from './update-curtain';

const elapsed = async (run: () => Promise<void>) => {
  const start = performance.now();
  await run();
  return performance.now() - start;
};

describe('drawUpdateCurtain', () => {
  test('resolves at once without a curtain', async () => {
    expect(await elapsed(() => drawUpdateCurtain(1000, null))).toBeLessThan(20);
  });

  test('waits for the curtain to finish', async () => {
    let finished = false;
    await drawUpdateCurtain(1000, async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      finished = true;
    });
    expect(finished).toBe(true);
  });

  test('a hanging curtain cannot hold the restart past its bound', async () => {
    const ms = await elapsed(() => drawUpdateCurtain(40, () => new Promise<void>(() => {})));
    expect(ms).toBeGreaterThanOrEqual(35);
    expect(ms).toBeLessThan(400);
  });

  test('a failing curtain still lets the restart proceed', async () => {
    expect(
      await elapsed(() => drawUpdateCurtain(1000, () => Promise.reject(new Error('gone'))))
    ).toBeLessThan(50);
    expect(
      await elapsed(() =>
        drawUpdateCurtain(1000, () => {
          throw new Error('sync');
        })
      )
    ).toBeLessThan(50);
  });

  test('removing an older curtain keeps the newer registration', async () => {
    let drawn = 0;
    const removeFirst = setUpdateCurtain(async () => {
      drawn += 1;
    });
    const removeSecond = setUpdateCurtain(async () => {
      drawn += 10;
    });
    removeFirst();
    await drawUpdateCurtain(100);
    expect(drawn).toBe(10);
    removeSecond();
    await drawUpdateCurtain(100);
    expect(drawn).toBe(10);
  });
});
