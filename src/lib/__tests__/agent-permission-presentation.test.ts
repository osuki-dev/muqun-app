import { expect, test } from 'bun:test';
import { permissionOptionLabel, requestedPermissionsText } from '../agent-permission-presentation';

const labels = {
  allow: '允许',
  allow_always: '始终允许',
  deny: '拒绝',
  once: '允许一次',
  turn: '本轮允许',
};

test('permission labels preserve the exact offered scope and do not infer scope from decision', () => {
  const option = { index: 0, decision: 'allow' as const, label: 'Allow for this turn' };
  expect(permissionOptionLabel(option, labels)).toBe(labels.turn);
  expect(permissionOptionLabel({ ...option, label: 'Allow once' }, labels)).toBe(labels.once);
  expect(permissionOptionLabel({ ...option, label: 'Allow until connection closes' }, labels)).toBe(
    'Allow until connection closes'
  );
  expect(permissionOptionLabel({ ...option, label: 'Allow' }, labels)).toBe(labels.allow);
  expect(option).toEqual({ index: 0, decision: 'allow', label: 'Allow for this turn' });
});

test('permission details retain network, filesystem and unknown fields as plain text', () => {
  const permissions = {
    network: { enabled: true },
    fileSystem: { read: ['/tmp/input'], write: ['/tmp/output<script>'] },
    futureScope: { enabled: false },
  };
  expect(JSON.parse(requestedPermissionsText({ metadata: { permissions } }))).toEqual(permissions);
  expect(requestedPermissionsText({ metadata: { permissions: false } })).toBe('false');
  expect(requestedPermissionsText({ metadata: { diff: 'unrelated' } })).toBe('');
});
