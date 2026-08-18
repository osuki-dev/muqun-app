// Drive a live pane through the loopback gateway and assert the pane
// read/hold contract continuously. Card #721.
//
//   bun scripts/terminal-soak.ts --pane wM:p1F --minutes 60
//
// It reads a paired device token from `dist/soak/device-token.txt`, or from
// wherever `MUQUN_SOAK_TOKEN_FILE` points; `MUQUN_SOAK_GATEWAY` and
// `MUQUN_SOAK_SESSION` name the gateway and session it talks to.
//
// This is the thing that would have caught every one of the last two days'
// bugs before Ellen did. It runs the *real* `foldPaneRead` -- the same function
// the app runs, imported, not reimplemented -- over the reads a real gateway
// gives for a real pane under real load, and checks the four invariants after
// every single fold. A violation is reported with the frames that caused it, so
// the report is a reproduction rather than a complaint.
//
// It reproduces the app's actual loop, which is the part that matters: an SSE
// subscription with `stream_pane` set, inline frames painted straight from the
// event, a periodic HTTP refresh at whatever depth the reader has paged to, and
// an occasional page down. Those three sources folding into one window is the
// whole subject of the card.
//
// ## Ground truth against a live pane
//
// `scripts/terminal-soak-load.py` stamps every transcript row `«000123»`. The
// window's stamps must be strictly increasing, always. That single check is
// invariant (a) -- no reordering, no duplication -- and it needs no oracle and
// no recording, which is what makes it safe to run for hours.
//
// ## What it will not touch
//
// Panes it did not create are read-only and are never written to, never
// resized, never focused. Pass `--pane` explicitly; there is no discovery, on
// purpose.
import { foldPaneRead, type PaneReadOrigin } from '../src/terminal/history';

// The subset of the Bun runtime this script uses, declared locally rather than
// depending on `@types/bun` -- the same shape `scripts/bench-terminal.ts` uses,
// for the same reason: the project keeps `tsc --noEmit` honest without taking a
// dependency for four functions.
declare const Bun: {
  file(path: string): { text(): Promise<string> };
  write(path: string, contents: string): Promise<number>;
  sleep(milliseconds: number): Promise<void>;
};

const GATEWAY = process.env.MUQUN_SOAK_GATEWAY ?? 'http://127.0.0.1:24847';
/**
 * A file holding one paired device token for {@link GATEWAY}, and nothing
 * else. The default is under `dist/`, which is gitignored, because a token is
 * not a thing to leave lying in the tree -- point `MUQUN_SOAK_TOKEN_FILE`
 * somewhere else if you keep yours elsewhere. The path is relative to the
 * working directory, so run this from the repository root, which is where
 * every other script in here is run from.
 */
const TOKEN_PATH = process.env.MUQUN_SOAK_TOKEN_FILE ?? 'dist/soak/device-token.txt';
const SESSION = process.env.MUQUN_SOAK_SESSION ?? 'default';

// The app's own numbers, so the soak paged the way a reader does.
const INITIAL_LINES = 240;
const PAGE_LINES = 240;
const MAX_LINES = 2_000;

type Args = { pane: string; minutes: number; report: string };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const read = (name: string, fallback?: string): string => {
    const at = argv.indexOf(`--${name}`);
    if (at >= 0 && argv[at + 1]) return argv[at + 1];
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  };
  return {
    pane: read('pane'),
    minutes: Number(read('minutes', '60')),
    report: read('report', `/tmp/terminal-soak-${Date.now()}.json`),
  };
}

type Violation = {
  at: string;
  elapsedSeconds: number;
  invariant: 'a' | 'b' | 'c' | 'd';
  detail: string;
  origin: PaneReadOrigin;
  fold: number;
  // The frames that caused it, verbatim, which is what makes this a report
  // worth waking up to rather than a counter.
  incoming: string[];
  windowBefore: string[];
  windowAfter: string[];
};

const STAMP = /^«(\d{6})»/u;

/** The transcript stamps a window holds, in the order it holds them. */
function stamps(rows: readonly string[]): number[] {
  const found: number[] = [];
  for (const row of rows) {
    const match = STAMP.exec(row);
    if (match) found.push(Number(match[1]));
  }
  return found;
}

