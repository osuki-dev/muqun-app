import { expect, test } from 'bun:test';
import { icpRegistration } from '../icp-registration';

test('ICP requires the CN device region and a configured registration', () => {
  expect(icpRegistration('CN', '  ICP test  ')).toBe('ICP test');
  expect(icpRegistration('cn', 'ICP test')).toBe('ICP test');
  for (const region of ['US', 'HK', 'TW', null, undefined]) {
    expect(icpRegistration(region, 'ICP test')).toBeNull();
  }
  expect(icpRegistration('CN')).toBeNull();
  expect(icpRegistration('CN', '   ')).toBeNull();
});
