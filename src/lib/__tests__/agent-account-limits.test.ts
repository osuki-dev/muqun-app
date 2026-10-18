import { describe, expect, test } from 'bun:test';
import {
  canReadAgentAccountLimits,
  parseAgentAccountLimits,
  accountCreditState,
  hasAccountLimitValues,
} from '../agent-account-limits';
import { parseAgentFeatures } from '../agent-protocol';

const snapshot = {
  status: 'available' as const,
  reason: null,
  observed_at_ms: 1800000000000,
  ordinary_usage_allowed: null,
  limits: [
    {
      id: 'opaque',
      name: null,
      windows: [
        {
          id: 'arbitrary-window',
          label: null,
          unit: 'future-unit',
          used: null,
          limit: null,
          remaining: null,
          window_duration_minutes: null,
          resets_at_ms: null,
        },
      ],
    },
  ],
};

describe('optional account limits contract', () => {
  test('requires both explicit gates, including after discovery mirror parsing', () => {
    const enabled = parseAgentFeatures({ accountLimits: true });
    const capability = ['agent_account_limits_v1'];
    expect(canReadAgentAccountLimits(capability, enabled)).toBe(true);
    expect(canReadAgentAccountLimits(capability, parseAgentFeatures(enabled))).toBe(true);
    for (const features of [undefined, {}, { accountLimits: 'true' }, { accountLimits: false }]) {
      expect(canReadAgentAccountLimits(capability, parseAgentFeatures(features))).toBe(false);
    }
    expect(canReadAgentAccountLimits([], enabled)).toBe(false);
    expect(canReadAgentAccountLimits(undefined, enabled)).toBe(false);
  });
  test('preserves arbitrary units, opaque IDs and unknown measurements without inventing zero', () => {
    expect(parseAgentAccountLimits(snapshot)).toEqual(snapshot);
    const windows = [300, 10080, 73].map((duration, index) => ({
      ...snapshot.limits[0]!.windows[0]!,
      id: `window-${index}`,
      unit: 'percent',
      used: 120,
      limit: 100,
      remaining: 0,
      window_duration_minutes: duration,
    }));
    const parsed = parseAgentAccountLimits({
      ...snapshot,
      limits: [{ id: 'other-provider', name: 'Plan', windows }],
    });
    expect(parsed.limits[0]!.windows).toEqual(windows);
    expect(parsed.ordinary_usage_allowed).toBeNull();
  });
  test('allows no windows and explicit unavailable reasons', () => {
    expect(parseAgentAccountLimits({ ...snapshot, limits: [] }).limits).toEqual([]);
    for (const reason of ['not_authenticated', 'temporarily_unavailable'] as const) {
      expect(
        parseAgentAccountLimits({ ...snapshot, status: 'unavailable', reason, limits: [] }).reason
      ).toBe(reason);
    }
  });
  test('rejects malformed quota evidence instead of displaying fabricated measurements', () => {
    for (const value of [NaN, Infinity, '42', undefined]) {
      expect(() =>
        parseAgentAccountLimits({
          ...snapshot,
          limits: [
            {
              ...snapshot.limits[0],
              windows: [{ ...snapshot.limits[0]!.windows[0], remaining: value }],
            },
          ],
        })
      ).toThrow();
    }
    expect(() => parseAgentAccountLimits({ ...snapshot, observed_at_ms: 1e20 })).toThrow();
    expect(() =>
      parseAgentAccountLimits({ ...snapshot, ordinary_usage_allowed: 'false' })
    ).toThrow();
  });
});

test('optional official details preserve decimal amounts, upstream percentages and authoritative reset counts', () => {
  const parsed = parseAgentAccountLimits({
    ...snapshot,
    reset_credits: {
      available_count: 12,
      credits: [
        { title: null, status: 'future-status', reset_type: 'future-type', expires_at_ms: null },
      ],
    },
    limits: [
      {
        ...snapshot.limits[0],
        windows: [],
        credits: { unlimited: false, has_credits: true, balance: '9007199254740993.125' },
        individual_limit: { used: '25', limit: '50', remaining_percent: 17, resets_at_ms: null },
      },
    ],
  });
  expect(parsed.limits[0]!.credits!.balance).toBe('9007199254740993.125');
  expect(parsed.limits[0]!.individual_limit!.remaining_percent).toBe(17);
  expect(parsed.reset_credits!.available_count).toBe(12);
  expect(parsed.reset_credits!.credits).toHaveLength(1);
  for (const credits of [null, []]) {
    expect(
      parseAgentAccountLimits({ ...snapshot, reset_credits: { available_count: null, credits } })
        .reset_credits
    ).toEqual({ available_count: null, credits });
  }
  expect(() =>
    parseAgentAccountLimits({
      ...snapshot,
      reset_credits: { available_count: Number.MAX_SAFE_INTEGER + 1, credits: [] },
    })
  ).toThrow();
});

test('credit availability never invents a zero balance and unlimited takes precedence', () => {
  expect(accountCreditState({ unlimited: true, has_credits: false, balance: '0' })).toBe(
    'unlimited'
  );
  expect(accountCreditState({ unlimited: false, has_credits: true, balance: null })).toBe(
    'available'
  );
  expect(accountCreditState({ unlimited: null, has_credits: null, balance: null })).toBe('unknown');
  expect(accountCreditState({ unlimited: false, has_credits: false, balance: null })).toBe(
    'unavailable'
  );
  expect(accountCreditState({ unlimited: false, has_credits: true, balance: '0' })).toBe('balance');
});

test('metadata-only buckets are suppressed while credit and monthly snapshots survive without windows', () => {
  const bucket = {
    ...snapshot.limits[0]!,
    windows: [],
    plan_type: 'future-plan',
    model_id: 'future-model',
  };
  expect(hasAccountLimitValues(bucket)).toBe(false);
  expect(
    hasAccountLimitValues({
      ...bucket,
      credits: { unlimited: null, has_credits: null, balance: null },
      individual_limit: { used: null, limit: null, remaining_percent: null, resets_at_ms: null },
    })
  ).toBe(false);
  expect(
    hasAccountLimitValues({
      ...bucket,
      credits: { unlimited: false, has_credits: true, balance: null },
    })
  ).toBe(true);
  expect(
    hasAccountLimitValues({
      ...bucket,
      individual_limit: { used: null, limit: null, remaining_percent: 28, resets_at_ms: null },
    })
  ).toBe(true);
});
