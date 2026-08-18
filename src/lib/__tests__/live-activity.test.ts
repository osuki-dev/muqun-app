// What the Lock Screen is allowed to say about an agent (card #595).
//
// The card itself cannot be rendered here, so what is tested is the
// reconciliation the module does on the caller's behalf: which selection means
// start, which means update, and -- the parts that went wrong -- which means
// the card on screen has to go away rather than be relabelled, and what happens
// to a card the app has already lost its handle to.
import * as bunTest from 'bun:test';

const { beforeEach, describe, expect, test } = bunTest;
// `mock` is missing from the bun:test typings this project resolves, but the
// runtime has it; module mocking is the only way to reach a module that pulls
// in the native widget bridge.
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

mockModule('react-native', () => ({
  Platform: { OS: 'ios', Version: '17.0' },
}));

type EndCall = { dismissal: unknown; props: unknown };
type FakeActivity = {
  update?: (props: unknown) => Promise<void>;
  end: (dismissal: unknown, props: unknown) => Promise<void>;
};

const started: unknown[] = [];
const updated: unknown[] = [];
const ended: EndCall[] = [];
// Ends recorded for cards this run has no handle to -- what an earlier launch
// of the app left behind, reachable only through `getInstances`.
const sweptEnds: EndCall[] = [];

/** Stands in for ActivityKit's own list of what the user can currently see. */
const onScreen: FakeActivity[] = [];

function takeOffScreen(activity: FakeActivity): void {
  const index = onScreen.indexOf(activity);
  if (index >= 0) onScreen.splice(index, 1);
}

/** Puts up a card the module cannot reach through `current`. */
function leaveCardFromPreviousRun(): void {
  const leftover: FakeActivity = {
    end(dismissal: unknown, props: unknown) {
      sweptEnds.push({ dismissal, props });
      takeOffScreen(leftover);
      return Promise.resolve();
    },
  };
  onScreen.push(leftover);
}

mockModule('../live-activity-layout', () => ({
  default: {
    start(props: unknown) {
      started.push(props);
      const activity: FakeActivity = {
        update(next: unknown) {
          updated.push(next);
          return Promise.resolve();
        },
        end(dismissal: unknown, props: unknown) {
          ended.push({ dismissal, props });
          takeOffScreen(activity);
          return Promise.resolve();
        },
      };
      onScreen.push(activity);
      return activity;
    },
    getInstances() {
      return [...onScreen];
    },
  },
}));

const { endAgentActivity, syncAgentActivity } = await import('../live-activity');

function agent(id: string, status: 'working' | 'idle' | 'blocked' | 'done') {
  return { agentId: id, agentName: `${id} name`, status, detail: `${id} detail` };
}

/** True when the activity was ended with a dismissal date rather than at once. */
function lingers(dismissal: unknown): boolean {
  return (
    typeof dismissal === 'object' &&
    dismissal !== null &&
    (dismissal as { after?: unknown }).after instanceof Date
  );
}

beforeEach(async () => {
  await endAgentActivity('immediate');
  onScreen.length = 0;
  started.length = 0;
  updated.length = 0;
  ended.length = 0;
  sweptEnds.length = 0;
});

describe('syncAgentActivity', () => {
  test('a working agent takes the Lock Screen slot', async () => {
    await syncAgentActivity(agent('a', 'working'));
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ agentName: 'a name', status: 'working', detail: 'a detail' });
  });

  test('the same agent staying live is an update, not a second card', async () => {
    await syncAgentActivity(agent('a', 'working'));
    await syncAgentActivity({ ...agent('a', 'blocked'), detail: 'waiting on you' });
    expect(started).toHaveLength(1);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: 'blocked', detail: 'waiting on you' });
  });

  test('a different working agent replaces the card', async () => {
    await syncAgentActivity(agent('a', 'working'));
    await syncAgentActivity(agent('b', 'working'));
    expect(ended).toHaveLength(1);
    expect(ended[0].dismissal).toBe('immediate');
    expect(started).toHaveLength(2);
    expect(started[1]).toMatchObject({ agentName: 'b name' });
  });

  test('the watched agent finishing leaves its own result on screen', async () => {
    await syncAgentActivity(agent('a', 'working'));
    await syncAgentActivity(agent('a', 'idle'));
    expect(ended).toHaveLength(1);
    expect(lingers(ended[0].dismissal)).toBe(true);
    expect(ended[0].props).toMatchObject({ agentName: 'a name', status: 'idle' });
  });

  test('looking at a different idle agent clears the card instead of relabelling it', async () => {
    await syncAgentActivity(agent('a', 'working'));
    await syncAgentActivity(agent('b', 'idle'));
    expect(started).toHaveLength(1);
    expect(ended).toHaveLength(1);
    // The card belonged to `a`; `b` has nothing to say about it, so it goes
    // rather than lingering for five minutes under the wrong name.
    expect(ended[0].dismissal).toBe('immediate');
    expect(ended[0].props).toBe(undefined);
  });

  test('deselecting everything clears the card at once', async () => {
    await syncAgentActivity(agent('a', 'working'));
    await syncAgentActivity(null);
    expect(ended).toHaveLength(1);
    expect(ended[0].dismissal).toBe('immediate');
    expect(ended[0].props).toBe(undefined);
  });

  test('an agent that was never live does not end a card that is not there', async () => {
    await syncAgentActivity(agent('a', 'idle'));
    expect(started).toHaveLength(0);
    expect(ended).toHaveLength(0);
  });

  test('a card left by a previous app run is cleared, not stacked on', async () => {
    leaveCardFromPreviousRun();
    await syncAgentActivity(agent('a', 'working'));
    expect(sweptEnds).toHaveLength(1);
    expect(sweptEnds[0].dismissal).toBe('immediate');
    expect(started).toHaveLength(1);
    expect(onScreen).toHaveLength(1);
  });

  test('a card left by a previous app run goes even when nothing new starts', async () => {
    leaveCardFromPreviousRun();
    await syncAgentActivity(agent('a', 'idle'));
    expect(started).toHaveLength(0);
    expect(sweptEnds).toHaveLength(1);
  });

  test('a run left to linger is not swept away by the next reconcile', async () => {
    await syncAgentActivity(agent('a', 'working'));
    leaveCardFromPreviousRun();
    await syncAgentActivity(agent('a', 'idle'));
    expect(sweptEnds).toHaveLength(0);
  });
});

describe('endAgentActivity', () => {
  // Turning the setting off is the one path with no screen behind it: the app
  // may have been relaunched since the card went up, so there is nothing in the
  // module's own state to end and the sweep is all that stands between the user
  // and a card they just asked to be rid of.
  test('clears a card this run never started', async () => {
    leaveCardFromPreviousRun();
    await endAgentActivity('immediate');
    expect(sweptEnds).toHaveLength(1);
    expect(sweptEnds[0].dismissal).toBe('immediate');
    expect(onScreen).toHaveLength(0);
  });
});
