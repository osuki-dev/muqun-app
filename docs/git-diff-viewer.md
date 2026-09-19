# A git diff viewer for a pane

**The Gateway runs `git`, the App renders rows.** A pane whose working directory
is a checkout gets one more icon beside the keyboard controls. It opens a
full-height sheet listing the changed files; expanding a file fetches that file's
patch and nothing else. Nothing parses the terminal screen, nothing holds a whole
repository's diff in the JS heap, and a Gateway that has never heard of the
feature makes the icon disappear rather than fail. §5.1 sets out the three-layer
capability model the feature sits in, and the one per-pane context route it adds.

This is the design of record and the research behind it. Numbers marked
_measured_ were run here; numbers marked _estimated_ are extrapolations.

---

## 1. Prior art: `vercel-labs/react-native-diffs`

Read at commit `01a9a60` plus the published `react-native-diffs@1.0.3` tarball:
`README.md`, `package.json`, `nitro.json`, `src/Diffs.nitro.ts`,
`src/DiffsView.native.tsx`, `Diffs.podspec`, `ios/Diffs.swift`,
`android/src/main/java/com/margelo/nitro/diffs/Diffs.kt`, `LICENSE`. It is a Nitro
**view** (nitrogen 0.35) around [HumanInterfaceDesign/MarkdownView], a Swift/UIKit
renderer. MIT, latest `1.0.3` (2026-04-18), no runtime JS dependencies.

- **Renders** both unified and side-by-side — `ThemeDiff.displayMode`, with
  `lineNumberStyle: 'dual' | 'single'` and `showsChangeMarkers`.
- **Input** is raw text: `content: string`, a fenced ` ```diff `/` ```patch `
  block, several of them, or a bare unified patch, auto-detected. No structured
  input exists.
- **Parser** is MarkdownView's, in Swift. There is no JS parser in the package.
- **Virtualization**: none. `ios/Diffs.swift:30-46` pins one `MarkdownTextView`
  inside a `UIScrollView`; the whole patch is one native text view.
- **Highlighting**: tree-sitter's C parser, 19 languages. MarkdownView's README
  quotes ~2 ms for 50 lines, ~21 ms for 500.
- **Word-level diffs**: native — `changeHighlightStyle: 'lineOnly' | 'inlineOnly'
| 'both'` with `added/removedHighlightBackground`.
- **Row sizing**: not a row list. UIKit text layout in one scroll view.
- **Native**: iOS 16+, and the podspec pulls MarkdownView over SPM from a
  _branch_, not a tag, with a `# todo use version` comment.
- **Android is not implemented.** The published `Diffs.kt` is the
  `create-react-native-library` template verbatim — a bare `View(context)` with a
  single `color: String` prop that sets a background colour. `content`,
  `colorScheme` and `theme` do not exist there.

**Verdict: do not depend on it, do not vendor it.** Muqun ships an Android APK; a
component that renders a coloured rectangle on half our platforms is not a diff
viewer. Borrow the ideas instead, free: `ThemeDiff` is a good checklist of what a
diff needs to colour, `contextCollapseThreshold`/`visibleContextLines` is the
right shape for context folding, and line-range selection is the v2 affordance for
"ask the agent about these lines".

---

## 2. Where the diff comes from

### 2.1 The Gateway runs `git`. It already does.

`muqun-gateway/src/tasks.rs:325-342` already shells out:

```rust
fn git(repo: &Path, args: &[&str]) -> anyhow::Result<std::process::Output> {
    let output = Command::new("git").arg("-C").arg(repo).args(args).output()
```

and `recent_cwds` (`main.rs:7266-7292`) already tells the App which of a session's
working directories is a checkout, via `tasks::is_git_checkout` (`tasks.rs:298`,
a `.git` existence test, no subprocess). The App already reads it —
`loadRecentCwds`, `src/lib/gateway-client.ts:1803`.

Sending `git diff` to the pane and parsing the scrollback is rejected outright: it
writes to a terminal the user is working in, it fights the pager, the ANSI
colouring and the pane width, and the result depends on the agent's shell state.
The Gateway already owns "run a bounded host command" and "resolve a pane to a
directory inside the fence".

### 2.2 The git invocations

One helper, a fixed argument prefix, and no argument ever supplied by the client:

```
git --no-pager -C <toplevel> -c core.quotepath=false -c diff.external= \
    --no-optional-locks <subcommand> --no-color --no-ext-diff
```

with `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`,
`GIT_PAGER=cat`, and the `TMUX`/`HERDR_*` variables removed as
`backend_startup.rs:73-96` already removes them.

| Purpose          | Arguments                                                            |
| ---------------- | -------------------------------------------------------------------- |
| Is this a repo   | `rev-parse --show-toplevel` (only when the `.git` test is ambiguous) |
| Overview         | `status --porcelain=v2 -z --untracked-files=normal --renames`        |
| Per-file totals  | `diff --numstat -M -z [--cached] [--] <path>`                        |
| One file's patch | `diff -M -U<n> --no-textconv --binary=false [--cached] [--] <path>`  |
| Untracked file   | `diff --no-index -- /dev/null <path>`                                |
| A commit (v2)    | `show --format=... -M -U<n> <sha>`                                   |

Each flag is load-bearing. `--no-color` and `--no-ext-diff` so a user's
`color.ui` or `diff.external` never reaches the wire; `core.quotepath=false` so a
non-ASCII path arrives as UTF-8 rather than octal escapes; `-z` so a path
containing a newline cannot forge a record boundary; `--no-textconv` so a repo's
`.gitattributes` cannot make the Gateway run an arbitrary filter; `-M` so a
rename is one entry and not a delete plus an add; `--no-optional-locks` so
reading a diff never takes `index.lock` from the agent working in that checkout.
Binary files report `binary: true` with the numstat `-`/`-` marker and no hunks.

### 2.3 Detection

Detection is the `.git` `stat(2)`, not a subprocess. It already covers a linked
worktree — a `.git` _file_ holding a `gitdir:` pointer — which matters because the
maintainers work in worktrees; this branch is one.