/** The widest block immediately followed by a verbatim copy of itself. */
function adjacentRepeat(rows: readonly string[]): { at: number; size: number } | null {
  for (let size = Math.min(200, Math.floor(rows.length / 2)); size >= 4; size -= 1) {
    for (let at = 0; at + 2 * size <= rows.length; at += 1) {
      let same = true;
      let carried = 0;
      for (let step = 0; step < size; step += 1) {
        if (rows[at + step] !== rows[at + size + step]) { same = false; break; }
        if (rows[at + step].trim() !== '') carried += 1;
      }
      if (same && carried >= 4) return { at, size };
    }
  }
  return null;
}

/**
 * Rows the load generator pins to the bottom and that must never be history.
 *
 * Compared after trimming: herdr strips trailing spaces off a row on the way
 * out, so the prompt row arrives as `❯` and not as the `❯ ` that was drawn.
 */
const FURNITURE = ['❯', '⏵⏵ accept edits on', '✻ agent: sonnet · muqun-soak-721'];

async function main(): Promise<void> {
  const args = parseArgs();
  let token: string;
  try {
    token = (await Bun.file(TOKEN_PATH).text()).trim();
  } catch {
    // The unreadable-file case is the common one and ENOENT does not say which
    // of the two things to do about it.
    throw new Error(
      `cannot read a device token from ${TOKEN_PATH}. Pair a device with the ` +
        `gateway at ${GATEWAY}, write its token there, or set MUQUN_SOAK_TOKEN_FILE.`,
    );
  }
  const auth = { Authorization: `Bearer ${token}` };
  const started = Date.now();
  const deadline = started + args.minutes * 60_000;

  let window = '';
  let lineLimit = INITIAL_LINES;
  let depthFloor = 0;
  let folds = 0;
  const counts: Record<PaneReadOrigin, number> = { refresh: 0, page: 0, rangePage: 0, frame: 0 };
  const violations: Violation[] = [];
  const seen = new Set<string>();

  /** One fold, then every invariant, then the frames if any of them broke. */
  const fold = (incoming: string, origin: PaneReadOrigin): void => {
    if (!incoming) return;
    const before = window;
    const next = foldPaneRead(window, incoming, origin, lineLimit);
    folds += 1;
    counts[origin] += 1;

    const beforeRows = before ? before.split('\n') : [];
    const afterRows = next ? next.split('\n') : [];
    const record = (invariant: Violation['invariant'], detail: string): void => {
      // One example per distinct failure shape: an hour of the same bug is one
      // bug, and a report nobody can read is a report nobody reads.
      const fingerprint = `${invariant}:${detail.replace(/\d+/gu, '#')}`;
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      // Written out the moment it happens, not at the end. An hour-long run
      // that can only be read once it is over is an hour you cannot debug.
      queueMicrotask(() => {
        void Bun.write(args.report, JSON.stringify({ folds, violations }, null, 2));
      });
      violations.push({
        at: new Date().toISOString(),
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
        invariant, detail, origin, fold: folds,
        incoming: incoming.split('\n'),
        windowBefore: beforeRows,
        windowAfter: afterRows,
      });
    };

    // (a) supersequence in arrival order: the stamps only ever go up.
    const order = stamps(afterRows);
    for (let index = 1; index < order.length; index += 1) {
      if (order[index] <= order[index - 1]) {
        record('a', `stamp ${order[index]} follows ${order[index - 1]} at row ${index}`);
        break;
      }
    }

    // (b) no source shrinks the depth the reader paged to.
    //
    // Measured as the *head* of the window, not its row count. A raw row count
    // is the wrong meter and the first run of this harness proved it: taking a
    // stale composer off the tail legitimately drops six rows, and a window
    // going 480 -> 474 that way has lost no history at all. What the reader
    // paged to is the oldest row they can still reach, so the question is
    // whether the top of the window moved down -- and it may only do that when
    // the window is against its own ceiling and is trimming, which is the one
    // licensed way rows leave from above.
    const oldest = order.length > 0 ? order[0] : null;
    if (oldest !== null) {
      if (depthFloor > 0 && oldest > depthFloor && afterRows.length < lineLimit) {
        record('b', `oldest row went from «${depthFloor}» to «${oldest}» with the window ${afterRows.length}/${lineLimit} rows -- not full, so nothing licensed the loss`);
      }
      depthFloor = oldest;
    }

    // (c) furniture is never history: the pinned box exists once, at the tail.
    for (const row of FURNITURE) {
      const at = afterRows.map((value, index) => (value.trim() === row ? index : -1)).filter((i) => i >= 0);
      if (at.length > 1) {
        record('c', `pinned row ${JSON.stringify(row)} appears ${at.length} times, at ${at.join(',')}`);
        break;
      }
    }

    // (d) identical adjacent blocks never accumulate.
    const repeat = adjacentRepeat(afterRows);
    if (repeat) record('d', `${repeat.size} rows repeated at ${repeat.at}`);

    window = next;
  };

  const readPane = async (lines: number): Promise<string> => {
    const url = `${GATEWAY}/api/sessions/${SESSION}/panes/${encodeURIComponent(args.pane)}`
      + `/output?source=recent-unwrapped&lines=${lines}&format=text`;
    const response = await fetch(url, { headers: auth });
    if (!response.ok) throw new Error(`read ${response.status}`);
    const body = await response.json() as { result?: { read?: { text?: string } } };
    return body.result?.read?.text ?? '';
  };

  console.log(`soaking ${args.pane} for ${args.minutes} min against ${GATEWAY}`);

  // The event stream, exactly as `use-pane-events.ts` opens it: inline output
  // for this pane, painted straight from the event with no read round-trip.
  const streamParams = new URLSearchParams({
    types: 'pane_updated',
    stream_pane: args.pane,
    stream_format: 'text',
    stream_source: 'recent-unwrapped',
  });
  const aborter = new AbortController();
  const streamed = (async () => {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(
          `${GATEWAY}/api/sessions/${SESSION}/events?${streamParams}`,
          { headers: auth, signal: aborter.signal }
        );
        if (!response.body) throw new Error('no stream body');
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          let cut = buffer.indexOf('\n\n');
          while (cut >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            for (const line of block.split('\n')) {
              if (!line.startsWith('data:')) continue;
              try {
                const payload = JSON.parse(line.slice(5).trim()) as
                  { data?: { output?: string; pane?: { pane_id?: string } } };
                if (payload.data?.pane?.pane_id !== args.pane) continue;
                if (typeof payload.data?.output === 'string') fold(payload.data.output, 'frame');
              } catch { /* a partial line is not an event */ }
            }
            cut = buffer.indexOf('\n\n');
          }
          if (Date.now() >= deadline) break;
        }
      } catch (failure) {
        if (aborter.signal.aborted) return;
        console.warn('stream dropped, reconnecting:', String(failure));
        await Bun.sleep(1_000);
      }
    }
  })();

  // The poll and the pager, on the app's own cadence.
  let sincePage = 0;
  while (Date.now() < deadline) {
    await Bun.sleep(1_000);
    try {
      fold(await readPane(lineLimit), 'refresh');
    } catch (failure) {
      console.warn('refresh failed:', String(failure));
    }
    sincePage += 1;
    // A reader pulling down for more, and eventually letting go and starting
    // over -- which is when a window that shrank on a page would be noticed.
    if (sincePage >= 20) {
      sincePage = 0;
      if (lineLimit >= MAX_LINES) {
        lineLimit = INITIAL_LINES;
        depthFloor = 0;
        window = '';
      } else {
        const next = Math.min(MAX_LINES, lineLimit + PAGE_LINES);
        try {
          const page = await readPane(next);
          lineLimit = next;
          fold(page, 'page');
        } catch (failure) {
          console.warn('page failed:', String(failure));
        }
      }
    }
    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    process.stdout.write(
      `\r${minutes} min  folds ${folds} `
      + `(refresh ${counts.refresh} page ${counts.page} frame ${counts.frame})  `
      + `window ${window ? window.split('\n').length : 0} rows  `
      + `violations ${violations.length}   `
    );
  }
  aborter.abort();
  await streamed.catch(() => undefined);

  const report = {
    pane: args.pane,
    startedAt: new Date(started).toISOString(),
    hours: Number(((Date.now() - started) / 3_600_000).toFixed(3)),
    folds,
    byOrigin: counts,
    violations,
  };
  await Bun.write(args.report, JSON.stringify(report, null, 2));
  console.log(`\n\n${folds} folds (${JSON.stringify(counts)})`);
  console.log(`${violations.length} distinct violations -> ${args.report}`);
  for (const violation of violations) {
    console.log(`  (${violation.invariant}) ${violation.detail}  [${violation.origin}, fold ${violation.fold}]`);
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

void main();
