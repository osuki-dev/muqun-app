import { z } from 'zod';
import type { AgentFeatures } from './agent-protocol';

const measurement = z.number().finite().nullable();
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000).nullable();
const windowSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  unit: z.string(),
  used: measurement,
  limit: measurement,
  remaining: measurement,
  window_duration_minutes: z.number().int().positive().nullable(),
  resets_at_ms: timestamp,
});
const decimal = z
  .string()
  .max(256)
  .regex(/^-?(?:\d+\.?\d*|\.\d+)$/)
  .nullish();
const creditsSchema = z.object({
  has_credits: z.boolean().nullable(),
  unlimited: z.boolean().nullable(),
  balance: decimal,
});
const bucketSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  windows: z.array(windowSchema),
  plan_type: z.string().nullish(),
  model_id: z.string().nullish(),
  credits: creditsSchema.nullish(),
  individual_limit: z
    .object({
      used: decimal,
      limit: decimal,
      remaining_percent: measurement,
      resets_at_ms: timestamp,
    })
    .nullish(),
  spend_control_reached: z.boolean().nullish(),
  limit_reached_reason: z.string().nullish(),
});
const schema = z.object({
  status: z.enum(['available', 'unavailable']),
  reason: z.enum(['not_authenticated', 'temporarily_unavailable']).nullable(),
  observed_at_ms: timestamp.unwrap(),
  ordinary_usage_allowed: z.boolean().nullable(),
  reset_credits: z
    .object({
      available_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
      credits: z
        .array(
          z.object({
            status: z.string().nullable(),
            reset_type: z.string().nullable(),
            expires_at_ms: timestamp,
            title: z.string().nullable(),
          })
        )
        .nullable(),
    })
    .nullish(),
  limits: z.array(bucketSchema),
});
export type AgentAccountLimits = z.infer<typeof schema>;
export type AccountLimitBucket = z.infer<typeof bucketSchema>;
export type AccountCredits = z.infer<typeof creditsSchema>;
export type AccountLimitWindow = z.infer<typeof windowSchema>;

export function parseAgentAccountLimits(value: unknown): AgentAccountLimits {
  return schema.parse(value);
}

export function canReadAgentAccountLimits(
  capabilities: readonly string[] | null | undefined,
  features: Pick<AgentFeatures, 'accountLimits'> | null | undefined
): boolean {
  return (
    capabilities?.includes('agent_account_limits_v1') === true && features?.accountLimits === true
  );
}

/** Official credits priority: unlimited, reported balance, available, then unavailable/unknown. */
export function accountCreditState(
  credits: AccountCredits
): 'unlimited' | 'balance' | 'available' | 'unavailable' | 'unknown' {
  if (credits.unlimited === true) return 'unlimited';
  if (credits.balance != null) return 'balance';
  if (credits.has_credits === true) return 'available';
  if (credits.has_credits === false) return 'unavailable';
  return 'unknown';
}

/** Metadata alone must not leave an empty quota heading. */
export function hasAccountLimitValues(bucket: AccountLimitBucket): boolean {
  return (
    bucket.windows.length > 0 ||
    (bucket.credits != null && Object.values(bucket.credits).some((value) => value != null)) ||
    (bucket.individual_limit != null &&
      Object.values(bucket.individual_limit).some((value) => value != null)) ||
    bucket.spend_control_reached != null ||
    bucket.limit_reached_reason != null
  );
}

// Matches the official CLI status snapshot threshold. No polling is required.
export const ACCOUNT_LIMIT_STALE_MS = 15 * 60_000;