The App caches the answer keyed by **the pane's cwd string**, not the pane id, and
invalidates on: cwd change, workspace screen regaining focus, explicit
pull-to-refresh, and an agent event for that pane. Nothing polls.

Degradations, all silent:

- **git not installed** — `{"repo": null, "reason": "git_missing"}`, icon hidden,
  cached per host for the process lifetime.
- **cwd unknown** (absent, or rejected by `is_scannable_root`) — `repo: null`,
  icon hidden, no error. This is how `pane_files` already answers for a pane with
  no workspace (`main.rs:8034-8040`), and for the same reason: an error here is a
  host-probing oracle.
- **Huge repo** — `status --porcelain=v2` is the one call that can be slow. Capped
  by a 5 s timeout and a file-count cap (§5). Over the cap the App shows the count
  and a "too many changes to list" row, never a truncated list pretending to be
  complete.
- **SSH panes are out of scope for v1.** `src/components/ssh-terminal-workspace.tsx`
  talks to a host over SSH with no Gateway in the loop, with its own local
  `KEY_ROW_HEIGHT` and its own key row (`:922-970`). There is no endpoint to call,
  and running `git` by writing to the SSH shell is the design rejected in §2.1. The
  icon does not exist there. Say so in the release notes so it does not read as a bug.

### 2.4 The wire format: structured file list, raw patch text per file

This is the decision the note exists to make, and the measurements point the
opposite way from the intuition.

_Measured_, Bun on an Apple-silicon Mac, best of seven, against
`git diff --no-color --no-ext-diff -M -U3 HEAD~20 HEAD` in this repository:

| Corpus       | Raw patch | Same data as JSON | Parse raw → rows | `JSON.parse` of rows |
| ------------ | --------- | ----------------- | ---------------- | -------------------- |
| 63 236 lines | 2 998 KiB | 5 474 KiB         | **4.0 ms**       | **11.2 ms**          |
| 19 583 lines | 676 KiB   | 1 398 KiB         | **1.4 ms**       | **3.1 ms**           |

gzipped, the 63 k case is 766 KiB raw against 1 078 KiB as JSON.

A hand-written line-oriented patch parser is _cheaper than `JSON.parse` of the
same data already structured_, on a payload ~45 % smaller. Not surprising once
stated: the parser is one `split('\n')` and a `charCodeAt` switch, while JSON
re-lexes every quoted string and allocates an object per line. **Structuring
line-level data on the Gateway buys nothing and costs bandwidth.**

_Estimated_: Hermes on a Pixel 6a-class device runs string-heavy work roughly
5–15× slower than a desktop JIT. At 10×, a 20 000-line patch parses in ~14 ms and
a 63 000-line one in ~40 ms. Neither ever runs in practice, because §3.1 means one
file's patch is what arrives, and a large single file is a few thousand lines
(~2 ms _estimated_).

So: **`/git/status` is structured JSON** — small, one entry per changed file, the
thing the list renders and the badge counts. **`/git/diff` returns the raw unified
patch** for one path plus a tiny JSON header, parsed on device by a pure function
under `bun test src`.

Both wrapped in the existing `content_envelope` (`main.rs:10019`) so they carry
`schema_version` and `capabilities` like every other content route:

```jsonc
// GET /api/sessions/{session_id}/panes/{pane_id}/git/status
{ "schema_version": "1.5.0", "capabilities": { … }, "data": {
  "repo": { "toplevel": "/Users/x/p", "branch": "feat/git-diff-viewer",
            "upstream": "origin/main", "ahead": 2, "behind": 0,
            "detached": false, "head": "70c8c85" },
  "truncated": false,
  "files": [
    { "path": "src/lib/gateway-client.ts", "old_path": null,
      "status": "modified",   // added|modified|deleted|renamed|copied|untracked|conflicted
      "staged": false, "unstaged": true,
      "binary": false, "added": 41, "removed": 6 } ] } }

// GET …/git/diff?path=src/lib/gateway-client.ts&staged=false&context=3
{ "schema_version": "1.5.0", "capabilities": { … }, "data": {
  "path": "src/lib/gateway-client.ts", "binary": false,
  "truncated": false, "bytes": 4210,
  "patch": "diff --git a/src/… \n@@ -1,7 +1,9 @@\n …" } }
```

`repo: null` replaces `repo`/`files` when the pane is not in a checkout. The
capability string is **`git_diff`**, in `API_CAPABILITIES` (`main.rs:304-332`)
beside `recent_cwds` and `pane_file_search`, read on the App side exactly the way
`agent_events` is (`src/lib/away-digest.ts:42-54`):

```ts
export const GIT_DIFF_CAPABILITY = 'git_diff';
export function gatewaySupportsGitDiff(capabilities: readonly string[] | undefined | null) {
  return Array.isArray(capabilities) && capabilities.includes(GIT_DIFF_CAPABILITY);
}
```

---

## 3. Not freezing

### 3.1 Two levels of laziness

1. **The file list** is `status --porcelain=v2` plus `--numstat`, one run each,
   O(changed files). _Measured_: `git diff --numstat` over the 63 k-line range
   above takes 88 ms wall here.
2. **A file's patch** is fetched only on expand. Nothing prefetches. A file whose
   numstat total exceeds `AUTO_EXPAND_MAX_LINES = 400` starts collapsed even when
   it is the only file.

There is no "whole diff" request in the API, so the App cannot ask for 50 000
lines by accident.

### 3.2 One flat `LegendList` of rows

