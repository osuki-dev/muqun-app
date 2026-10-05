import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const agentSheet = read('../agent-vcs-diff-sheet.tsx');
const paneSheet = read('../git-diff-view.tsx');
const paneRoute = read('../../app/git-diff.tsx');
const paneButton = read('../git-diff-button.tsx');
const sheet = read('../changes-sheet.tsx');

/**
 * One Changes sheet. The agent session's and the terminal pane's are the same
 * component, told apart only by the adapter each wrapper builds, so neither
 * can grow a second design again.
 */
test('both wrappers draw the one shared sheet', () => {
  for (const wrapper of [agentSheet, paneSheet]) {
    expect(wrapper).toContain('<ChangesSheet');
    expect(wrapper).not.toContain('<SheetScene');
    expect(wrapper).not.toContain('<DiffRowList');
  }
  expect(sheet).toContain('<SheetScene');
  expect(sheet).toContain('<DiffRowList');
  expect(sheet).toContain('tree={treeHandlers}');
});

test('the agent wrapper asks the agent session routes', () => {
  expect(agentSheet).toContain('files: getAgentVcsFiles');
  expect(agentSheet).toContain('file: getAgentVcsFile');
  expect(agentSheet).toContain('discard: discardAgentVcsFile');
  expect(agentSheet).toContain('diff: getAgentVcsDiff');
  expect(agentSheet).toContain('agentChangesApi(');
});

test('the pane wrapper asks the pane routes, gated on pane_vcs_files', () => {
  expect(paneSheet).toContain('files: getPaneVcsFiles');
  expect(paneSheet).toContain('file: getPaneVcsFile');
  expect(paneSheet).toContain('discard: discardPaneVcsFile');
  expect(paneSheet).toContain('status: loadGitStatus');
  expect(paneSheet).toContain('diff: loadGitFileDiff');
  expect(paneSheet).toContain('paneChangesApi(');
  expect(paneRoute).toContain("vcsFiles={params.vcsFiles === '1'}");
  expect(paneButton).toContain("vcsFiles: gatewaySupportsPaneVcsFiles(capabilities) ? '1' : '0'");
  // The staged/unstaged tabs are gone.
  expect(paneSheet).not.toContain('SettingsSegmented');
  expect(sheet).not.toContain('git-diff-side');
});

test("a file row's actions button is a sibling of its toggle, not inside it", () => {
  // iOS hides accessible elements nested in an accessible one: the terminal
  // sheet's untracked rows exposed no "Actions for ..." label.
  const rows = read('../change-tree-rows.tsx');
  const fileRow = rows.slice(
    rows.indexOf('export const ChangeTreeFileRowView'),
    rows.indexOf('export const ChangeTreeContextRowView')
  );
  const toggleClosed = fileRow.indexOf('</PressableScale>');
  const menu = fileRow.indexOf('agent-changes-file-menu-');
  expect(toggleClosed).toBeGreaterThan(-1);
  expect(menu).toBeGreaterThan(toggleClosed);
  expect(fileRow).toContain('accessibilityLabel={t`Actions for ${row.name}`}');
});
