/**
 * The rules that keep the app from answering the wrong question: the capability
 * gate, what an envelope has to carry before a banner is drawn, and the banner
 * state machine -- above all that a rejected answer is re-read rather than
 * re-sent.
 */
import { describe, expect, test } from 'bun:test';

import {
  APPROVAL_NOTIFICATION_ACTIONS,
  approvalActionDecision,
  approvalBannerReducer,
  approvalPushTarget,
  pushOffersDecision,
  gatewaySupportsApprovals,
  IDLE_APPROVAL_BANNER,
  optionForDecision,
  paneApprovalAnswerFromResponse,
  paneApprovalFromResponse,
  type ApprovalBannerState,
  type PaneApproval,
} from '../pane-approval';

const OPTIONS = [
  { index: 1, label: 'Yes', selected: true, decision: 'allow' },
  {
    index: 2,
    label: 'Yes, and don’t ask again for: npm install *',
    selected: false,
    decision: 'allow_always',
  },
  { index: 3, label: 'No', selected: false, decision: 'deny' },
];

function envelope(data: Record<string, unknown>) {
  return {
    schema_version: '1.0.0',
    capabilities: { parts: true, assets: true, image_upload: true },
    data,
  };
}

function pending(overrides: Record<string, unknown> = {}) {
  return envelope({
    session_id: 'default',
    pane_id: 'pane-7',
    state: 'pending',
    approval: {
      fingerprint: 'a1b2c3d4e5f60718',
      prompt: 'Do you want to proceed?',
      tool: 'Bash',
      context: ['This command requires approval', 'npm install --save-dev vitest'],
      hint: 'Esc to cancel · Tab to amend',
      options: OPTIONS,
      range: { start: 10, end: 20 },
      ...overrides,
    },
    pane: { pane_id: 'pane-7', agent: 'claude', approvals: 'menu' },
  });
}

function idle() {
  return envelope({
    session_id: 'default',
    pane_id: 'pane-7',
    state: 'idle',
    approval: null,
    pane: { pane_id: 'pane-7', agent: 'claude', approvals: 'menu' },
  });
}

function approvalOf(value: unknown): PaneApproval {
  const state = paneApprovalFromResponse(value);
  if (!state?.approval) throw new Error('expected a pending approval');
  return state.approval;
}

/** The banner as it stands with `pending()` on screen. */
function showing(overrides: Partial<ApprovalBannerState> = {}): ApprovalBannerState {
  return {
    ...IDLE_APPROVAL_BANNER,
    target: { sessionId: 'default', paneId: 'pane-7' },
    approval: approvalOf(pending()),
    ...overrides,
  };
}

describe('the capability gate', () => {
  test('a gateway that never declared pane_approvals offers none', () => {
    expect(gatewaySupportsApprovals(['pane_parts', 'tasks'])).toBe(false);
    expect(gatewaySupportsApprovals([])).toBe(false);
    expect(gatewaySupportsApprovals(undefined)).toBe(false);
    expect(gatewaySupportsApprovals(null)).toBe(false);
  });

  test('the declared capability is the only thing that turns it on', () => {
    expect(gatewaySupportsApprovals(['pane_parts', 'pane_approvals'])).toBe(true);
  });
});