`@legendapp/list` **3.3.10**, confirmed from its `package.json`. A correction to
the v3 docs as installed: **`getEstimatedItemSize` does not exist in 3.3.10** — it
survives only in `CHANGELOG.md:164` as a removed name. What exists
(`react-native.d.ts`): `estimatedItemSize` (:187), `getFixedItemSize` (:203),
`getItemType` (:207), `recycleItems` (:412, default `false`), `drawDistance`
(:181, default 250), `initialScrollIndex` (:224),
`onStartReached`/`onEndReached` (:378/:312), `itemsAreEqual` (:237),
`ListHeaderComponent` (:257), `stickyHeaderIndices` (:446) with
`stickyHeaderConfig` (:451), and `maintainVisibleContentPosition?: boolean | {
data, size, shouldRestorePosition }` (:288, :459-463). A `SectionList` on the same
engine is exported from `@legendapp/list/section-list`.

The data is **one flat array** — file-header, hunk-header, line and "show more"
rows — not sections. Flattening is a pure function (`flattenDiffRows`), so
expanding a file is a cheap array rebuild and the whole thing is unit-testable
without a renderer.

Both existing lists in this app set `recycleItems={false}` deliberately
(`pane-chat-view.tsx:228-231`, `session-artifacts.tsx:613-616`): stable item
objects plus `React.memo` is their performance story and recycling would undo it.
**The diff list is the opposite case and sets `recycleItems={true}`.** A diff row
is a fixed-height strip of monospace text with two numbers and a background
colour; nothing expensive survives a recycle, the rows number in the thousands,
and recycling is what bounds the view pool. Paired with:

- `getFixedItemSize` returning an exact height per row type — the whole point of a
  monospaced one-line row. With exact sizes the list never re-measures and
  `experimental_hideItemsUntilMeasured` (:350-364) is unnecessary.
- `getItemType` returning `'file' | 'hunk' | 'line' | 'more'`, so the pool never
  hands a file card's view to a code line.
- `maintainVisibleContentPosition={{ data: true, size: true }}`, matching
  `pane-chat-view.tsx:320`. Expanding a file inserts rows; the viewport must not move.
- `stickyHeaderIndices` on file headers, so the file being read is always named.
  Sticky headers need the list's own Reanimated integration
  (`AnimatedLegendList` from `@legendapp/list/reanimated`): the core list
  drives its scroll view with React Native's `Animated.event`, an object, and
  handing that to a Reanimated `ScrollView` through `renderScrollComponent`
  crashed the first fling on a device with "Object is not a function".
- Two more rules the device run added. While a later page loads, every row
  already on screen stays -- dropping them collapses the list and clamps the
  offset to the top, throwing a reader at line 3000 back to line 1. And
  collapsing a file from deep inside it lands on that file's header, because
  nothing above the viewport moved and the old offset is past the end of the
  shorter content.

### 3.3 Horizontal scrolling: one outer scroller, not one per row

`DiffRow` (`src/components/pane-chat-blocks.tsx:419-471`) wraps a hunk in a
horizontal `ScrollView` today, with the right comment on it: _"Never wrapped: a
re-wrapped diff line no longer lines up with the one above it, which is the only
thing a diff is read for."_ Wrapping is out for that reason.

**A `ScrollView` per row is also out.** Each is a native scroll view with its own
gesture recogniser and content view, and a recycled list would create and destroy
them by the hundred; on Android nested scrollables steal the vertical pan often
enough to be felt.

**One horizontal scroll container wraps the whole `LegendList`**, with content laid
out at a computed width: measure the longest loaded line in character cells,
multiply by the monospace advance (the Skia terminal already does this
measurement), and let one outer `ScrollView horizontal` pan every row together.
That is also the _correct_ behaviour — columns stay aligned across rows while
panning, which per-row scrollers cannot do. The gutter (line numbers, `+`/`-`
marker) is a fixed column outside the scroller so it never pans away. Truncation
with tap-to-expand was considered and rejected: cutting lines off at the right
edge hides exactly the change the reader came for.

### 3.4 Does `react-native-enriched-markdown` already render diffs? No.

The right question before adding anything: the app already ships
`react-native-enriched-markdown@1.0.2` (MIT, software-mansion) with a real
vendored tree-sitter highlighter. If a ` ```diff ` fence already rendered as a
coloured diff, there would be nothing to build and nothing to depend on. It does
not. Checked directly against the installed package under
`node_modules/react-native-enriched-markdown/`:

- **No `diff` grammar.** `cpp/highlight/vendor/grammars/` holds 19 directories —
  `bash, c, c-sharp, cpp, css, go, html, java, javascript, json, markdown, php,
python, ruby, rust, swift, tsx, typescript, yaml`. No `diff`, no `patch`.
  `cpp/highlight/grammar-versions.json`, which pins every supported grammar, has
  no `diff` entry either. The 14 actually compiled into our build are listed in
  `cpp/highlight/vendor/generated/generated_registry.cpp:26-41`.
- **No `diff` fence word.** `cpp/highlight/CodeBlockLanguages.cpp:22-63` is a
  42-entry `kLanguageNames` table, `{key, displayName, grammar}`, binary-searched
  and `static_assert`-ed sorted. `diff` and `patch` are absent. An unknown key
  falls through `findLanguage` to `nullptr`, so `displayNameForLanguage` (:110-123)
  title-cases it — the block header reads "Diff" — and `canonicalGrammarId`
  returns `""`, meaning no grammar, meaning plain uncoloured monospace text.
  `src/lib/code-language.ts:26-31` in this repo already records exactly this.
- **No dedicated diff renderer and no diff prop.** `grep` for the string literals
  `"diff"` / `'diff'` across `src/`, `ios/`, `android/src/`, `cpp/`, `docs/` and
  `README.md` returns nothing; the only hits for the substring are the English
  words _differs_ and _different_ (`ios/renderer/LinkRenderer.m:51`,
  `src/types/MarkdownTextProps.ts:299`) and a note about caret-rect diffing in
  `docs/INPUT.md:173`. There is no `DiffView`, no `diff` prop, no `ThemeDiff`
  equivalent. `docs/CODE_HIGHLIGHT.md` describes fenced code blocks only.
- **No `+`/`-` line colouring, and it could not have it.** The highlighter is
  deliberately foreground-only, so measured height always equals drawn height
  (`cpp/highlight/CodeBlockHighlighter.hpp:19-22`). `MarkdownStyle` has
  `codeBlock.backgroundColor` (whole block) and `code.backgroundColor` (inline
  span) and nothing per line.
- **A diff fence cannot combine with the file's own language.** The fence info
  string selects exactly one grammar. There is no `diff-typescript`, no second
  info word, and no API to say "this is a diff _of_ TypeScript". Even a
  hypothetical `diff` grammar would colour the patch syntax, not the code inside it.

**So: `react-native-enriched-markdown` cannot render a diff, and this is not a
"reuse what we have" opportunity.** Fenced ` ```diff ` gives plain grey monospace
under a header that says "Diff" — strictly worse than what
`src/components/pane-chat-blocks.tsx:419-471` already draws by hand today.

