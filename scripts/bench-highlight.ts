// Artifact syntax-highlighting micro-benchmark (bun run scripts/bench-highlight.ts).
//
// Card #634 sets two fallback gates -- HIGHLIGHT_MAX_BYTES and
// HIGHLIGHT_MAX_LINES -- and they have to come from measurement rather than
// from a round number that felt safe. This is the measurement.
//
// It reports, per input: wall-clock time for `highlightFile`, the number of
// spans the viewer would have to mount, and the line count. The two gates cover
// different failure modes, which is why both are printed:
//
//   * tokenizing is linear in characters (highlight.js is a regex machine)
//   * rendering is linear in *spans*, and React Native's cost per nested <Text>
//     is far above highlight.js's cost per character
//
// A minified bundle is few lines and slow to tokenize; a build log is many
// lines and fast. Neither gate alone catches both.
//
// Bun runs a newer JSC than a phone does, so the gates are set well under what
// this machine tolerates.

import { highlightFile } from '../src/lib/code-highlight';

const TS_SAMPLE = `
/**
 * A chunk of ordinary application code, which is what the tokenizer will
 * actually meet: comments, strings, generics, numbers, template literals.
 */
import { useCallback, useMemo } from 'react';

export interface PaneRecord {
  id: string;
  title: string;
  status: 'working' | 'idle' | 'blocked';
  createdAt: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const ENDPOINT = \`/api/sessions/\${encodeURIComponent('default')}/panes\`;

export function usePaneSummary(records: PaneRecord[], filter?: string) {
  const matching = useMemo(
    () => records.filter((record) => !filter || record.title.includes(filter)),
    [filter, records]
  );

  return useCallback(async () => {
    const response = await fetch(ENDPOINT, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!response.ok) throw new Error(\`HTTP \${response.status}: could not load panes\`);
    return matching.map((record) => ({ ...record, age: Date.now() - record.createdAt }));
  }, [matching]);
}
`.trim();

const DIFF_SAMPLE = `
diff --git a/src/app/panels.tsx b/src/app/panels.tsx
index 9b0ba61..3c4f6a3 100644
--- a/src/app/panels.tsx
+++ b/src/app/panels.tsx
@@ -12,7 +12,7 @@ export default function PanelPickerScreen() {
   const router = useRouter();
-  const [tabId, setTabId] = useState('');
+  const groups = useSessionGroups(workspaceId);
   const [loading, setLoading] = useState(true);
`.trim();

const LOG_SAMPLE = '2026-07-27T04:44:01.221Z  info  gateway: pane pane-1 wrote 128 bytes';

/** Repeat a sample until it is at least `bytes` long, keeping it valid-ish. */
function grow(sample: string, bytes: number): string {
  const times = Math.max(1, Math.ceil(bytes / (sample.length + 1)));
  return Array.from({ length: times }, () => sample).join('\n').slice(0, bytes);
}

function measure(label: string, name: string, text: string, runs: number) {
  // One warm run so registration and JIT warm-up are not charged to the first
  // measured size.
  highlightFile(name, text);

  const started = performance.now();
  let result = highlightFile(name, text);
  for (let index = 1; index < runs; index += 1) result = highlightFile(name, text);
  const perRun = (performance.now() - started) / runs;

  const spans = result.lines.reduce((total, line) => total + line.spans.length, 0);
  console.log(
    [
      label.padEnd(26),
      String(text.length).padStart(8),
      `${perRun.toFixed(2)} ms`.padStart(10),
      String(spans).padStart(8),
      String(result.lines.length).padStart(7),
      result.skipped ? `skipped:${result.skipped}` : result.language ?? 'plain',
    ].join('  ')
  );
}

console.log(
  ['input'.padEnd(26), 'chars'.padStart(8), 'time'.padStart(10), 'spans'.padStart(8), 'lines'.padStart(7), 'result'].join('  ')
);
console.log('-'.repeat(88));

measure('diff (small)', 'theme.diff', DIFF_SAMPLE, 200);
measure('json (small)', 'coverage.json', '{"total": 91.4, "files": [{"path": "a.ts", "pct": 88}]}', 200);

for (const kib of [16, 64, 128, 256, 512]) {
  measure(`typescript ${kib} KiB`, 'sample.ts', grow(TS_SAMPLE, kib * 1024), kib > 128 ? 5 : 20);
}

for (const kib of [64, 256, 512]) {
  measure(`diff ${kib} KiB`, 'big.diff', grow(DIFF_SAMPLE, kib * 1024), 10);
}

// The span-count failure mode, isolated: many short lines, cheap to tokenize.
for (const lines of [2_000, 10_000, 40_000]) {
  measure(
    `log ${lines} lines`,
    'run.log',
    Array.from({ length: lines }, () => LOG_SAMPLE).join('\n'),
    5
  );
}

// The other failure mode: few lines, expensive to tokenize.
measure('minified 256 KiB (1 line)', 'bundle.js', `const a=${'"x",'.repeat(64 * 1024)}0;`, 5);
