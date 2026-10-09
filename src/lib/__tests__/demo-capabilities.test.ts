import { describe, expect, test } from 'bun:test';

import { DEMO_CAPABILITIES } from '@/lib/demo-capabilities';

describe('DEMO_CAPABILITIES', () => {
  test('declares the P1 companion features the demo fixtures answer', () => {
    const capabilities = DEMO_CAPABILITIES;
    for (const id of ['task_ledger', 'fleet', 'mcp_server']) {
      expect(capabilities).toContain(id);
    }
  });
});