**The fallback, and the recommendation: keep the rows in JS.** One `<Text>` per
row with a per-row background from theme tokens (§3.5), no native markdown view
anywhere in the list, no new dependency. That is the same shape `DiffRow` uses and
it is the only option that gives `+`/`-` backgrounds, fixed row heights and
recycling at once.

It is worth writing down _why_ the obvious alternative — one
`EnrichedMarkdownText` per hunk, `flavor="github"`, at the grain
`src/components/asset-viewer.tsx` already uses successfully — is also wrong here,
because that grain is the one that superficially looks fine. Four independent
reasons:

1. **There is no API for a line.** The whole runtime export surface is
   `EnrichedMarkdownText`, `EnrichedMarkdownTextInput` and two accessibility
   helpers. The seam that would be perfect — `Markdown::highlightCode(code,
language)` at `cpp/highlight/CodeBlockHighlighter.cpp:171`, which returns bare
   token spans — is not exposed to JS. Highlighting one line means synthesising
   ` ```ts\n<line>\n``` ` and paying a full md4c parse, AST walk and
   attributed-string build per row, per recycle, to colour eighty characters.
2. **It cannot draw the `+`/`-` backgrounds.** The highlighter is deliberately
   foreground-only so measured height always equals drawn height
   (`CodeBlockHighlighter.hpp:19-22`). `MarkdownStyle` has
   `codeBlock.backgroundColor` (whole block) and `code.backgroundColor` (inline
   span) and nothing per line. The row background comes from a wrapping `View`
   either way — which is what `DiffRow` already does.
3. **A hunk fenced as the file's language parses wrongly.** Stripping the `+`/`-`
   markers and fencing the hunk as ` ```ts ` is the only way to get colour, and a
   hunk is not a valid parse of anything: it starts mid-block, so tree-sitter
   returns ERROR nodes and near-arbitrary captures. Leaving the markers on makes
   it worse. And the alignment the diff exists for is gone the moment the markers
   are stripped.
4. **One native view per hunk is expensive, and a recycled list multiplies it.**
   Each `EnrichedMarkdownText` is a Fabric host component with its own UIKit /
   Android text view. In a `LegendList` with `recycleItems`, `markdown` changes on
   every recycle, and the view re-parses: `ios/EnrichedMarkdownText.mm:639` calls
   `renderMarkdownContent:` from `updateProps:`, guarded only by a string compare
   against the last rendered markdown (`:157`), which a recycle always fails. The
   shadow node parses a _second_ time to measure, cached in a 512-entry global LRU
   keyed on the full markdown string — a long diff evicts its own entries on the
   first fling. Worst, `applyRenderedText:` re-measures on main and can call
   `requestHeightUpdate` → `YGNodeMarkDirty` a frame after mount, so a row
   self-resizes asynchronously: with `getFixedItemSize` that is a visible jump, and
   without it the list re-measures constantly. **How large a block is safe**: our
   own measurements through this component (the note above `HIGHLIGHT_MAX_CHARS` in
   `src/components/asset-viewer.tsx`) show the iOS path is quadratic — 101 ms at
   20 KiB, 806 ms at 60 KiB, 3 746 ms at 128 KiB — and that is why the asset viewer
   stops handing whole files to this renderer at `HIGHLIGHT_MAX_CHARS = 64 * 1024`
   and draws larger ones as virtualized monospace rows instead
   (`src/components/code-lines-view.tsx`). A hunk is typically well under 4 KiB, so
   _one_ is cheap; the cost is that a screenful is five or ten of them, each re-parsing
   on every recycle, against a shared 512-entry measurement cache. Safe ceiling if
   this route were ever taken: ~8 KiB per block, non-recycled, with a hard cap on
   simultaneously mounted blocks — which is most of a virtualized list's job done
   by hand, badly.

`react-native-diffs` gets this right precisely by doing it all in Swift: one text
view, one parse of the file, token spans sliced per line. We cannot reach that
shape from JS with what we have.

**v1 ships no syntax highlighting.** Rows are green, red and muted. That costs
less than it sounds: the reader is checking _what changed_, and `+`/`-` colouring
already carries that.

**The honest v2** is word-level intra-line highlighting computed on the **Gateway**:
`git diff --word-diff=porcelain --word-diff-regex='\w+|[^[:space:]]'` gives paired
add/remove spans at zero JS cost, and it is the highlight that actually helps —
it says which _characters_ moved. `react-native-diffs` exposes the same thing as
`changeHighlightStyle: 'inlineOnly'`. Computing it on device inside
`InteractionManager.runAfterInteractions` is possible but pointless when the
process that produced the patch can produce the spans.

**v3, only if native highlighting is genuinely wanted**: expose
`CodeBlockHighlighter.cpp` through a small Nitro module returning `{start, end,
type}` triplets, with a parse-tree cache keyed on file content and tree-sitter's
incremental old-tree argument (the package passes `nullptr` today). That is a
card of its own with an upstream conversation attached, not a v1 line item.

### 3.5 Text rendering: one `<Text>` per row. Not Skia.

`src/components/skia-terminal.tsx` is 3 843 lines of grid renderer built on
`SkPicture`, glyph runs and a font provider, and it exists because a terminal is a
fixed character grid that repaints wholesale at speed. A diff is neither: it
scrolls, it selects, it needs an accessibility tree, and its rows are stable.
Reusing that pipeline means re-implementing selection, accessibility and sticky
headers on a canvas to save a per-row cost a recycled list has already bounded.

One `<Text>` per row, `numberOfLines={1}`, `selectable`, fixed `lineHeight`,
per-row `backgroundColor` from theme tokens — what `DiffRow` already does at
`pane-chat-blocks.tsx:445-467`. The new viewer inherits its colour choices so an
inline diff in the transcript and the full viewer look like the same thing.

### 3.6 Memory and cancellation

- At most `MAX_OPEN_FILES = 12` expanded files keep their parsed rows; the
  least-recently-expanded collapses back to its header. Re-expanding refetches;
  the request is small.
- Per-file paging: `?from=<line>&lines=<n>` for a file over
  `FILE_PATCH_MAX_LINES = 4 000`. The App renders a "show more" row, and
  `onEndReached` never triggers a fetch by itself — paging is an explicit tap,
  because a diff that grows under the reader is the viewport-moving behaviour
  AGENTS.md forbids. The Gateway cuts a page back to a hunk boundary only when
  one lies past the middle of the page; a single hunk longer than a page (every
  third line of a file changed is one hunk) is cut raw, so the parser carries
  the old/new line counters from one page into the next and a page that opens
  without an `@@` header continues the previous hunk. Found by running the real
  Gateway against a real repository: with a boundary-only rule the first page
  of such a file was four header lines and a "show more" button.
- A rename is fetched with both paths (`old_path` from the status entry).
  With the new path alone as the pathspec git renders a brand-new file.
- Every fetch carries an `AbortSignal`, aborted on unmount and on the question
  changing, the way `session-artifacts.tsx:288-293` already does with its
  `inFlightRef`: a slow earlier answer must not repaint over the current one.
- The raw patch string is dropped as soon as it is parsed; only rows are retained.

### 3.7 Budgets

| Budget                 | Value                                         | Why                                                                                                                              |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/git/status` response | 512 KiB, ~2 000 files                         | A change set larger than this is not read on a phone                                                                             |
| `/git/diff` response   | 1 MiB, 4 000 lines                            | _Measured_ 676 KiB / 19 583 lines parses in 1.4 ms desktop, _estimated_ ~14 ms Hermes; one file is an order of magnitude smaller |
| Rows mounted           | ~40                                           | `drawDistance` 250 px against fixed ~18 pt rows                                                                                  |
| git subprocess         | 5 s timeout, 8 MiB stdout cap, killed on drop | `backend_startup.rs:115` timeout idiom, `tmux.rs:116-127` `kill_on_drop`                                                         |
| Scroll                 | 60 fps sustained, Pixel 6a class              | The gate below                                                                                                                   |

