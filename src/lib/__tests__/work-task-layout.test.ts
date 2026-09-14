import { expect, test } from 'bun:test';
import {
  captureWorkLayoutAnchor,
  restoreWorkLayoutAnchor,
  workTaskDockLimit,
  workTaskPaneMetrics,
} from '../work-task-layout';
test('safe width and scaled text determine the split without device heuristics', () => {
  expect(workTaskPaneMetrics(823, 1).split).toBe(false);
  expect(workTaskPaneMetrics(824, 1).split).toBe(true);
  expect(workTaskPaneMetrics(1200, 2).split).toBe(false);
  expect(workTaskPaneMetrics(1624, 2).split).toBe(true);
});
test('remeasures stable section anchors and cancels restoration after dragging', () => {
  const anchor = captureWorkLayoutAnchor(
    235,
    new Map([
      ['result:old', 200],
      ['result:new', 400],
    ])
  );
  expect(anchor).toEqual({ id: 'result:old', offset: 35, raw: 235 });
  expect(restoreWorkLayoutAnchor(anchor, new Map([['result:old', 350]]), 1000, 300, false)).toBe(
    385
  );
  expect(restoreWorkLayoutAnchor(anchor, new Map(), 300, 200, false)).toBe(100);
  expect(restoreWorkLayoutAnchor(anchor, new Map(), 1000, 300, true)).toBeNull();
});
test('dock leaves reading space with software or hardware keyboards', () => {
  expect(workTaskDockLimit(800, 300)).toBe(300);
  expect(workTaskDockLimit(800, 0)).toBe(480);
  expect(workTaskDockLimit(300, 500)).toBe(0);
});
