import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type Target = { text?: string; id?: string; selected?: boolean; checked?: boolean };

/** Dedicated local-notification fixtures cannot widen into arbitrary OS permission changes. */
export function isNotificationFixtureCommand(args: string[]): boolean {
  return (
    (args.length === 4 &&
      args[0] === 'settings' &&
      args[1] === 'permission' &&
      (args[2] === 'grant' || args[2] === 'deny') &&
      args[3] === 'notifications') ||
    (args.length === 2 && args[0] === 'alert' && args[1] === 'dismiss')
  );
}

/** JSON manifests must not silently discard unsupported selector constraints. */
export function validateTarget(target: unknown): asserts target is Target {
  if (!target || typeof target !== 'object' || Array.isArray(target))
    throw new Error('Native target must be an object');
  for (const [key, value] of Object.entries(target)) {
    if (key === 'text' || key === 'id') {
      if (typeof value !== 'string' || !value.length)
        throw new Error(`Native target ${key} must be a nonempty string`);
    } else if (key === 'selected' || key === 'checked') {
      if (typeof value !== 'boolean') throw new Error(`Native target ${key} must be boolean`);
    } else {
      throw new Error(`Unsupported native target key: ${key}`);
    }
  }
  if (!('text' in target) && !('id' in target))
    throw new Error('Native target requires text or id');
}
export type Step = {
  run?: string;
  include?: string;
  env?: Record<string, string>;
  when?: { target?: Target; absent?: boolean; env?: string; equals?: string };
  steps?: Step[];
  target?: Target;
  mode?: 'press' | 'longpress' | 'visible' | 'hidden' | 'scroll';
  optional?: boolean;
  timeout?: number;
  direction?: string;
  point?: number[];
  delta?: number[];
};
export type Flow = {
  name: string;
  program: string;
  tags: string[];
  platforms: string[];
  disabled?: string;
  cleanup?: string;
};

export async function runWithCleanup(ports: {
  run: () => Promise<void>;
  captureFailure: () => Promise<void>;
  cleanup: () => Promise<void>;
  close: () => Promise<void>;
}): Promise<string | undefined> {
  let failure: string | undefined;
  try {
    await ports.run();
  } catch (error) {
    failure = String(error);
    await ports.captureFailure().catch(() => undefined);
  }
  try {
    await ports.cleanup();
  } catch (error) {
    const detail = `Flow cleanup failed: ${String(error)}`;
    failure = failure ? `${failure}\n${detail}` : detail;
  } finally {
    try {
      await ports.close();
    } catch (error) {
      const detail = `Session cleanup failed: ${String(error)}`;
      failure = failure ? `${failure}\n${detail}` : detail;
    }
  }
  return failure;
}
export type Suite = { version: number; flows: Flow[]; programs: Record<string, Step[]> };
type Node = {
  index: number;
  parentIndex?: number;
  ref: string;
  type?: string;
  role?: string;
  identifier?: string;
  label?: string;
  value?: string;
  selected?: boolean;
  checked?: boolean;
  bundleId?: string;
  rect?: { x: number; y: number; width: number; height: number };
};
type Reply = { success?: boolean; data?: Record<string, unknown>; error?: unknown };
export class NativeCommandError extends Error {
  constructor(
    readonly details: {
      code?: string;
      message?: string;
      retriable?: boolean;
      details?: Record<string, unknown>;
    }
  ) {
    super(`agent-device failed: ${JSON.stringify(details)}`);
  }
}
export type Invoke = (args: string[]) => Promise<Record<string, unknown>>;

export function deviceFlags(
  platform: string,
  device: string,
  androidSerials: string[] = []
): string[] {
  return [
    '--platform',
    platform,
    platform === 'ios' && /^[0-9a-f-]{36}$/i.test(device)
      ? '--udid'
      : platform === 'android' && (/^emulator-\d+$/.test(device) || androidSerials.includes(device))
        ? '--serial'
        : '--device',
    device,
  ];
}

export function decodeReply(stdout: string, status: number): Record<string, unknown> {
  const reply = JSON.parse(stdout) as Reply;
  if (status !== 0 || reply.success !== true || !reply.data) {
    throw new NativeCommandError((reply.error ?? reply) as NativeCommandError['details']);
  }
  return reply.data;
}

export function requirePass(data: Record<string, unknown>): void {
  if (data.pass !== true) throw new Error(`UI assertion failed: ${JSON.stringify(data)}`);
}

export function selectFlows(suite: Suite, tag: string, platform: string, name?: string): Flow[] {
  const selected = suite.flows.filter((flow) =>
    name ? flow.name === name : flow.tags.includes(tag)
  );
  if (name && !selected.length) throw new Error(`Unknown flow: ${name}`);
  if (name && selected[0].disabled) throw new Error(selected[0].disabled);
  return selected.filter((flow) => !flow.disabled && flow.platforms.includes(platform));
}

