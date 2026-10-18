import { expect, test } from 'bun:test';

import { isNetworkChange } from '../network-events';

test('the first report is a baseline, not a change', () => {
  expect(isNetworkChange(null, { isConnected: true, type: 'WIFI' })).toBe(false);
});

test('connectivity or the kind of network changing is a change', () => {
  const wifi = { isConnected: true, type: 'WIFI' };
  expect(isNetworkChange(wifi, { isConnected: true, type: 'CELLULAR' })).toBe(true);
  expect(isNetworkChange(wifi, { isConnected: false, type: 'WIFI' })).toBe(true);
  expect(isNetworkChange({ isConnected: false, type: 'NONE' }, wifi)).toBe(true);
});

test('the same network reported again is not', () => {
  const wifi = { isConnected: true, type: 'WIFI' };
  expect(isNetworkChange(wifi, { ...wifi })).toBe(false);
});