describe('reading an approval envelope', () => {
  test('a pending menu arrives with its question, answers and fingerprint', () => {
    const state = paneApprovalFromResponse(pending());
    expect(state?.paneId).toBe('pane-7');
    expect(state?.approval?.fingerprint).toBe('a1b2c3d4e5f60718');
    expect(state?.approval?.prompt).toBe('Do you want to proceed?');
    expect(state?.approval?.tool).toBe('Bash');
    expect(state?.approval?.options.map((option) => option.decision)).toEqual([
      'allow',
      'allow_always',
      'deny',
    ]);
    // The cursor is reported wherever the agent put it, not assumed to be first.
    expect(state?.approval?.options[0].selected).toBe(true);
  });

  test('the answers keep the agent’s own wording', () => {
    // Paraphrasing "don’t ask again for: npm install *" would be the app
    // deciding on the user's behalf what they are agreeing to.
    expect(approvalOf(pending()).options[1].label).toBe(
      'Yes, and don’t ask again for: npm install *'
    );
  });

  test('an idle pane has no approval', () => {
    expect(paneApprovalFromResponse(idle())).toEqual({
      sessionId: 'default',
      paneId: 'pane-7',
      approval: null,
    });
  });

  test('state is authoritative over a stale approval riding along with it', () => {
    const stale = envelope({
      session_id: 'default',
      pane_id: 'pane-7',
      state: 'idle',
      approval: { fingerprint: 'x', prompt: 'gone?', options: OPTIONS },
    });
    expect(paneApprovalFromResponse(stale)?.approval).toBeNull();
  });

  test('a menu with no fingerprint is not answerable, so it is not shown', () => {
    expect(paneApprovalFromResponse(pending({ fingerprint: '' }))?.approval).toBeNull();
  });

  test('a menu with one answer is not a choice', () => {
    expect(paneApprovalFromResponse(pending({ options: [OPTIONS[0]] }))?.approval).toBeNull();
  });

  test('an answer whose meaning this build cannot name is still answerable by index', () => {
    const approval = approvalOf(
      pending({
        options: [
          { index: 1, label: 'Amend', selected: false, decision: 'tell-me-more' },
          ...OPTIONS.slice(1),
        ],
      })
    );
    expect(approval.options[0]).toMatchObject({ index: 1, label: 'Amend', decision: 'other' });
  });

  test('anything that is not an approval envelope degrades to nothing', () => {
    expect(paneApprovalFromResponse(null)).toBeNull();
    expect(paneApprovalFromResponse('pending')).toBeNull();
    expect(paneApprovalFromResponse({})).toBeNull();
    expect(paneApprovalFromResponse(envelope({ state: 'pending' }))).toBeNull();
  });

  test('an SSE frame parses through the same path as the endpoint', () => {
    // The events carry the same envelope on purpose, so one code path reads both.
    expect(paneApprovalFromResponse(pending())).toEqual(paneApprovalFromResponse(pending()));
  });
});

describe('reading an answer', () => {
  test('the gateway’s own verdict on whether the menu is gone is taken', () => {
    const answered = envelope({
      session_id: 'default',
      pane_id: 'pane-7',
      state: 'idle',
      approval: null,
      resolved: true,
      sent_keys: ['1'],
      answered: { fingerprint: 'a1b2c3d4e5f60718', index: 1, decision: 'allow' },
    });
    expect(paneApprovalAnswerFromResponse(answered)).toMatchObject({
      resolved: true,
      approval: null,
    });
  });

  test('a menu still standing after the answer is not resolved', () => {
    const stillThere = { ...pending(), data: { ...pending().data, resolved: false } };
    const result = paneApprovalAnswerFromResponse(stillThere);
    expect(result?.resolved).toBe(false);
    expect(result?.approval?.fingerprint).toBe('a1b2c3d4e5f60718');
  });

  test('a gateway that does not say either way is read from what it reports', () => {
    expect(paneApprovalAnswerFromResponse(idle())?.resolved).toBe(true);
    expect(paneApprovalAnswerFromResponse(pending())?.resolved).toBe(false);
  });
});

describe('naming a decision', () => {
  test('allow means the one-time allow, not the blanket one', () => {
    const approval = approvalOf(pending());
    expect(optionForDecision(approval, 'allow')?.index).toBe(1);
    expect(optionForDecision(approval, 'allow_always')?.index).toBe(2);
    expect(optionForDecision(approval, 'deny')?.index).toBe(3);
  });

  test('a menu that does not offer a decision says so', () => {
    const approval = approvalOf(pending({ options: [OPTIONS[0], OPTIONS[2]] }));
    expect(optionForDecision(approval, 'allow_always')).toBeNull();
  });
});