export function tokenize(line: string): string[] {
  const result: string[] = [];
  let rest = line.trim();
  while (rest) {
    const match = rest.startsWith('"') ? rest.match(/^"(?:\\.|[^"\\])*"/) : rest.match(/^\S+/);
    if (!match) throw new Error(`Invalid native action: ${line}`);
    result.push(rest.startsWith('"') ? (JSON.parse(match[0]) as string) : match[0]);
    rest = rest.slice(match[0].length).trimStart();
  }
  return result;
}

export function interpolate(value: string, env: Record<string, string>): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, key: string) => {
    if (!(key in env)) throw new Error(`Missing test input: ${key}`);
    return env[key];
  });
}

function expression(pattern: string): RegExp {
  const insensitive = pattern.startsWith('(?i)');
  return new RegExp(`^(?:${insensitive ? pattern.slice(4) : pattern})$`, insensitive ? 'i' : '');
}

const verifiedSettingsLeaves = new WeakSet<Node>();

function settingsControlState(node: Node): string | undefined {
  return verifiedSettingsLeaves.has(node) ||
    /^(?:Button|RadioButton|android\.(?:view\.(?:View|ViewGroup)|widget\.(?:Button|RadioButton)))$/.test(
      node.type ?? ''
    )
    ? node.identifier?.match(/^settings-selection:(on|off):[A-Za-z0-9_.-]+$/)?.[1]
    : undefined;
}

export function matches(node: Node, target: Target): boolean {
  if (target.id !== undefined && !expression(target.id).test(node.identifier ?? '')) return false;
  if (
    target.text !== undefined &&
    ![node.label, node.value].some(
      (text) => text !== undefined && expression(target.text!).test(text)
    )
  )
    return false;
  // The provider omits Android selected. Only the settings controls' explicit
  // state-bearing IDs may substitute for it; arbitrary labels or missing
  // metadata cannot establish a selected state. Native state always wins.
  if (target.selected !== undefined) {
    const settingsState = settingsControlState(node);
    const selected =
      node.selected ??
      (settingsState !== undefined
        ? settingsState === 'on'
        : node.identifier?.startsWith('settings-selection:') ||
            /^(android\.|androidx\.|com\.)/.test(node.type ?? '')
          ? undefined
          : false);
    if (selected !== target.selected) return false;
  }
  if (target.checked !== undefined) {
    const checked =
      node.checked ??
      (['1', 'true', 'on'].includes(String(node.value).toLowerCase())
        ? true
        : ['0', 'false', 'off'].includes(String(node.value).toLowerCase())
          ? false
          : node.type === 'android.widget.Switch' && /, (On|Off)$/.test(node.label ?? '')
            ? node.label!.endsWith(', On')
            : undefined);
    if (checked !== target.checked) return false;
  }
  return true;
}

export function snapshotNodes(data: Record<string, unknown>): Node[] {
  if (data.blockedBy) throw new Error(`Snapshot is blocked: ${String(data.blockedBy)}`);
  if (!Array.isArray(data.nodes) || !data.nodes.length)
    throw new Error('Snapshot has no readable nodes');
  if (
    data.snapshotQuality &&
    JSON.stringify(data.snapshotQuality).match(/unavailable|sparse|failed/i)
  ) {
    throw new Error(
      `Snapshot quality does not establish absence: ${JSON.stringify(data.snapshotQuality)}`
    );
  }
  const nodes = data.nodes as Node[];
  for (const node of nodes) {
    verifiedSettingsLeaves.delete(node);
    // Private AX exposes iOS segmented controls as Other. Accept the explicit
    // marker only on a unique leaf, never an inherited or duplicated wrapper.
    if (
      node.type === 'Other' &&
      /^settings-selection:(on|off):[A-Za-z0-9_.-]+$/.test(node.identifier ?? '') &&
      nodes.filter((candidate) => candidate.identifier === node.identifier).length === 1 &&
      !nodes.some((candidate) => candidate.parentIndex === node.index)
    )
      verifiedSettingsLeaves.add(node);
  }
  return nodes;
}

export function appViewport(nodes: Node[]): NonNullable<Node['rect']> {
  const appNodes = nodes.filter((node) => node.bundleId === 'dev.osuki.muqun');
  const candidates = appNodes.length ? appNodes : nodes.filter((node) => !node.bundleId);
  const rect = candidates
    .map((node) => node.rect)
    .filter((rect): rect is NonNullable<Node['rect']> =>
      Boolean(rect && rect.width > 0 && rect.height > 0)
    )
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!rect) throw new Error('Missing app viewport for canvas gesture');
  return rect;
}

function nodeRole(node: Node): string {
  const source = node.role ?? node.type ?? '';
  const role = source
    .replace(/^XCUIElementType/, '')
    .split('.')
    .at(-1)!
    .toLowerCase();
  // Match agent-device 0.21.12's semantic type normalization, not raw AX or
  // Android class names. TextView is editable on iOS but static on Android.
  if (role === 'textview')
    return /^(android\.|androidx\.|com\.)/.test(source) ? 'text' : 'text-view';
  const aliases: Record<string, string> = {
    statictext: 'text',
    checkedtextview: 'text',
    imagebutton: 'button',
    textbox: 'text-field',
    textfield: 'text-field',
    edittext: 'text-field',
    textarea: 'text-view',
    searchfield: 'search',
    imageview: 'image',
    framelayout: 'group',
    linearlayout: 'group',
    relativelayout: 'group',
    constraintlayout: 'group',
    viewgroup: 'group',
    view: 'group',
    listview: 'list',
    recyclerview: 'list',
    collectionview: 'collection',
    menuitem: 'menu-item',
    scrollarea: 'scroll-area',
    scrollview: 'scroll-area',
    nestedscrollview: 'scroll-area',
    navigationbar: 'navigation-bar',
    tabbar: 'tab-bar',
    activityindicator: 'activity-indicator',
    progressindicator: 'progress-indicator',
    segmentedcontrol: 'segmented-control',
  };
  return aliases[role] ?? role;
}