Measurement is `agent-device` (`agent-device help debugging` for traces,
`help react-native` for render evidence), driving the demo fixture with a
deliberately large patch: record a trace over a full-height fling through a
4 000-row diff on an iOS simulator and an Android device, and attach it to the
card. A number quoted from memory is not a measurement.

---

## 4. The entry point

### 4.1 Where the icon goes

`src/components/server-terminal-workspace.tsx:3414-3442`, the `paneEntries`
fragment — the only piece rendered by all three key-row call sites (pad inline row
:4002, dock key row :4024, floating tray :3824). A third child after
`ArtifactsButton`:

```tsx
<GitDiffButton
  sessionId={data.sessionId}
  paneId={selection.paneId}
  cwd={field(selectedPane, 'cwd')}
  label={routeRecord?.label ?? record?.label ?? t`Server`}
  background={fill}
  compact={isPadLayout}
/>
```

`field(selectedPane, 'cwd')` is already in that closure — `openQuickActions` uses
it at :3047, `CollaborationNotice` at :3647. `TerminalComposer` gets none of this
and should not: its props (`terminal-composer.tsx:41-51`) are deliberately
`leading`, `inputProps` and `send`, so the same field serves an SSH shell.

The button copies `src/components/artifacts-button.tsx` exactly: `PressableScale`,
`styles.keyRowToggle` (40 × `KEY_ROW_HEIGHT`, radius 12), a `lucide-react-native`
glyph at `size={compact ? 15 : 16}` in `theme.colors.primary`, `KEY_ROW_HEIGHT`
imported from `src/constants/key-row.ts:15` rather than restated, and
`accessibilityLabel` from the **hook's** `t`, never the global macro
(`artifacts-button.tsx:46-53` explains why: React Compiler memoizes the global one
and a language switch leaves it stale). `GitCompare` is the natural glyph. Add
`accessibilityRole="button"`, which `ArtifactsButton` omits and should not have.

### 4.2 The state, and not flickering

```ts
// src/hooks/use-git-repo-status.ts
export function useGitRepoStatus(
  sessionId: string,
  paneId: string,
  cwd: string
): {
  available: boolean; // capability + repo: the icon's gate
  changedFiles: number; // the badge
  loading: boolean;
};
```

Backed by a module-level `Map<cwd, GitRepoStatus>` in `src/lib/git-repo-cache.ts`,
not React state, so leaving a pane and coming back is instant. The data behind it
is the pane context route (§5.1): one request answers cwd, `git` and the badge
count together, and `git: null` is the cached "not a repo" answer. The rule against
flicker is **start hidden, never hide once shown for this cwd**: an unknown cwd
renders nothing at all — the `FileMentionPanel` discipline
(`file-mention-panel.tsx:59`, "with nothing to show it renders nothing") — and once
a cwd is known to be a repo the entry stays for the life of that cwd even while a
refresh is in flight. There is no spinner in the toolbar.

The capability half comes from the health record the workspace already holds, via
`gatewaySupportsGitDiff(health.capabilities)`. On an older Gateway the hook
short-circuits to `available: false` without ever making a request — the
`gatewaySupportsAgentEvents` argument at `away-digest.ts:44-48` applies verbatim:
the capability is what keeps the feature _invisible_ rather than merely silent.