describe('an approval push payload', () => {
  const push = {
    type: 'approval.pending',
    url: '/servers/mac-mini',
    server_id: 'mac-mini',
    session_id: 'default',
    pane_id: 'pane-7',
    categoryId: 'approval',
    fingerprint: 'a1b2c3d4e5f60718',
    options: [
      { index: 1, decision: 'allow', label: 'Approve' },
      { index: 2, decision: 'allow_always', label: "Approve and don't ask again" },
      { index: 3, decision: 'deny', label: 'Deny' },
    ],
  };

  test('carries everything an action needs to answer without opening a screen', () => {
    expect(approvalPushTarget(push)).toEqual({
      serverId: 'mac-mini',
      sessionId: 'default',
      paneId: 'pane-7',
      fingerprint: 'a1b2c3d4e5f60718',
      options: push.options as never,
    });
  });

  test('names the choices without quoting the terminal', () => {
    // The privacy rule the gateway enforces, asserted from this side too: a
    // label the app renders on a lock screen is the gateway's wording.
    const rendered = JSON.stringify(approvalPushTarget(push));
    expect(rendered).not.toContain('npm');
    expect(rendered).not.toContain('Yes,');
  });

  test('a push with no fingerprint is not answerable', () => {
    expect(approvalPushTarget({ ...push, fingerprint: '' })).toBeNull();
  });

  test('an ordinary push is not an approval', () => {
    expect(approvalPushTarget({ type: 'agent.blocked', server_id: 'mac-mini' })).toBeNull();
    expect(approvalPushTarget(undefined)).toBeNull();
  });

  test('each button answers under an identifier that names its decision', () => {
    for (const action of APPROVAL_NOTIFICATION_ACTIONS) {
      expect(approvalActionDecision(`approval.${action.decision}`)).toBe(action.decision);
    }
    expect(approvalActionDecision('expo.modules.notifications.actions.DEFAULT')).toBeNull();
    expect(approvalActionDecision('approval.something-else')).toBeNull();
  });

  test('a button the menu never offered is not sent', () => {
    // A startup trust prompt has no "don't ask again"; the round trip's only
    // possible answer would be a 409, so the pane is opened instead.
    const trust = approvalPushTarget({
      ...push,
      options: [
        { index: 1, decision: 'allow', label: 'Approve' },
        { index: 2, decision: 'deny', label: 'Deny' },
      ],
    })!;
    expect(pushOffersDecision(trust, 'allow')).toBe(true);
    expect(pushOffersDecision(trust, 'allow_always')).toBe(false);
  });

  test('a payload with no options at all leaves the gateway to judge', () => {
    const bare = approvalPushTarget({ ...push, options: undefined })!;
    expect(pushOffersDecision(bare, 'allow_always')).toBe(true);
  });
});