/** Native iOS visibility can include rows clipped below a form sheet's list. */
export function withinScrollViewport(node: Node, nodes: Node[]): boolean {
  if (!node.rect) return true;
  const { x, y, width, height } = node.rect;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const actionable =
    actionableRoles.has(nodeRole(node)) || settingsControlState(node) !== undefined;
  const seen = new Set<number>();
  let parentIndex = node.parentIndex;
  while (parentIndex !== undefined && !seen.has(parentIndex)) {
    seen.add(parentIndex);
    const parent = nodes.find((candidate) => candidate.index === parentIndex);
    if (!parent) break;
    if (parent.rect && ['scroll-area', 'application'].includes(nodeRole(parent))) {
      const rect = parent.rect;
      const visible = actionable
        ? centerX >= rect.x &&
          centerX < rect.x + rect.width &&
          centerY >= rect.y &&
          centerY < rect.y + rect.height
        : x < rect.x + rect.width &&
          x + width > rect.x &&
          y < rect.y + rect.height &&
          y + height > rect.y;
      if (!visible) return false;
    }
    parentIndex = parent.parentIndex;
  }
  return true;
}

function hasAlert(nodes: Node[]): boolean {
  return nodes.some(
    (node) =>
      ['alert', 'dialog'].includes(nodeRole(node)) ||
      node.identifier?.startsWith('com.android.permissioncontroller:')
  );
}

function notificationDenyButton(nodes: Node[], allowCameraDenial = false): Node | undefined {
  const text = nodes.map((node) => node.label ?? '').join('\n');
  if (
    !/Muqun/i.test(text) ||
    !(
      /notifications?|通知/i.test(text) ||
      (allowCameraDenial && /camera|相机|相機|take pictures and record video/i.test(text))
    )
  )
    return undefined;
  return nodes.find(
    (node) =>
      nodeRole(node) === 'button' && /^(?:don[’']?t allow|不允许|不允許)$/i.test(node.label ?? '')
  );
}

function schemeConfirmationOpenButton(nodes: Node[]): Node | undefined {
  const text = nodes.map((node) => node.label ?? '').join('\n');
  if (!/Muqun/i.test(text)) return undefined;
  if (/notifications?|camera|take pictures/i.test(text)) return undefined;

  const open = nodes.find(
    (node) => nodeRole(node) === 'button' && /^open$/i.test(node.label ?? '')
  );
  if (open) return open;

  const buttons = nodes.filter((node) => nodeRole(node) === 'button');
  if (buttons.length === 2) {
    return (buttons[0].rect?.x ?? 0) > (buttons[1].rect?.x ?? 0) ? buttons[0] : buttons[1];
  }
  return undefined;
}

const guardedMutations = new Set([
  'press',
  'longpress',
  'fill',
  'type',
  'scroll',
  'gesture',
  'keyboard',
  'back',
  'react-native',
]);

const actionableRoles = new Set([
  'text-field',
  'text-view',
  'search',
  'menu-item',
  'button',
  'imagebutton',
  'link',
  'textfield',
  'securetextfield',
  'textbox',
  'edittext',
  'textarea',
  'searchfield',
  'switch',
  'checkbox',
  'radio',
  'slider',
  'menuitem',
]);

function preferControls(nodes: Node[]): Node[] {
  const byIndex = new Map(nodes.map((node) => [node.index, node]));
  const depth = (node: Node): number => {
    const seen = new Set<number>();
    let current: Node | undefined = node;
    while (current?.parentIndex !== undefined && !seen.has(current.index)) {
      seen.add(current.index);
      current = byIndex.get(current.parentIndex);
    }
    return seen.size;
  };
  return [...nodes].sort(
    (a, b) =>
      Number(actionableRoles.has(nodeRole(b))) - Number(actionableRoles.has(nodeRole(a))) ||
      depth(b) - depth(a)
  );
}

function selectorRole(node: Node): string {
  // Selector roles use raw type normalization in sdk-batch-runner, unlike
  // snapshot display roles (StaticText displays as text but matches statictext).
  return (node.type ?? node.role ?? '')
    .trim()
    .replace(/XCUIElementType/gi, '')
    .replace(/^AX/, '')
    .split(/[./]/)
    .at(-1)!
    .toLowerCase();
}

export function exactSelectorMatches(node: Node, selector: string): boolean {
  let remaining = selector.trim();
  let matches = true;
  if (!remaining) throw new Error('Empty exact selector');
  while (remaining) {
    const term = remaining.match(
      /^(id|label|text|value|role)=("(?:\\.|[^"\\])*"|[^\s"=]+)(?:\s+|$)/
    );
    if (!term) throw new Error('Unsupported exact selector');
    const expected = term[2].startsWith('"') ? (JSON.parse(term[2]) as string) : term[2];
    const actual =
      term[1] === 'id'
        ? node.identifier
        : term[1] === 'role'
          ? selectorRole(node)
          : term[1] === 'value'
            ? node.value
            : term[1] === 'text'
              ? node.label || node.value || node.identifier
              : node.label;
    const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
    matches &&= actual !== undefined && normalize(actual) === normalize(expected);
    remaining = remaining.slice(term[0].length);
  }
  return matches;
}

