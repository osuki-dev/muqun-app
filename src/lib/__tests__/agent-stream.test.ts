import { describe, expect, test } from 'bun:test';

import { pumpAgentStream, type AgentStreamReader } from '../agent-stream';
import type { AgentDomainEvent } from '../agent-protocol';

/** UTF-8 in, so the decoder below is the real thing rather than a stub. */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A reader that hands back the chunks it was given and then closes. */
function readerOf(chunks: readonly string[], options: { close?: boolean } = {}): AgentStreamReader {
  let index = 0;
  return {
    read: async () => {
      if (index < chunks.length) {
        const value = encoder.encode(chunks[index]);
        index += 1;
        return { done: false, value };
      }
      if (options.close === false) {
        // A stream that never ends and never yields: the cancelled case.
        return new Promise(() => ({ done: false }));
      }
      return { done: true };
    },
  };
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe('pumpAgentStream', () => {
  /**
   * The defect this module was split out for. A gateway restart, a proxy's
   * idle timeout and OpenCode being restarted underneath the stream all end
   * the body in good order -- `done: true`, nothing thrown. The loop used to
   * fall off the bottom of its `while` and resolve silently, so the caller's
   * reconnect backoff never armed and the session sat there looking current.
   */
  test('an orderly close is reported as `closed`, not as nothing', async () => {
    const events: AgentDomainEvent[] = [];
    const ending = await pumpAgentStream({
      reader: readerOf([]),
      decoder,
      onEvent: (event) => events.push(event),
      isCancelled: () => false,
    });
    expect(ending).toBe('closed');
    expect(events).toEqual([]);
  });

  test('a stream that delivered frames and then closed still reports the close', async () => {
    const events: AgentDomainEvent[] = [];
    const ending = await pumpAgentStream({
      reader: readerOf([
        frame('connected', { asid: 'ses_1' }),
        frame('agent.status.changed', { asid: 'ses_1', status: 'busy', seq: 1 }),
      ]),
      decoder,
      onEvent: (event) => events.push(event),
      isCancelled: () => false,
    });
    expect(ending).toBe('closed');
    // `connected` is the gateway's own handshake, not a domain event.
    expect(events.map((event) => event.type)).toEqual(['agent.status.changed']);
  });

  test('a cancelled loop is `cancelled`, so nothing reconnects', async () => {
    let cancelled = false;
    const ending = await pumpAgentStream({
      reader: readerOf([frame('agent.status.changed', { asid: 'ses_1', status: 'idle' })]),
      decoder,
      onEvent: () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    expect(ending).toBe('cancelled');
  });

  test('a loop cancelled before its first read never reads', async () => {
    let reads = 0;
    const ending = await pumpAgentStream({
      reader: {
        read: async () => {
          reads += 1;
          return { done: true };
        },
      },
      decoder,
      onEvent: () => {},
      isCancelled: () => true,
    });
    expect(ending).toBe('cancelled');
    expect(reads).toBe(0);
  });

  test('a frame split across two chunks is one event', async () => {
    const whole = frame('agent.timeline.removed', { asid: 'ses_1', ids: ['msg_1:t0'] });
    const events: AgentDomainEvent[] = [];
    await pumpAgentStream({
      reader: readerOf([whole.slice(0, 20), whole.slice(20)]),
      decoder,
      onEvent: (event) => events.push(event),
      isCancelled: () => false,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'agent.timeline.removed', ids: ['msg_1:t0'] });
  });

  test('a frame that is not JSON is dropped rather than thrown on', async () => {
    const events: AgentDomainEvent[] = [];
    const ending = await pumpAgentStream({
      reader: readerOf(['event: agent.status.changed\ndata: {not json\n\n']),
      decoder,
      onEvent: (event) => events.push(event),
      isCancelled: () => false,
    });
    expect(ending).toBe('closed');
    expect(events).toEqual([]);
  });

  test('a payload this build has no branch for is dropped, and the loop carries on', async () => {
    const events: AgentDomainEvent[] = [];
    await pumpAgentStream({
      reader: readerOf([
        frame('agent.hologram.changed', { asid: 'ses_1' }),
        frame('agent.status.changed', { asid: 'ses_1', status: 'idle', seq: 2 }),
      ]),
      decoder,
      onEvent: (event) => events.push(event),
      isCancelled: () => false,
    });
    expect(events.map((event) => event.type)).toEqual(['agent.status.changed']);
  });

  test('an empty chunk is skipped rather than decoded', async () => {
    const events: AgentDomainEvent[] = [];
    let served = false;
    const ending = await pumpAgentStream({
      reader: {
        read: async () => {
          if (served) return { done: true };
          served = true;
          return { done: false, value: undefined };
        },
      },
      decoder,
      onEvent: (event) => events.push(event),
      isCancelled: () => false,
    });
    expect(ending).toBe('closed');
    expect(events).toEqual([]);
  });

  test('a read that rejects is the caller&apos;s to handle', async () => {
    const failing: AgentStreamReader = {
      read: async () => {
        throw new Error('socket reset');
      },
    };
    await expect(
      pumpAgentStream({
        reader: failing,
        decoder,
        onEvent: () => {},
        isCancelled: () => false,
      })
    ).rejects.toThrow('socket reset');
  });
});
