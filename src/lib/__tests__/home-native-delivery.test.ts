import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { recoverWith, settleAfter } from '../compiler-safe-control-flow';
import { isAgentDeliveryUnconfirmed } from '../agent-request-error';
import { goalTitle, type PendingResend } from '../home-computer-cards';
import { homeThreadKey } from '../home-thread';

function nativeSend(options: { loseCreation?: boolean; stagingRefused?: boolean } = {}) {
  const record = { serverId: 'qa', deviceId: 'qa-device' };
  const inFlightRef = { current: false };
  const unknown: { asid: string | undefined; draft: PendingResend }[] = [];
  const counts = { create: 0, prompt: 0, failed: 0, settled: 0 };
  const targets: string[] = [];
  const source = declaration('src/components/home-composer-dock.tsx', 'startSession');
  const send = runInNewContext(transpile(`${source}\nstartSession`), {
    inFlightRef,
    startedRef: { current: null },
    setError: () => {},
    sendTarget: async () => 'qa',
    stageDispatch: () => (options.stagingRefused ? null : 'row'),
    sessionParams: { agentId: 'codex' },
    folder: undefined,
    useGatewayConnectionStore: { getState: () => ({ record }) },
    sameComputer: (left: unknown, right: unknown) => left === right,
    homeSessionReuse: () => ({ kind: 'create' }),
    heldByModelGate: () => false,
    createAgentSession: async () => {
      counts.create++;
      if (options.loseCreation) throw new Error('Network request failed');
      return { asid: 'known-session', agent_id: 'codex' };
    },
    markAgentUsed: () => {},
    useHomeTaskCards: {
      getState: () => ({
        unconfirmed: (_id: string, asid: string | undefined, draft: PendingResend) =>
          unknown.push({ asid, draft }),
        failed: () => counts.failed++,
        settle: () => counts.settled++,
      }),
    },
    startedThread: (target: { asid: string }) => targets.push(target.asid),
    setUnsure: () => {},
    isAgentDeliveryUnconfirmed,
    homeThreadKey,
    goalTitle,
    recoverWith,
    settleAfter,
    HOME_AGENT_SESSION_ID: 'herdr',
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((s, part, index) => s + part + (values[index] ?? ''), ''),
    console: { warn: () => {} },
  }) as (
    act: () => Promise<void>,
    sent: { goal: string; attachments: string[] }
  ) => Promise<boolean>;
  return {
    run: () =>
      send(
        async () => {
          counts.prompt++;
          throw new Error('Network request failed');
        },
        { goal: 'review', attachments: ['/uploads/one.webp', '/uploads/two.webp'] }
      ),
    counts,
    unknown,
    targets,
    inFlightRef,
  };
}

test.each([false, true])(
  'Home preserves lost %s creation/prompt receipts without a failed resend',
  async (loseCreation) => {
    const h = nativeSend({ loseCreation });
    expect(await h.run()).toBe(false);
    expect(h.counts).toEqual({ create: 1, prompt: loseCreation ? 0 : 1, failed: 0, settled: 0 });
    expect(h.unknown).toEqual([
      {
        asid: loseCreation ? undefined : 'known-session',
        draft: {
          text: 'review',
          attachments: ['/uploads/one.webp', '/uploads/two.webp'],
          params: { agentId: 'codex' },
        },
      },
    ]);
    expect(h.targets).toEqual(loseCreation ? [] : ['known-session']);
    expect(h.inFlightRef.current).toBe(false);
  }
);

test('a refused durable staging budget prevents both session creation and prompt dispatch', async () => {
  const h = nativeSend({ stagingRefused: true });
  expect(await h.run()).toBe(false);
  expect(h.counts.create).toBe(0);
  expect(h.counts.prompt).toBe(0);
  expect(h.unknown).toEqual([]);
  expect(h.inFlightRef.current).toBe(false);
});

test('an unreadable successful session-creation receipt is unknown, never proof of refusal', async () => {
  let creates = 0;
  const create = runInNewContext(
    transpile(
      `${declaration('src/lib/agent-session.ts', 'createAgentSession')}\ncreateAgentSession`
    ),
    {
      writeJson: async () => {
        creates++;
        return null;
      },
      parseAgentSessionInfo: () => null,
    }
  ) as (session: undefined, params: object) => Promise<unknown>;
  const failure: unknown = await create(undefined, {}).then(
    () => null,
    (error: unknown) => error
  );
  expect(isAgentDeliveryUnconfirmed(failure)).toBe(true);
  expect(creates).toBe(1);
});