### 4.3 Badge and refresh policy

Yes to a badge showing the changed-file count, capped at `99+`. It is the one
number that makes the icon worth glancing at.

Refresh is **manual**. The sheet has pull-to-refresh; the badge refreshes on
workspace focus and on an agent event for that pane, and that is the only
automatic work. When a refresh finds a different diff while the sheet is open, the
sheet does **not** replace what is on screen — it shows an unobtrusive "3 files
changed · Refresh" affordance at the top and waits to be tapped. That is the
AGENTS.md rule (new output must not move the reader's viewport or replace the
snapshot until they choose to refresh) and the shape the transcript already uses.

### 4.4 The route: a form sheet, like files

`src/app/git-diff.tsx`, a param shim of the same twenty lines as
`src/app/artifacts.tsx`, registered in `src/app/_layout.tsx` beside the `artifacts`
screen with the same options: `presentation: 'formSheet'`,
`sheetAllowedDetents: [1]`, `sheetGrabberVisible: true`,
`contentStyle: { backgroundColor: 'transparent' }`. Full height only, for the same
reason files is: a partial detent wastes the height a diff needs.

Navigation is `router.navigate`, **not** `push` — `artifacts-button.tsx:65-89`
documents the bug that made this a rule: a `push` during the sheet's mount-and-animate
window stacked a second identical sheet. `Keyboard.dismiss()` first, or it opens
behind the keyboard.

### 4.5 Demo mode and i18n

Demo mode gets a real fixture on the `ArtifactsButton` model — the button stays
demo-unaware, the transport short-circuits: `demoGitStatus()` and `demoGitDiff()`
in `src/lib/demo-gateway.ts`, returned by `if (isDemoActive()) return …` at the top
of the new client functions and parsed through the same parsers as the real calls.
`demoHealth` (`demo-gateway.ts:872`) gains `'git_diff'`. Demo pane `pane-1` is a
repo with a handful of changed files and one deliberately large file, so the "show
more" path is exercised.

This is not optional: **the E2E suite runs entirely in demo mode**
(`subflows/open-demo` is the first include of every flow), so an entry point hidden
in demo cannot be covered by the gate at all.

Strings are lingui: `useLingui` from `@lingui/react/macro` for runtime text,
`<Trans>` for JSX literals, and `msg` from `@lingui/core/macro` with `_` from
`@lingui/react` for any module-scope table (`attachment-menu.tsx:14-28` explains
why a module-scope `t` freezes at English). `bun run i18n:extract` after; the
eleven catalogs under `src/i18n/locales/` pick up the new ids.

---

## 5. Does the Gateway need changes? Yes — one context route, two git routes, two capabilities

### 5.1 Three layers, not one

The question behind this feature is bigger than diffs: should the Gateway know,
per pane, where the work is, what is running there, and what can be done about
it, so that a phone can tap an icon and ask? Yes — and most of the answer is
already in the tree, in three layers that must stay distinct:

| Layer                    | What it answers                                          | Where it lives today                                                                                                                                                                                        | Shape                                     |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Gateway capabilities** | "Does this Gateway have this API at all?"                | `API_CAPABILITIES` (`main.rs:304-332`) on `/api/health`                                                                                                                                                     | static strings, one per feature, additive |
| **Pane facts**           | "Where is this pane, what runs in it, is it a checkout?" | `Pane.cwd`, `foreground_command`, `agent`, `agent_status` (`backend/model.rs:125-150`); `recent_cwds` adds `git: bool` (`main.rs:7266-7292`); the parts descriptor says native / dictionary / text per pane | dynamic, per pane, read on demand         |
| **Agent behaviour**      | "What does _this kind_ of agent respond to?"             | `agents.json` profiles: the interrupt key, the startup command, approvals — surfaced by `pane_shortcuts` (`main.rs:8136`) and `pane_approvals`                                                              | per agent kind, declared, not detected    |