function selector(node: Node): string {
  const role = selectorRole(node);
  const prefix = role ? `role=${JSON.stringify(role)} ` : '';
  if (node.identifier) return `${prefix}id=${JSON.stringify(node.identifier)}`;
  if (node.label) return `${prefix}label=${JSON.stringify(node.label)}`;
  if (node.value) return `${prefix}value=${JSON.stringify(node.value)}`;
  throw new Error('Matched node has no durable selector');
}

export function junit(results: { name: string; seconds: number; error?: string }[]): string {
  const escape = (value: string) =>
    value.replace(
      /[<>&"']/g,
      (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!
    );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="muqun-native-e2e" tests="${results.length}" failures="${results.filter((result) => result.error).length}">\n${results.map((result) => `<testcase name="${escape(result.name)}" time="${result.seconds}">${result.error ? `<failure message="${escape(result.error)}"/>` : ''}</testcase>`).join('\n')}\n</testsuite>\n`;
}

/** How long an Android "foreground clear" probe stays reusable for reads. */
// Three seconds covers a locate poll burst (200ms spacing) while staying an
// order of magnitude below any permission-prompt interaction: prompts wait
// for the reader, so noticing one up to 3s late only delays its dismissal.
const ALERT_CLEAR_TTL_MS = 3000;
/**
 * The launch window in which an empty foreground is still the app arriving.
 *
 * A cold start draws its intro on the GPU before it has mounted anything a
 * screen reader -- or the snapshot helper -- can read, so the first captures
 * after a launch can find the app contributing no window root at all.
 * agent-device reports that as `retriable`, and it is: the tree appears on
 * its own a beat later. Past this many steps the app has had its chance, and
 * a blank foreground is the flow's failure rather than its start.
 */
const APP_CONTENT_RETRY_STEPS = 6;
/** Backoff between attempts, and the ceiling on all of them together. */
const APP_CONTENT_RETRY_BACKOFF_MS = [500, 750, 1000, 1500, 2000];
const APP_CONTENT_RETRY_BUDGET_MS = 10000;
/** Commands that read the tree, and so can land on an app that has none yet. */
const APP_CONTENT_RETRY_COMMANDS = new Set(['snapshot', 'wait', 'press']);
const INSUFFICIENT_APP_CONTENT =
  'Android snapshot helper returned insufficient foreground app content';
/**
 * Only agent-device's own verdict is retried: the stable part of the message
 * AND the `retriable` flag it sets beside it. A COMMAND_FAILED without both
 * is a real failure and is never repeated.
 */
export function isInsufficientAppContent(error: unknown): boolean {
  if (!(error instanceof NativeCommandError)) return false;
  const { code, message, retriable } = error.details;
  return (
    code === 'COMMAND_FAILED' &&
    retriable === true &&
    typeof message === 'string' &&
    message.includes(INSUFFICIENT_APP_CONTENT)
  );
}

export class NativeRunner {
  /**
   * When the last Android foreground-surface probe proved clear. A native
   * permission alert persists until it is dismissed, so observation reads
   * (target polling, visibility assertions) may reuse a recent clear verdict
   * instead of paying a probe per capture: at most the TTL late in noticing
   * a delayed prompt, never acting under one. Every guarded mutation passes
   * `forceAlertCheck` for a fresh probe, which is the actual invariant -- no
   * press, fill, type, scroll or gesture is ever dispatched on a verdict
   * older than its own guard.
   */
  private lastAlertClearMs = 0;
  /**
   * Steps run since the last launch, so the retry below only covers an app
   * that is still arriving. `Infinity` until a flow opens one: a runner that
   * never launched has no launch window to be inside.
   */
  private stepsSinceLaunch = Number.POSITIVE_INFINITY;
  /**
   * Every retry that fired, in order. The CLI writes this beside the flow's
   * step records, so a report says a capture was repeated rather than hiding
   * it behind a step that merely took longer.
   */
  readonly appContentRetries: {
    command: string;
    attempt: number;
    waitedMs: number;
    sinceFirstAttemptMs: number;
  }[] = [];

  constructor(
    readonly suite: Suite,
    readonly base: string,
    readonly artifacts: string,
    readonly invoke: Invoke,
    readonly runtime: {
      metroHost?: string;
      metroPort?: string;
      devClientUrl?: string;
      allowCameraDenial?: boolean;
    }
  ) {}

  async readySnapshot(forceAlertCheck = false): Promise<Node[]> {
    let capture = await this.readCapture();
    let nodes = snapshotNodes(capture);
    if (capture.androidSnapshot) {
      const recentlyClear =
        !forceAlertCheck && Date.now() - this.lastAlertClearMs < ALERT_CLEAR_TTL_MS;
      if (!recentlyClear) {
        const status = await this.invoke(['alert', 'get']);
        if (status.kind !== 'alertStatus' || status.alert === undefined)
          throw new Error('Invalid Android alert status');
        const alert = status.alert as {
          title?: string;
          source?: string;
          packageName?: string;
          buttons?: string[];
        } | null;
        if (alert) {
          if (
            alert.source !== 'permission' ||
            !/^com\.(?:google\.)?android\.permissioncontroller$/.test(alert.packageName ?? '') ||
            !/Muqun/i.test(alert.title ?? '') ||
            !(
              /notifications?|通知/i.test(alert.title ?? '') ||
              (this.runtime.allowCameraDenial &&
                /camera|相机|相機|take pictures and record video/i.test(alert.title ?? ''))
            ) ||
            !alert.buttons?.some((label) => /^(?:don[’']?t allow|不允许|不允許)$/i.test(label))
          )
            throw new Error('Unexpected Android alert blocks the test');
          await this.invoke(['alert', 'dismiss']);
          const after = await this.invoke(['alert', 'get']);
          if (after.kind !== 'alertStatus' || after.alert !== null)
            throw new Error('Notification permission alert did not dismiss');
          capture = await this.readCapture();
          nodes = snapshotNodes(capture);
        }
        // Both paths proved the foreground clear just now: an absent alert,
        // or a dismissed one verified gone.
        this.lastAlertClearMs = Date.now();
      }
    }
    if (!hasAlert(nodes)) return nodes;
    // A system dialog is caught mid-slide as often as not: a button resolved
    // from that capture carries the geometry of a frame the dialog has since
    // left, and the tap lands on the scrim. Let it settle, resolve the button
    // from a fresh capture, and only then press -- twice, because the first
    // press can still race the last frame of the animation.
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.invoke(['wait', 'stable', '300', '5000']);
      nodes = snapshotNodes(await this.readCapture());
      if (!hasAlert(nodes)) return nodes;
      const actionButton =
        notificationDenyButton(nodes, this.runtime.allowCameraDenial) ??
        schemeConfirmationOpenButton(nodes);
      if (!actionButton)
        throw new Error(
          'Unexpected system alert blocks the test; inspect the saved snapshot before continuing'
        );
      // Only the app's permission requests are automatic setup actions. The
      // device language may differ from the app language. Never press or
      // swipe app controls underneath a native alert, even if they remain in
      // its tree.
      await this.invoke(['press', selector(actionButton)]);
    }
    await this.invoke(['wait', 'stable', '300', '5000']);
    nodes = snapshotNodes(await this.readCapture());
    if (hasAlert(nodes)) throw new Error('Notification permission alert did not dismiss');
    return nodes;
  }

  /**
   * Run one command, repeating it while agent-device says the foreground app
   * has not produced a tree yet.
   *
   * The retry is deliberately narrow. It fires only for agent-device's own
   * `retriable` insufficient-content verdict, only for commands that read the
   * tree, and only inside the launch window -- a blank app in the middle of a
   * flow is a failure and fails at once. The budget is both a count and a
   * clock, and when it is spent the original error is what the flow sees:
   * nothing is swallowed, and no step is ever repeated for any other reason.
   */
  private async invokeSettling(args: string[]): Promise<Record<string, unknown>> {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.invoke(args);
      } catch (error) {
        const waitedMs = APP_CONTENT_RETRY_BACKOFF_MS[attempt];
        if (
          waitedMs === undefined ||
          this.stepsSinceLaunch > APP_CONTENT_RETRY_STEPS ||
          !isInsufficientAppContent(error) ||
          Date.now() - started >= APP_CONTENT_RETRY_BUDGET_MS
        )
          throw error;
        this.appContentRetries.push({
          command: args[0],
          attempt: attempt + 1,
          waitedMs,
          sinceFirstAttemptMs: Date.now() - started,
        });
        await new Promise((resolve) => setTimeout(resolve, waitedMs));
      }
    }
  }

  private async readCapture(): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      let capture: Record<string, unknown>;
      for (let busyAttempt = 0; ; busyAttempt++) {
        try {
          capture = await this.invokeSettling(['snapshot']);
          break;
        } catch (error) {
          const delay = [1000, 2000, 4000, 8000][busyAttempt];
          if (delay === undefined || !String(error).includes('RUNNER_BUSY')) throw error;
          // A heavy iOS accessibility capture can outlive agent-device's
          // watchdog. Only repeat this read; never replay the preceding input.
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      const quality = capture.snapshotQuality as
        | { state?: string; backend?: string; reason?: string; reasonCode?: string }
        | undefined;
      if (
        attempt >= 2 ||
        quality?.backend !== 'private-ax' ||
        !(
          (quality.state === 'sparse' && /deferred/i.test(quality.reason ?? '')) ||
          quality.reasonCode === 'sparse-tree'
        )
      )
        return capture;
      // Deferred iOS acquisition is transient; retry only this read, never
      // dismiss, reopen or repeat an input. Exhaustion still fails quality.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async locate(target: Target): Promise<Node | undefined> {
    const nodes = await this.readySnapshot();
    const identity = { text: target.text, id: target.id };
    const matching = preferControls(nodes).filter((candidate) => matches(candidate, identity));
    const settingsControls = matching.filter(
      (candidate) => settingsControlState(candidate) !== undefined
    );
    const controls = settingsControls.length
      ? settingsControls
      : matching.filter((candidate) => actionableRoles.has(nodeRole(candidate)));
    // State belongs to the control. An unchecked/unselected wrapper must not
    // satisfy a negative state assertion when its real control is selected.
    const candidates = controls.length ? controls : matching;
    // iOS containers inherit descendant labels. Preserve the matched control's
    // role through the visibility probe and mutation instead of resolving that
    // label again to a large ancestor. Distinct same-role siblings still reach
    // native ambiguity checks; no coordinate or arbitrary-first fallback.
    for (const node of candidates.filter((candidate) => matches(candidate, target))) {
      if (!withinScrollViewport(node, nodes)) continue;
      let visible: Record<string, unknown>;
      try {
        visible = await this.invoke(['is', 'exists', `${selector(node)} visible=true`]);
      } catch (error) {
        const detail = error instanceof NativeCommandError ? error.details.details : undefined;
        if (
          detail?.blockedBy !== 'android_foreground_surface' ||
          !/^com\.(?:google\.)?android\.permissioncontroller$/.test(
            String(detail.foregroundPackage)
          )
        )
          throw error;
        // A notification prompt may arrive between the capture and predicate.
        // Only repeat this read-only probe, after the guarded alert handling.
        await this.readySnapshot();
        visible = await this.invoke(['is', 'exists', `${selector(node)} visible=true`]);
      }
      if (typeof visible.pass !== 'boolean')
        throw new Error('Visibility probe did not return a predicate');
      if (visible.pass) return node;
    }
    return undefined;
  }

  async runSection(reference: string, env: Record<string, string>): Promise<void> {
    const [file, name] = reference.split('#');
    const absolute = path.resolve(this.base, file);
    if (!absolute.startsWith(`${this.base}${path.sep}`) || !file.endsWith('.ad'))
      throw new Error(`Invalid .ad path: ${file}`);
    const contents = await readFile(absolute, 'utf8');
    let active = name === undefined;
    let found = active;
    for (const line of contents.split('\n')) {
      if (line.startsWith('# section ')) {
        active = line.slice(10).trim() === name;
        found ||= active;
        continue;
      }
      if (!active || !line.trim() || line.trim().startsWith('#') || line.startsWith('context '))
        continue;
      const args = tokenize(line).map((arg) => interpolate(arg, env));
      // Visibility means at least one visible exact match, not unique identity.
      // Native is visible uses readUnique and mistakes duplicate headings for
      // absence; exists + visible=true uses the identical visibility predicate.
      if (args[0] === 'is' && args[1] === 'visible') {
        args[1] = 'exists';
        args[2] = `${args[2]} visible=true`;
      }
      if (args[0] === 'open' && args[1] === 'dev.osuki.muqun') {
        if (this.runtime.metroHost) args.push('--metro-host', this.runtime.metroHost);
        if (this.runtime.metroPort) args.push('--metro-port', this.runtime.metroPort);
        if (this.runtime.devClientUrl) args.push('--launch-url', this.runtime.devClientUrl);
      }
      if (args[0] === 'screenshot') {
        args[1] = path.join(this.artifacts, args[1].replace(/^dist\//, ''));
        await mkdir(path.dirname(args[1]), { recursive: true });
      }
      if (args.includes('--unless-visible')) {
        const index = args.indexOf('--unless-visible');
        const target = args[index + 1];
        if (args[0] !== 'scroll' || !target?.startsWith('id='))
          throw new Error('Conditional scrolling requires an id target');
        args.splice(index, 2);
        if (await this.locate({ id: target.slice(3) })) continue;
      }
      if (args.includes('--dismiss-ipad-keyboard')) {
        args.splice(args.indexOf('--dismiss-ipad-keyboard'), 1);
        if (env.DEVICE_KIND === 'ipad') {
          // The dedicated 1210x834 iPad keyboard has a Hide keyboard key at
          // this point. Its AX label is intermittent, but the key is visible.
          await this.invoke(['press', '1138', '771']);
          await this.invoke(['wait', 'stable', '300', '5000']);
          continue;
        }
      }
      if (args.includes('--in-sheet')) {
        if (args[0] !== 'scroll' || args[1] !== 'down')
          throw new Error('In-sheet scrolling requires scroll down');
        args.splice(args.indexOf('--in-sheet'), 1);
        if (env.DEVICE_KIND === 'ipad') {
          const nodes = await this.readySnapshot(true);
          const grabber = nodes.find((node) => node.label === 'Sheet Grabber');
          if (!grabber?.rect) throw new Error('Missing iPad sheet grabber for in-sheet scroll');
          const viewport = appViewport(nodes);
          const x = Math.round(grabber.rect.x + grabber.rect.width / 2);
          const start = Math.round(
            Math.min(viewport.y + viewport.height - 80, grabber.rect.y + 395)
          );
          const dy = Math.round(grabber.rect.y + 90 - start);
          for (let pass = 0; pass < Number(args[2] ?? '1'); pass++)
            await this.invoke(['gesture', 'pan', String(x), String(start), '0', String(dy), '400']);
          continue;
        }
      }
      // A launch reopens the window; every other step spends it down.
      this.stepsSinceLaunch = args[0] === 'open' ? 0 : this.stepsSinceLaunch + 1;
      // The landscape iPad theme preview stalls XCUITest accessibility capture.
      // Permit one screenshot-backed coordinate press there, without asking the
      // stalled tree for another verdict. The next assertion checks its result.
      const visualPress =
        args[0] === 'press' &&
        args[3] === '--visual' &&
        /^\d+$/.test(args[1] ?? '') &&
        /^\d+$/.test(args[2] ?? '') &&
        env.DEVICE_KIND === 'ipad';
      if (args.includes('--visual') && !visualPress)
        throw new Error('Visual press requires iPad and numeric coordinates');
      if (visualPress) {
        const screenshot = path.join(this.artifacts, 'visual-press-before.png');
        await this.invoke(['screenshot', screenshot]);
        args.pop();
      }
      let guardedNodes: Node[] | undefined;
      if (guardedMutations.has(args[0]) && !visualPress)
        guardedNodes = await this.readySnapshot(true);
      if (args[0] === 'alert' && args[1] === 'dismiss') {
        const status = await this.invoke(['alert', 'get']);
        const alert = status.alert as { title?: string; buttons?: string[] } | null;
        const expectedTitle =
          alert?.title === 'Notifications are not allowed' ||
          (alert?.title === 'Allow notifications in system settings to preview them' &&
            alert.buttons?.includes('Notifications are not allowed'));
        if (
          status.kind !== 'alertStatus' ||
          !expectedTitle ||
          !alert?.buttons?.some((label) => /^cancel$/i.test(label))
        )
          throw new Error('Only the expected local-notification denial alert may be dismissed');
      }
      if (args[0] === 'back') {
        // Android exposes controls behind the catalogue sheet in its tree.
        // Its underlying "Go back" must not steal the sheet's Back action.
        if (
          guardedNodes?.some(
            (node) =>
              node.identifier === 'theme-browse-list' ||
              (env.PLATFORM === 'android' &&
                (node.identifier === 'theme-tab' || node.label === 'Quick action settings'))
          )
        ) {
          await this.invoke(['back', '--system']);
          continue;
        }
        // A landscape iPad form sheet exposes its outside dismissal region.
        // Press a point in that region: dragging the grabber by 500 points
        // crosses the reduced viewport when the software keyboard is open.
        const dismissRegion = guardedNodes?.find(
          (node) => node.identifier === 'PopoverDismissRegion'
        );
        if (dismissRegion && guardedNodes) {
          const viewport = appViewport(guardedNodes);
          if (viewport.width > 900) {
            await this.invoke([
              'press',
              String(Math.round(viewport.x + viewport.width * 0.08)),
              String(Math.round(viewport.y + Math.min(200, viewport.height * 0.25))),
            ]);
            continue;
          }
        }
        const grabber = guardedNodes?.find((node) => node.label === 'Sheet Grabber');
        if (grabber?.rect) {
          const x = Math.round(grabber.rect.x + grabber.rect.width / 2);
          const y = Math.round(grabber.rect.y + grabber.rect.height / 2);
          await this.invoke(['gesture', 'pan', String(x), String(y), '0', '500', '350']);
          continue;
        }
        const goBack = guardedNodes?.find(
          (node) => nodeRole(node) === 'button' && /^(?:go back|back)$/i.test(node.label ?? '')
        );
        if (goBack) {
          await this.invoke(['press', selector(goBack)]);
          continue;
        }
      }
      let result: Record<string, unknown>;
      try {
        try {
          result = APP_CONTENT_RETRY_COMMANDS.has(args[0])
            ? await this.invokeSettling(args)
            : await this.invoke(args);
        } catch (error) {
          if (
            args[0] === 'fill' &&
            error instanceof NativeCommandError &&
            error.details.code === 'TEXT_INPUT_COMMIT_NOT_OBSERVED'
          ) {
            const fields = snapshotNodes(await this.readCapture()).filter((node) =>
              exactSelectorMatches(node, args[1])
            );
            if (fields.length === 1 && fields[0].value === args[2]) {
              result = { verification: 'confirmed' };
            } else {
              const retry = [...args];
              const delay = retry.indexOf('--delay-ms');
              if (delay >= 0) retry[delay + 1] = '80';
              else retry.push('--delay-ms', '80');
              result = await this.invoke(retry);
            }
          } else {
            // Right after a relaunch the accessibility backend can stall before
            // it has read a single tree: agent-device reports `captureStalled`
            // with zero captures and calls it retriable. The app is up (the
            // failure screenshot shows it); only the capture is. One more try
            // before it counts as the flow's failure.
            const detail = error instanceof NativeCommandError ? error.details.details : undefined;
            if (
              args[0] !== 'wait' ||
              args[1] !== 'stable' ||
              detail?.captureStalled !== true ||
              (typeof detail.captures === 'number' && detail.captures > 0)
            )
              throw error;
            result = await this.invoke(args);
          }
        }
        // An atomic `fill` can race the IME: agent-device then reports the
        // set as `unconfirmed` and the field is left with whatever the editor
        // settled on. One more attempt after the field is stable is the same
        // trust boundary as a dialog press -- the second result is the one
        // that is checked.
        if (args[0] === 'fill' && result.verification === 'unconfirmed') {
          await this.invoke(['wait', 'stable', '300', '5000']);
          result = await this.invoke(args);
        }
      } catch (error) {
        const detail = error instanceof NativeCommandError ? error.details : undefined;
        if (
          args[0] !== 'is' ||
          args[1] !== 'hidden' ||
          detail?.code !== 'COMMAND_FAILED' ||
          detail.details?.reason !== 'selector_not_found' ||
          detail.details.predicate !== 'hidden' ||
          detail.details.blockedBy
        )
          throw error;
        // Exact conjunctive selector terms can be proved from a fresh capture.
        // Unsupported grammar and ambiguous/blocked native errors stay errors.
        const nodes = await this.readySnapshot();
        if (nodes.some((node) => exactSelectorMatches(node, args[2]))) throw error;
        result = { pass: true };
      }
      if (args[0] === 'is') requirePass(result);
      // iOS hittability is advisory: successful navigation can report false.
      // Keep that diagnostic in the command log; verify with the flow's next
      // destination assertion instead of failing here or repeating the action.
    }
    if (!found) throw new Error(`Missing native section: ${reference}`);
  }

  async run(steps: Step[], env: Record<string, string> = {}, stack: string[] = []): Promise<void> {
    for (const step of steps) {
      if (step.include) {
        if (stack.includes(step.include)) throw new Error(`Cyclic include: ${step.include}`);
        const included = this.suite.programs[step.include];
        if (!included) throw new Error(`Missing program: ${step.include}`);
        await this.run(included, { ...env, ...step.env }, [...stack, step.include]);
        continue;
      }
      if (step.when) {
        const condition = step.when;
        const pass = condition.env
          ? env[condition.env] === condition.equals
          : Boolean(await this.locate(this.renderTarget(condition.target!, env))) !==
            Boolean(condition.absent);
        if (pass) await this.run(step.steps ?? [], env, stack);
        continue;
      }
      if (step.target) {
        const target = this.renderTarget(step.target, env);
        const deadline = Date.now() + (step.timeout ?? (step.optional ? 0 : 8000));
        let node: Node | undefined;
        do {
          node = await this.locate(target);
          if (step.mode === 'hidden' ? !node : Boolean(node)) break;
          if (step.optional) break;
          if (step.mode === 'scroll') await this.runSection(step.run!, env);
          else await new Promise((resolve) => setTimeout(resolve, 200));
        } while (Date.now() < deadline);
        if (step.mode === 'hidden') {
          if (node) throw new Error(`Expected hidden: ${JSON.stringify(target)}`);
          continue;
        }
        if (!node) {
          if (step.optional) continue;
          throw new Error(`Expected visible: ${JSON.stringify(target)}`);
        }
        if (step.mode !== 'scroll')
          await this.runSection(step.run!, { ...env, TARGET: selector(node) });
        continue;
      }
      if (step.point) {
        const nodes = await this.readySnapshot();
        const rect = appViewport(nodes);
        await this.runSection(step.run!, {
          ...env,
          X: String(Math.round(rect.x + rect.width * step.point[0])),
          Y: String(Math.round(rect.y + rect.height * step.point[1])),
          DX: String(Math.round(rect.width * (step.delta?.[0] ?? 0))),
          DY: String(Math.round(rect.height * (step.delta?.[1] ?? 0))),
        });
        continue;
      }
      if (!step.run) throw new Error(`Invalid suite step: ${JSON.stringify(step)}`);
      await this.runSection(step.run, env);
    }
  }

  private renderTarget(target: Target, env: Record<string, string>): Target {
    return {
      ...target,
      ...(target.text !== undefined ? { text: interpolate(target.text, env) } : {}),
      ...(target.id !== undefined ? { id: interpolate(target.id, env) } : {}),
    };
  }
}

export function subprocess(binary: string, common: string[], log: string, cwd: string): Invoke {
  let sequence = 0;
  return async (args) => {
    const result = await new Promise<{ stdout: string; stderr: string; status: number }>(
      (resolve, reject) => {
        const child = spawn(binary, [...args, ...common, '--json'], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
        const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (status) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, status: status ?? 1 });
        });
      }
    );
    await writeFile(
      path.join(log, `${String(++sequence).padStart(4, '0')}-${args[0]}.json`),
      JSON.stringify({ args, ...result }, null, 2)
    );
    return decodeReply(result.stdout, result.status);
  };
}
