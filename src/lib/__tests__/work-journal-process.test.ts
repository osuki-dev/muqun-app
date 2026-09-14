import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function processPhase(phase: 'write' | 'recover', directory: string) {
  const fixture = fileURLToPath(
    new URL('./fixtures/work-journal-process.fixture.ts', import.meta.url)
  );
  const { stdout } = await promisify(execFile)(process.execPath, [fixture, phase, directory], {
    maxBuffer: 256 * 1024,
  });
  return JSON.parse(stdout);
}

test('two independent pending lanes survive a fresh process and interruption lookup never resends', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'muqun-interruption-journal-'));
  const fixture = fileURLToPath(
    new URL('./fixtures/work-interruption-process.fixture.ts', import.meta.url)
  );
  const run = async (phase: string) =>
    JSON.parse(
      (
        await promisify(execFile)(process.execPath, [fixture, phase, directory], {
          maxBuffer: 256 * 1024,
        })
      ).stdout
    );
  try {
    expect(await run('write')).toEqual({
      primary: 'delivery-original',
      interruption: 'interrupt-original',
    });
    const recovered = await run('recover');
    expect(recovered.posts).toBe(0);
    expect(recovered.keys).toBe(0);
    expect(recovered.missing).toBe('interrupt-original');
    expect(recovered.interruption).toBe(null);
    expect(recovered.primary.requestKey).toBe('delivery-original');
    expect(recovered.gets).toHaveLength(2);
    expect(
      recovered.gets.every((path: string) =>
        path.includes('kind=interrupt_attempt&request_key=interrupt-original')
      )
    ).toBe(true);
    expect((await readFile(join(directory, 'journal.json'), 'utf8')).includes('never-stored')).toBe(
      false
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a fresh JS process hydrates a committed pending key and reconciles read-only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'muqun-work-journal-'));
  try {
    const writer = await processPhase('write', directory);
    expect(writer).toMatchObject({ posts: 1, pendingKey: 'persisted-key-1', keysGenerated: 1 });
    const journal = await readFile(join(directory, 'journal.json'), 'utf8');
    expect(journal.includes('never-journal-this-credential')).toBe(false);
    expect(journal.includes('Never journal this user prompt')).toBe(false);
    const recovered = await processPhase('recover', directory);
    expect(recovered).toMatchObject({
      posts: 0,
      keysGenerated: 0,
      unresolvedKey: 'persisted-key-1',
      pending: null,
    });
    expect(recovered.lookupKeys).toEqual(['persisted-key-1', 'persisted-key-1']);
    expect(recovered.lookupActors).toEqual(['paired-actor', 'paired-actor']);
    expect(typeof recovered.recoveredTaskId).toBe('string');
    expect(JSON.parse(await readFile(join(directory, 'journal.json'), 'utf8')).records).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