The discipline that keeps them apart: **a capability is a static promise about
the API; a fact is something observed about one pane; behaviour is declared per
agent kind.** A working directory is a fact, not a capability, so there is no
"per-cwd capability" namespace to invent. Whether the diff icon shows is a
decision the App makes from a capability (`git_diff` is present) and a fact (this
pane's cwd is a checkout). Neither alone is enough, and neither is a new kind of
thing.

What is missing is not a layer but a **join**. Today the App would stitch
`get_pane`, `recent-cwds`, `shortcuts` and the parts descriptor to answer "what is
this pane" — four requests, three of which repeat work the Gateway already did to
answer the first. So the one genuinely new route is a read-only per-pane context:

```jsonc
// GET /api/sessions/{session_id}/panes/{pane_id}/context
{ "schema_version": "1.5.0", "capabilities": { … }, "data": {
  "cwd": "/Users/x/p",
  "cwd_in_fence": true,               // is_scannable_root + session_asset_roots
  "git": {                            // null when cwd is not a checkout, or cwd unknown
    "toplevel": "/Users/x/p", "branch": "feat/git-diff-viewer",
    "upstream": "origin/main", "ahead": 2, "behind": 0, "detached": false,
    "head": "70c8c85", "changed_files": 3 },
  "agent": {                          // null for a plain shell
    "kind": "claude", "instance_id": "…", "status": "idle",
    "profile": "claude",
    "actions": ["interrupt", "approvals", "native_parts"],
    "usage_source": null              // see below
  } } }
```

`git` is the `.git` stat plus one `git status --porcelain=v2 --branch` bounded the
same way as §5.3 below; `changed_files` is what the badge shows, so the badge no
longer needs `/git/status` at all. `agent.actions` is derived from the profile,
not detected, which is why it can be trusted. Everything in this body is
already computed somewhere in `main.rs`; the route only assembles it.

**Agent usage is data, not a capability, and it is kept out of the context
route on purpose.** Tokens, cost and context-window fill exist only where the
agent leaves a machine-readable trace — Claude Code's session JSONL and
statusline hook, and not much else today. That is a per-agent-kind adapter:

- capability `agent_usage`, advertised only when at least one profile declares a
  `usage_source` (`claude_session_jsonl` is the first and, for now, only value);
- `GET …/panes/{pane_id}/usage`, answering `null` with a reason (`no_source`,
  `not_yet`) when the pane's agent has no adapter or has not written anything;
- the App shows "this agent does not report usage", never an estimate. The
  AGENTS.md rule against fabricated progress applies to usage verbatim: a number
  the Gateway did not read from the agent is not shown.

The context route carries `usage_source` so the App knows whether tapping for
usage is worth a request, and nothing else about usage.

**Git is a fixed verb table, not a command runner.** "We can run git diff, or
other things" is right only in the narrow sense: each verb is its own handler
with its own fixed argument prefix, its own clamps and its own capability string
where the verb is new API. The client never supplies an argument that reaches
git. v1 is `status` and `diff`; v2 adds `show` and `log`. A verb is a Gateway
capability because it is API; which verbs make sense for a pane is a fact the
context route answers with `git: null` or not. The `create_task` fence — cwd must
be a directory this session already works in (`main.rs:11837`) — is reused as-is.

### 5.2 The routes

Everything follows the `pane_files` handler (`main.rs:8014-8062`) as its template.

Routes, beside the existing pane routes at `main.rs:2084`:

```
GET /api/sessions/{session_id}/panes/{pane_id}/context
GET /api/sessions/{session_id}/panes/{pane_id}/git/status
GET /api/sessions/{session_id}/panes/{pane_id}/git/diff?path=&old_path=&staged=&context=&from=&lines=
GET /api/sessions/{session_id}/panes/{pane_id}/git/show?rev=          (v2)
GET /api/sessions/{session_id}/panes/{pane_id}/usage                  (v2, agent_usage)
```

`context` ships under a capability of its own, **`pane_context`**, because it is
useful without git and older clients must be able to tell it apart from a Gateway
that merely has `git_diff`.

Capability `git_diff` in `API_CAPABILITIES` (`main.rs:304`). Bump
`GATEWAY_API_VERSION` (`main.rs:205`) and `CONTENT_SCHEMA_VERSION` (`main.rs:256`)
by a minor, extending the version-history comment at `main.rs:241-255` the way
every previous bump did, add the paths to `openapi_spec()`, and add an
announced-and-documented test in the family of
`the_api_version_and_capabilities_announce_task_dispatch` (`main.rs:16276`).

### 5.3 Security, in order

1. `require_device(&state, &headers)?` first, like every session route
   (`main.rs:10476`).
2. The directory is derived, never supplied: `pane_agent_and_root`
   (`main.rs:7943-7955`) or the `session_asset_roots` + `pane_id` filter
   `pane_files` uses — `is_scannable_root`, then `canonicalize`. A pane outside the
   fence answers `repo: null`, not an error.
3. `path` is validated by the `resolve_asset_path` rule (`main.rs:9846-9856`):
   canonicalize **first**, then require containment in the toplevel. Canonicalizing
   first is what closes symlink escapes. It reaches git after a literal `--`, and a
   path beginning with `-` is rejected outright — the discipline
   `validate_branch_name` (`tasks.rs:244-275`) already applies to a ref, with its
   own `LeadingDash` error.
4. `staged` is a bool, `context` is `clamp(0, 25)`, `from`/`lines` clamp against
   `FILE_PATCH_MAX_LINES`. **No argument reaches git from the client.**
5. Timeout, output cap, `kill_on_drop(true)`, and the `env_remove` list from
   `backend_startup.rs:73-96`. `tasks.rs::git` has _none_ of these today; the new
   endpoints compose them rather than reuse it as-is. Blocking work runs in
   `tokio::task::spawn_blocking`, like `recent_cwds` at `main.rs:7275`.
6. Errors use the house shape — `api_error(status, code, message)`
   (`main.rs:10742`), `{"error":{"code":…,"message":…}}` — with git's stderr never
   forwarded verbatim: a fixed `git_failed` code and a localized sentence, per the
   CONTEXT.md rule that errors returned to clients are bounded and generic.

**Older Gateway**: nothing to do. The capability string is absent, the App never
makes the request, the icon never appears, no error is shown. A newer Gateway with
an older App is equally uneventful.

**Herdr is not involved**, and that is worth stating. The pane cwd comes from the
backend's own pane list — `#{pane_current_path}` for tmux (`backend/tmux.rs:394`,
`:1119`) or `cwd`/`foreground_cwd` for Herdr (`backend/herdr.rs:1080-1082`) — both
normalized onto `Pane.cwd` (`backend/model.rs:134`) and already on the wire
(`backend/compat.rs:144-153`). No Herdr method is called and no version floor
applies. Release-notes compatibility line: **App ≥ the release that adds this;
Gateway ≥ the release that adds `git_diff`; Herdr unchanged, any supported version,
tmux backends included.**

---

## 6. Plan

### v1 — the whole feature, minus colour

App:

