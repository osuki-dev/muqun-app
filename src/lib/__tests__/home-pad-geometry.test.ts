import { describe, expect, test } from 'bun:test';
import { padLowerBandLayout } from '@/lib/home-pad-geometry';

describe('padLowerBandLayout', () => {
  test('wide pad gives two continue columns and a 320 connections column', () => {
    const l = padLowerBandLayout(1500);
    expect(l.columns).toBe(2);
    expect(l.connectionsWidth).toBe(320);
    expect(l.continueWidth + l.gap + l.connectionsWidth).toBe(1500);
  });
  test('narrow content falls back to one column and stacks connections', () => {
    const l = padLowerBandLayout(740);
    expect(l.columns).toBe(1);
    expect(l.connectionsWidth).toBe(740);
    expect(l.continueWidth).toBe(740);
  });
});