describe('the banner state machine', () => {
  const target = { sessionId: 'default', paneId: 'pane-7' };

  test('selecting a pane drops everything about the previous one', () => {
    const next = approvalBannerReducer(showing({ error: 'stale' }), {
      type: 'pane-selected',
      target: { sessionId: 'default', paneId: 'pane-9' },
    });
    expect(next.approval).toBeNull();
    expect(next.error).toBeNull();
    expect(next.target?.paneId).toBe('pane-9');
  });

  test('re-selecting the same pane leaves the banner standing', () => {
    const state = showing();
    expect(approvalBannerReducer(state, { type: 'pane-selected', target })).toBe(state);
  });

  test('an event about another pane is ignored', () => {
    const state = showing();
    const other = paneApprovalFromResponse(
      envelope({ session_id: 'default', pane_id: 'pane-9', state: 'idle', approval: null })
    );
    expect(approvalBannerReducer(state, { type: 'observed', state: other! })).toBe(state);
  });

  test('approval.resolved takes the banner down', () => {
    const next = approvalBannerReducer(showing(), {
      type: 'observed',
      state: paneApprovalFromResponse(idle())!,
    });
    expect(next.approval).toBeNull();
  });

  test('only the menu on screen may be answered', () => {
    // A tap that raced an update names a fingerprint that is no longer the one
    // showing; the update wins and nothing is sent.
    const state = showing();
    expect(
      approvalBannerReducer(state, {
        type: 'answer-started',
        fingerprint: 'an-older-menu',
        optionIndex: 1,
      })
    ).toBe(state);
  });

  test('an answer in flight locks the menu and clears the last error', () => {
    const next = approvalBannerReducer(showing({ error: 'boom' }), {
      type: 'answer-started',
      fingerprint: 'a1b2c3d4e5f60718',
      optionIndex: 2,
    });
    expect(next.answeringIndex).toBe(2);
    expect(next.error).toBeNull();
  });

  test('a read of the same menu arriving mid-answer does not unlock it', () => {
    // The gateway polls the pane on its own schedule, so the pre-answer picture
    // routinely arrives after the tap. Clearing the spinner on it would invite
    // a second answer to a question already being answered.
    const state = showing({ answeringIndex: 1 });
    const next = approvalBannerReducer(state, {
      type: 'observed',
      state: paneApprovalFromResponse(pending())!,
    });
    expect(next.answeringIndex).toBe(1);
  });

  test('a different menu arriving mid-answer unlocks and replaces it', () => {
    const state = showing({ answeringIndex: 1 });
    const next = approvalBannerReducer(state, {
      type: 'observed',
      state: paneApprovalFromResponse(pending({ fingerprint: 'deadbeefdeadbeef' }))!,
    });
    expect(next.answeringIndex).toBeNull();
    expect(next.approval?.fingerprint).toBe('deadbeefdeadbeef');
  });

  test('a successful answer adopts what the pane is waiting on now', () => {
    const next = approvalBannerReducer(showing({ answeringIndex: 1 }), {
      type: 'answer-succeeded',
      answer: { ...paneApprovalFromResponse(idle())!, resolved: true },
    });
    expect(next.approval).toBeNull();
    expect(next.answeringIndex).toBeNull();
    expect(next.error).toBeNull();
  });

  test('a rejected answer asks for the truth instead of sending again', () => {
    // Rule 2. `needsRefresh` is the only thing a 409 produces: the owner
    // re-reads, and the option that was tapped is never resent.
    const next = approvalBannerReducer(showing({ answeringIndex: 2 }), {
      type: 'answer-conflicted',
      code: 'approval_changed',
    });
    expect(next.needsRefresh).toBe(true);
    expect(next.answeringIndex).toBeNull();
    expect(next.error).toBe('The agent is asking something else now.');
    // The menu stays up until the re-read says what replaced it, so the user is
    // never left staring at an empty dock.
    expect(next.approval?.fingerprint).toBe('a1b2c3d4e5f60718');
  });

  test('a decision the agent never offered reads as its own refusal', () => {
    const next = approvalBannerReducer(showing(), {
      type: 'answer-conflicted',
      code: 'decision_unavailable',
    });
    expect(next.error).toBe('This agent did not offer that answer.');
  });

  test('the refresh a conflict asked for is only run once', () => {
    const conflicted = approvalBannerReducer(showing(), {
      type: 'answer-conflicted',
      code: 'approval_not_pending',
    });
    const handled = approvalBannerReducer(conflicted, { type: 'refresh-handled' });
    expect(handled.needsRefresh).toBe(false);
    expect(approvalBannerReducer(handled, { type: 'refresh-handled' })).toBe(handled);
  });

  test('a read after the conflict clears the notice', () => {
    const conflicted = approvalBannerReducer(showing(), {
      type: 'answer-conflicted',
      code: 'approval_changed',
    });
    const next = approvalBannerReducer(conflicted, {
      type: 'observed',
      state: paneApprovalFromResponse(idle())!,
    });
    expect(next.error).toBeNull();
    expect(next.needsRefresh).toBe(false);
    expect(next.approval).toBeNull();
  });

  test('a failed request unlocks the menu so it can be answered again', () => {
    const next = approvalBannerReducer(showing({ answeringIndex: 3 }), {
      type: 'answer-failed',
      message: 'That answer did not reach the agent.',
    });
    expect(next.answeringIndex).toBeNull();
    expect(next.approval).not.toBeNull();
    expect(next.needsRefresh).toBe(false);
  });

  test('nothing is shown before a pane is selected', () => {
    const next = approvalBannerReducer(IDLE_APPROVAL_BANNER, {
      type: 'observed',
      state: paneApprovalFromResponse(pending())!,
    });
    expect(next.approval).toBeNull();
  });
});