| File                                           | Change                                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/git-diff.ts`                          | _new_. `GitFileChange`, `GitDiffRow`, `GIT_DIFF_CAPABILITY`, `gatewaySupportsGitDiff`, `parseUnifiedPatch`, `flattenDiffRows`. Pure — no transport, no React.                      |
| `src/lib/gateway-client.ts`                    | _new exports_ `loadPaneContext`, `loadGitStatus`, `loadGitFileDiff` with demo short-circuits and abort signals; re-export the vocabulary as `pane-parts` is re-exported (`:1138`). |
| `src/lib/demo-gateway.ts`                      | `demoGitStatus`, `demoGitDiff`; `'git_diff'` into `demoHealth` (`:872`).                                                                                                           |
| `src/lib/git-repo-cache.ts`                    | _new_. cwd-keyed detection cache and invalidation.                                                                                                                                 |
| `src/hooks/use-git-repo-status.ts`             | _new_.                                                                                                                                                                             |
| `src/components/git-diff-button.tsx`           | _new_, modelled on `artifacts-button.tsx`.                                                                                                                                         |
| `src/components/git-diff-view.tsx`             | _new_. The `LegendList`, the outer horizontal scroller, the row components.                                                                                                        |
| `src/components/server-terminal-workspace.tsx` | one child added to `paneEntries` (:3414).                                                                                                                                          |
| `src/app/git-diff.tsx`                         | _new_ route shim.                                                                                                                                                                  |
| `src/app/_layout.tsx`                          | one `Stack.Screen`, beside `artifacts` (:257).                                                                                                                                     |

Gateway:

| File          | Change                                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/git.rs`  | _new_. The argument-prefix helper, `status`, `numstat`, `file_patch`, with timeout / cap / env sanitising.                                                                                                             |
| `src/main.rs` | three routes (~:2084) and handlers — `context`, `git/status`, `git/diff`; `pane_context` and `git_diff` in `API_CAPABILITIES` (:304); version bumps (:205, :256); openapi entries; the announced-and-documented tests. |
| `CONTEXT.md`  | one bullet for the new module.                                                                                                                                                                                         |

Tests:

- `bun test src`: `parseUnifiedPatch` against renames, mode-only changes, "\ No
  newline at end of file", CRLF, a path with a space, a path with a newline, binary
  files, an empty patch, a malformed hunk header — every one must produce rows or
  nothing, never throw. `flattenDiffRows` against collapse/expand and the row-type
  sequence. `gatewaySupportsGitDiff` against `undefined`, `[]`, and present.
- `cargo test`: path containment (a symlink out of the toplevel, a `../` path, a
  path starting with `-`), the clamps, the timeout, the output cap, and a repo with
  a file whose name contains a newline.
- `e2e/agent-device/flows/git-diff.ad` plus a `suite.json` entry tagged `full` on
  both platforms, targeting the button's `accessibilityLabel` the way
  `flows/artifacts` targets `"Open files"` (`suite.json:151-172`). Flow: open the
  demo, press the icon, assert the sheet, expand a file, fling, assert the reader's
  position did not jump, pull to refresh, close. The gate is `bash scripts/e2e.sh`
  passing, quoted in the PR.

### v2 — the niceties

`agent_usage` with the Claude Code session-JSONL adapter, shown from a tap on the
agent row and never estimated. Word-level spans from `--word-diff=porcelain` (Gateway-side); staged / unstaged /
untracked as three sections; `git show <sha>` behind a commit picker; side-by-side
on a tablet, where the width exists; line-range selection feeding "ask the agent
about these lines", which is the affordance `react-native-diffs` gets right and the
reason this viewer is more than a pretty-printer; copy-a-hunk.

---

## 7. Open questions

1. **Staged vs unstaged** — decided 2026-09-13. The sheet's header carries a
   segmented All / Staged / Unstaged (the existing `SettingsSegmented`): one tap
   to switch views on a phone, the same control on a Pad. In the union view
   each file carries an `S`, `U` or `S U` mark, letters rather than words
   because a file row has room for `+1000 −1000` and one more glyph, with the
   words on the accessibility label. Switching sides drops every open patch: a
   file's two halves are different text. No control per file, and no
   stage/unstage action: the Gateway is read-only and a write needs its own
   safety boundary. A Pad-only side-by-side layout (file list left, patch
   right) is v2.
2. **Untracked files.** `git diff --no-index /dev/null <path>` renders a new file
   as an all-additions patch, usually what the reader wants but potentially
   enormous for generated output. Cap and collapse, or list untracked files
   without offering their contents?
3. **The badge count.** Changed files, or changed lines? Files is the calmer
   number; lines is what "how big is this" actually means.
4. **SSH panes.** Confirmed deferred? git-over-SSH is a separate card with its own
   transport question, not an extension of this one.
5. **The `-U` default.** Three lines matches `git`. A phone screen is narrow but
   not short — is a larger default worth the payload?
6. **Does `pane_context` land with v1 or before it?** It is the smaller change
   and useful on its own (the agent row, the task cards). Landing it first, on the
   collaboration branch, lets the diff PR be purely additive.
7. **Is monochrome acceptable for v1?** §3.4 argues yes, and argues the honest v2
   is Gateway-computed word-level spans rather than per-line tree-sitter. If full
   syntax highlighting is a requirement rather than a nicety, the only real path is
   a Nitro seam over `CodeBlockHighlighter.cpp` — its own card, with an upstream
   conversation attached.

---

## Sources

- <https://github.com/vercel-labs/react-native-diffs> (commit `01a9a60`), its
  `README.md`, `ios/Diffs.swift`, `src/Diffs.nitro.ts`, `Diffs.podspec` and
  `android/src/main/java/com/margelo/nitro/diffs/Diffs.kt` via
  `raw.githubusercontent.com`
- <https://registry.npmjs.org/react-native-diffs> — versions and the 1.0.3 tarball
- <https://github.com/HumanInterfaceDesign/MarkdownView> — platform support,
  tree-sitter engine, quoted benchmarks
- <https://legendapp.com/open-source/list/> — v3 API, cross-checked against
  `node_modules/@legendapp/list/react-native.d.ts` at 3.3.10, which is
  authoritative here
- `react-native-enriched-markdown@1.0.2`, read in `node_modules/`:
  `cpp/highlight/CodeBlockLanguages.cpp`, `cpp/highlight/grammar-versions.json`,
  `cpp/highlight/vendor/grammars/`,
  `cpp/highlight/vendor/generated/generated_registry.cpp`,
  `cpp/highlight/CodeBlockHighlighter.{hpp,cpp}`, `src/types/MarkdownStyle.ts`,
  `ios/EnrichedMarkdownText.mm`, `docs/CODE_HIGHLIGHT.md`
- `git diff` / `git status` documentation for `--porcelain=v2`, `-z`,
  `--no-optional-locks`, `core.quotepath` and `--word-diff=porcelain`
