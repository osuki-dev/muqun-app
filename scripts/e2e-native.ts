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
  /** Device kinds (`DEVICE_KIND`) the flow runs on; every kind when absent. */
  devices?: string[];
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
  kind?: string;
  role?: string;
  identifier?: string;
  label?: string;
  value?: string;
  selected?: boolean;
  checked?: boolean;
  /** Android's native snapshot visibility; iOS may omit it. */
  visibleToUser?: boolean;
  enabled?: boolean;
  hittable?: boolean;
  interactionBlocked?: string;
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

export function selectFlows(
  suite: Suite,
  tag: string,
  platform: string,
  name?: string,
  deviceKind?: string
): Flow[] {
  const selected = suite.flows.filter((flow) =>
    name ? flow.name === name : flow.tags.includes(tag)
  );
  if (name && !selected.length) throw new Error(`Unknown flow: ${name}`);
  if (name && selected[0].disabled) throw new Error(selected[0].disabled);
  const runsOn = (flow: Flow) => !deviceKind || !flow.devices || flow.devices.includes(deviceKind);
  if (name && !runsOn(selected[0])) throw new Error(`${name} does not run on ${deviceKind}`);
  return selected.filter(
    (flow) => !flow.disabled && flow.platforms.includes(platform) && runsOn(flow)
  );
}

/**
 * An Android device's kind by its smallest width, the way Android itself
 * tells a tablet (600 dp and up) from a phone; `wm`'s override line, printed
 * after the physical one, wins.
 */
export function androidDeviceKind(
  size: string,
  density: string
): 'android-tablet' | 'android-phone' {
  const pixels = [...size.matchAll(/(\d+)x(\d+)/g)].at(-1);
  const dpi = [...density.matchAll(/(\d+)/g)].at(-1);
  if (!pixels || !dpi) throw new Error('Cannot read the Android display size');
  const smallest = (Math.min(Number(pixels[1]), Number(pixels[2])) * 160) / Number(dpi[1]);
  return smallest >= 600 ? 'android-tablet' : 'android-phone';
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
  const source = node.kind ?? node.role ?? node.type ?? '';
  const role = source
    .replace(/^XCUIElementType/, '')
    .split('.')
    .at(-1)!
    .toLowerCase();
  // Match agent-device's semantic type normalization, not raw AX or
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

/** Native iOS visibility can include rows outside a list or behind the keyboard. */
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
  // The placeholder includes the assistant band above the keys. Preserve
  // native keyboard controls while refusing app controls covered by either.
  const keyboards = nodes.filter(
    (candidate) =>
      candidate.visibleToUser !== false &&
      (candidate.type === 'Keyboard' ||
        (candidate.identifier === 'inputView' &&
          candidate.role === '_UIRemoteKeyboardPlaceholderView') ||
        (candidate.identifier === 'SystemInputAssistantView' &&
          candidate.role === 'TUISystemInputAssistantView'))
  );
  const keyboardTarget = keyboards.some(
    (candidate) => candidate.index === node.index || seen.has(candidate.index)
  );
  if (
    !keyboardTarget &&
    keyboards.some((candidate) => {
      const rect = candidate.rect;
      if (!rect) return false;
      return actionable
        ? centerX >= rect.x &&
            centerX < rect.x + rect.width &&
            centerY >= rect.y &&
            centerY < rect.y + rect.height
        : x >= rect.x &&
            x + width <= rect.x + rect.width &&
            y >= rect.y &&
            y + height <= rect.y + rect.height;
    })
  )
    return false;
  return true;
}

/**
 * The sheet's grabber control. The tree snapshot backend also hands its label
 * to the sheet's container, whose centre is in the middle of the sheet's
 * content, so a drag from there scrolls the content instead of the sheet.
 */
export function sheetGrabber(nodes: Node[]): Node | undefined {
  const grabbers = nodes.filter((node) => node.label === 'Sheet Grabber');
  return grabbers.find((node) => nodeRole(node) === 'button') ?? grabbers[0];
}

/** Native grabbers can overlap the OS top-edge gesture region. Dismiss from
 * observed fixed-header padding instead, before the sheet's first scroller.
 * Private AX flattens that header and scroller beside the sheet root, so use
 * the observed sheet bounds as well as native ancestry when it is available.
 */
function sheetDismissStart(nodes: Node[], grabber: Node): { x: number; y: number } {
  const viewport = appViewport(nodes);
  const control = grabber.rect!;
  const x = Math.round(control.x + control.width / 2);
  // A lowered sheet exposes its real UIKit grabber well below the OS
  // edge. Its content may start behind the grabber, with no fixed header gap.
  if (
    nodeRole(grabber) === 'button' &&
    control.height > 0 &&
    control.height <= 44 &&
    control.y >= viewport.y + 80 &&
    control.y + control.height < viewport.y + viewport.height - 24 &&
    control.x >= viewport.x &&
    control.x + control.width <= viewport.x + viewport.width
  ) {
    return { x, y: Math.round(control.y + control.height / 2) };
  }
  const ancestors = new Set<number>();
  let parentIndex = grabber.parentIndex;
  while (parentIndex !== undefined && !ancestors.has(parentIndex)) {
    ancestors.add(parentIndex);
    parentIndex = nodes.find((node) => node.index === parentIndex)?.parentIndex;
  }
  const container = nodes.find(
    (node) =>
      ancestors.has(node.index) &&
      node.label === 'Sheet Grabber' &&
      node.rect &&
      node.rect.height > control.height
  );
  const sheet =
    container ??
    nodes.find(
      (node) =>
        (node.identifier?.endsWith('-sheet') || node.identifier === 'git-diff-view') &&
        node.visibleToUser !== false &&
        node.rect &&
        node.rect.x <= x &&
        x < node.rect.x + node.rect.width &&
        node.rect.y <= control.y + control.height &&
        node.rect.height > control.height
    );
  const bounds = sheet?.rect;
  if (!bounds) throw new Error('Cannot dismiss sheet without observed fixed-header bounds');
  const descendsFrom = (node: Node, index: number): boolean => {
    const seen = new Set<number>();
    let parent = node.parentIndex;
    while (parent !== undefined && !seen.has(parent)) {
      if (parent === index) return true;
      seen.add(parent);
      parent = nodes.find((candidate) => candidate.index === parent)?.parentIndex;
    }
    return false;
  };
  const scoped = nodes.filter((node) => {
    const rect = node.rect;
    return (
      rect &&
      node.visibleToUser !== false &&
      rect.x >= bounds.x &&
      rect.x + rect.width <= bounds.x + bounds.width &&
      rect.y >= bounds.y &&
      rect.y + rect.height <= bounds.y + bounds.height + 1 &&
      (!container || descendsFrom(node, container.index))
    );
  });
  // A scroll-root form puts the heading inside the sheet's outer scroller.
  // Treat that observed ancestor as the sheet viewport, not its first list.
  // The visible heading still has to leave an uncovered gap before a nested
  // list; an offscreen heading or an unsafe touch point continues to fail.
  const rootScrollers = new Set(
    scoped
      .filter(
        (node) =>
          nodeRole(node) === 'scroll-area' &&
          sheet &&
          descendsFrom(sheet, node.index) &&
          (['x', 'y', 'width', 'height'] as const).every(
            (key) => Math.abs(node.rect![key] - bounds[key]) <= 1
          )
      )
      .map((node) => node.index)
  );
  const scroller = scoped
    .filter(
      (node) =>
        nodeRole(node) === 'scroll-area' &&
        !rootScrollers.has(node.index) &&
        node.rect!.x <= x &&
        x < node.rect!.x + node.rect!.width
    )
    .sort((a, b) => a.rect!.y - b.rect!.y)[0];
  const y = scroller ? Math.floor(scroller.rect!.y - 1) : NaN;
  const header = scoped.filter(
    (node) =>
      nodeRole(node) === 'text' &&
      node.rect!.y < (scroller?.rect!.y ?? 0) &&
      !scoped.some(
        (candidate) =>
          nodeRole(candidate) === 'scroll-area' &&
          !rootScrollers.has(candidate.index) &&
          descendsFrom(node, candidate.index)
      )
  );
  const covered = scoped.some(
    (node) =>
      actionableRoles.has(nodeRole(node)) &&
      node.rect!.x <= x &&
      x < node.rect!.x + node.rect!.width &&
      node.rect!.y <= y &&
      y < node.rect!.y + node.rect!.height
  );
  if (
    !header.length ||
    covered ||
    y <=
      Math.max(
        control.y + control.height,
        ...header.map((node) => node.rect!.y + node.rect!.height)
      ) ||
    x < viewport.x ||
    x >= viewport.x + viewport.width ||
    y < viewport.y ||
    y >= viewport.y + viewport.height - 24
  ) {
    throw new Error('Cannot dismiss sheet without safe observed fixed-header padding');
  }
  return { x, y };
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

/** Resolve only a unique existing ancestor/descendant in ONE current capture.
 * Native generation pins reject stale refs; snapshot annotations alone cannot
 * disambiguate the platform's independent semantic-selector resolver.
 */
function scopedNativeRef(capture: Record<string, unknown>, identity: string, scopeId: string) {
  const nodes = snapshotNodes(capture);
  if (capture.appBundleId !== 'dev.osuki.muqun' || capture.truncated !== false)
    throw new Error('Scoped press requires a complete foreground Muqun capture');
  const generation = capture.refsGeneration;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1)
    throw new Error('Scoped press requires a current native refsGeneration');
  const byIndex = new Map(nodes.map((node) => [node.index, node]));
  if (nodes.some((node) => !Number.isSafeInteger(node.index) || node.index < 0))
    throw new Error('Scoped press has invalid native indexes');
  if (byIndex.size !== nodes.length) throw new Error('Scoped press has duplicate native indexes');
  const scopes = nodes.filter((node) => node.identifier === scopeId);
  if (scopes.length !== 1) throw new Error('Scoped press requires one existing ancestor');
  const scope = scopes[0];
  if (
    scope.bundleId !== 'dev.osuki.muqun' ||
    scope.visibleToUser === false ||
    scope.interactionBlocked
  )
    throw new Error('Scoped press ancestor is not available');
  const targets = nodes.filter((node) => {
    if (!exactSelectorMatches(node, identity)) return false;
    const seen = new Set<number>([node.index]);
    let containsScope = false;
    let parentIndex = node.parentIndex;
    while (parentIndex !== undefined) {
      if (!Number.isSafeInteger(parentIndex) || parentIndex < 0)
        throw new Error('Scoped press has invalid native ancestry');
      if (seen.has(parentIndex)) throw new Error('Scoped press has cyclic native ancestry');
      seen.add(parentIndex);
      const parent = byIndex.get(parentIndex);
      if (!parent) throw new Error('Scoped press has missing native ancestry');
      if (parent === scope) containsScope = true;
      parentIndex = parent.parentIndex;
    }
    // Finding the scope is not sufficient: validate THROUGH it to a legal
    // root, before the legacy viewport helper's permissive missing/cycle exit.
    return containsScope;
  });
  if (targets.length !== 1) throw new Error('Scoped press requires one semantic descendant');
  const target = targets[0];
  if (
    target.bundleId !== 'dev.osuki.muqun' ||
    target.visibleToUser !== true ||
    target.hittable !== true ||
    target.enabled === false ||
    target.interactionBlocked ||
    !target.rect ||
    !Object.values(target.rect).every(Number.isFinite) ||
    target.rect.width <= 0 ||
    target.rect.height <= 0 ||
    !withinScrollViewport(target, nodes)
  )
    throw new Error('Scoped press descendant is not visible and hittable');
  const ref = /^e\d+(?:~s(\d+))?$/.exec(target.ref);
  if (
    !ref ||
    nodes.filter((node) => node.ref === target.ref).length !== 1 ||
    (ref[1] !== undefined && Number(ref[1]) !== generation)
  )
    throw new Error('Scoped press has a missing, invalid or stale native ref');
  return `@${target.ref}${ref[1] === undefined ? `~s${generation}` : ''}`;
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
    return snapshotNodes(await this.readyCapture(forceAlertCheck));
  }

  private async readyCapture(forceAlertCheck = false): Promise<Record<string, unknown>> {
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
    if (!hasAlert(nodes)) return capture;
    // A system dialog is caught mid-slide as often as not: a button resolved
    // from that capture carries the geometry of a frame the dialog has since
    // left, and the tap lands on the scrim. Let it settle, resolve the button
    // from a fresh capture, and only then press -- twice, because the first
    // press can still race the last frame of the animation.
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.invoke(['wait', 'stable', '300', '5000']);
      capture = await this.readCapture();
      nodes = snapshotNodes(capture);
      if (!hasAlert(nodes)) return capture;
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
    capture = await this.readCapture();
    nodes = snapshotNodes(capture);
    if (hasAlert(nodes)) throw new Error('Notification permission alert did not dismiss');
    return capture;
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
      const sparseTree = quality?.reasonCode === 'sparse-tree';
      const deferredPrivateAX =
        quality?.backend === 'private-ax' &&
        quality.state === 'sparse' &&
        /deferred/i.test(quality.reason ?? '');
      const timedOutPrivateAX =
        quality?.backend === 'private-ax' &&
        quality.state === 'recovered' &&
        quality.reasonCode === 'capture-failed' &&
        quality.reason === 'timed out while preparing tree snapshot on the XCTest main thread';
      if (!sparseTree && !deferredPrivateAX && !timedOutPrivateAX) return capture;
      if (attempt >= (timedOutPrivateAX ? 1 : sparseTree ? 8 : 2)) return capture;
      // Navigation can stall XCTest's first tree preparation, then produce a
      // readable capture. Reacquire once; snapshotNodes still rejects exhausted
      // failures. Sparse launch trees retain their existing settling budget.
      // Repeat only the read; never replay the preceding input.
      await new Promise((resolve) => setTimeout(resolve, sparseTree ? 500 : 250));
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
      const scopeIndex = args.indexOf('--within-id');
      let scopeId: string | undefined;
      if (scopeIndex >= 0) {
        if (args[0] !== 'press' || scopeIndex !== 2 || args.length !== 4 || !args[3])
          throw new Error('Scoped press requires press <exact selector> --within-id <existing ID>');
        scopeId = args[3];
        args.splice(2, 2);
      }
      if (args.includes('--allow-microphone-prompt')) {
        args.splice(args.indexOf('--allow-microphone-prompt'), 1);
        if (args[0] !== 'wait' || !/^id="voice-visual-(?:recording|error)"$/.test(args[1] ?? ''))
          throw new Error('Microphone prompt handling requires an explicit voice-state wait');
        const timeout = Number(args[2] ?? 15000);
        if (!Number.isFinite(timeout) || timeout <= 0)
          throw new Error('Microphone prompt wait requires a positive timeout');
        const deadline = Date.now() + timeout;
        let accepted = false;
        let arrived = false;
        while (Date.now() < deadline) {
          const capture = await this.readCapture();
          const status = await this.invoke(['alert', 'get']);
          if (status.kind !== 'alertStatus' || status.alert === undefined)
            throw new Error('Invalid microphone alert status');
          const alert = status.alert as {
            title?: string;
            message?: string;
            source?: string;
            packageName?: string;
            buttons?: string[];
          } | null;
          if (alert) {
            const copy = `${alert.title ?? ''} ${alert.message ?? ''}`;
            if (
              accepted ||
              !/\bMuqun\b/i.test(copy) ||
              !/microphone|record audio/i.test(copy) ||
              /camera|location|notifications?|contacts/i.test(copy) ||
              (capture.androidSnapshot &&
                (alert.source !== 'permission' ||
                  !/^com\.(?:google\.)?android\.permissioncontroller$/.test(
                    alert.packageName ?? ''
                  ))) ||
              !alert.buttons?.some((button) =>
                /^(?:while using the app|only this time|allow|ok)$/i.test(button)
              )
            )
              throw new Error('Unexpected alert during the explicit microphone request');
            await this.invoke(['alert', 'accept']);
            accepted = true;
            await this.invoke(['wait', 'stable', '300', '5000']);
            const after = await this.invoke(['alert', 'get']);
            if (after.kind !== 'alertStatus' || after.alert !== null)
              throw new Error('Microphone permission alert did not dismiss');
          } else if (
            snapshotNodes(capture).some(
              (node) => exactSelectorMatches(node, args[1]) && node.visibleToUser !== false
            )
          ) {
            // Retain the native state assertion after the permission branch.
            await this.invoke(args);
            arrived = true;
            break;
          }
          if (Date.now() >= deadline)
            throw new Error(`Voice state did not arrive after microphone request: ${args[1]}`);
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (!arrived)
          throw new Error(`Voice state did not arrive after microphone request: ${args[1]}`);
        continue;
      }
      // Visibility means at least one visible exact match, not unique identity.
      // Native is visible uses readUnique and mistakes duplicate headings for
      // absence; exists + visible=true uses the identical visibility predicate.
      if (args[0] === 'is' && args[1] === 'visible') {
        args[1] = 'exists';
        args[2] = `${args[2]} visible=true`;
      }
      if (args[0] === 'keyboard' && args[1] === 'require-visible') {
        if (args.length !== 2 || env.PLATFORM !== 'android')
          throw new Error('Real keyboard visibility assertion requires Android');
        const keyboard = await this.invoke(['keyboard', 'status']);
        if (
          keyboard.platform !== 'android' ||
          keyboard.visible !== true ||
          keyboard.inputOwner !== 'app' ||
          keyboard.focusedPackage !== 'dev.osuki.muqun'
        )
          throw new Error('The real Android keyboard is not visible');
        continue;
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
      if (args.includes('--dismiss-iphone-keyboard')) {
        args.splice(args.indexOf('--dismiss-iphone-keyboard'), 1);
        if (env.DEVICE_KIND === 'iphone') {
          const returnKey = await this.locate({ text: 'return' });
          if (returnKey) {
            await this.invoke(['press', selector(returnKey)]);
            await this.invoke(['wait', 'stable', '300', '5000']);
          }
        }
        continue;
      }
      if (args.includes('--in-sheet')) {
        if (args[0] !== 'scroll' || !['down', 'up', 'bottom'].includes(args[1]))
          throw new Error('In-sheet scrolling requires scroll down, up or bottom');
        args.splice(args.indexOf('--in-sheet'), 1);
        if (args[1] === 'bottom') {
          // An Android tablet's form sheet leaves the screen behind it in the
          // tree, and native `scroll bottom` may measure that screen's list
          // while its swipe moves the sheet's: it then reports no progress.
          // Three flicks up the sheet's middle reach any sheet's bottom stop.
          if (env.DEVICE_KIND === 'android-tablet') {
            const nodes = await this.readySnapshot(true);
            const sheet = nodes
              .filter((node) => node.identifier?.endsWith('-sheet') && node.rect)
              .sort((a, b) => a.rect!.width * a.rect!.height - b.rect!.width * b.rect!.height)[0];
            if (!sheet?.rect) throw new Error('Missing sheet for in-sheet scroll');
            const x = Math.round(sheet.rect.x + sheet.rect.width / 2);
            const from = Math.round(sheet.rect.y + sheet.rect.height * 0.85);
            const dy = -Math.round(sheet.rect.height * 0.6);
            for (let pass = 0; pass < 3; pass++)
              await this.invoke([
                'gesture',
                'pan',
                String(x),
                String(from),
                '0',
                String(dy),
                '300',
              ]);
            continue;
          }
        } else if (env.DEVICE_KIND === 'ipad') {
          // A drag from the grabber's column inside the sheet. The native
          // scroll's press-then-drag does not reliably move a list in an iPad
          // form sheet. A whole-number amount is a pass count; a viewport
          // fraction (the amount other devices use) is one pass.
          const nodes = await this.readySnapshot(true);
          const grabber = sheetGrabber(nodes);
          if (!grabber?.rect) throw new Error('Missing iPad sheet grabber for in-sheet scroll');
          const viewport = appViewport(nodes);
          const x = Math.round(grabber.rect.x + grabber.rect.width / 2);
          const low = Math.round(Math.min(viewport.y + viewport.height - 80, grabber.rect.y + 395));
          const high = Math.round(grabber.rect.y + 90);
          const [from, dy] = args[1] === 'down' ? [low, high - low] : [high + 210, low - high];
          const amount = Number(args[2] ?? '1');
          const passes = Number.isInteger(amount) && amount >= 1 ? amount : 1;
          for (let pass = 0; pass < passes; pass++)
            await this.invoke(['gesture', 'pan', String(x), String(from), '0', String(dy), '400']);
          continue;
        }
      }
      // A launch reopens the window; every other step spends it down.
      this.stepsSinceLaunch = args[0] === 'open' ? 0 : this.stepsSinceLaunch + 1;
      let guardedNodes: Node[] | undefined;
      if (scopeId !== undefined) {
        const capture = await this.readyCapture(true);
        // One guarded capture supplies BOTH ancestry and generation. Never
        // retry a stale/rejected press or fall back to an ambiguous selector.
        await this.invoke(['press', scopedNativeRef(capture, args[1], scopeId)]);
        continue;
      }
      if (guardedMutations.has(args[0])) guardedNodes = await this.readySnapshot(true);
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
        // A Pad shows a work-surface sheet (Changes, Files, the session tree,
        // the catalogue, pairing) as a full-screen modal: no grabber, no
        // outside region, and iOS cannot swipe it away. Its way out is the
        // scene's own close button. Android's system back already pops it.
        const sheetClose =
          env.PLATFORM === 'ios'
            ? guardedNodes?.find((node) => node.identifier === 'sheet-close')
            : undefined;
        if (sheetClose) {
          await this.invoke(['press', selector(sheetClose)]);
          continue;
        }
        // Android exposes controls behind the catalogue and context sheets in its tree.
        // Its underlying "Go back" must not steal the sheet's Back action.
        if (
          guardedNodes?.some(
            (node) =>
              node.identifier === 'theme-browse-list' ||
              (env.PLATFORM === 'android' &&
                (node.identifier === 'theme-tab' ||
                  node.identifier === 'agent-context-sheet' ||
                  /^settings-(servers|appearance|terminal|alerts|storage|about)-sheet$/.test(
                    node.identifier ?? ''
                  ) ||
                  node.label === 'Quick action settings'))
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
        const grabber = guardedNodes && sheetGrabber(guardedNodes);
        if (grabber?.rect && guardedNodes) {
          const { x, y } = sheetDismissStart(guardedNodes, grabber);
          const viewport = appViewport(guardedNodes);
          const distance = Math.max(1, Math.min(500, viewport.y + viewport.height - y - 24));
          await this.invoke(['gesture', 'pan', String(x), String(y), '0', String(distance), '350']);
          continue;
        }
        const goBack = guardedNodes?.find(
          (node) => nodeRole(node) === 'button' && /^(?:go back|back)$/i.test(node.label ?? '')
        );
        if (goBack && !args.includes('--in-app')) {
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
            // A capture can stall after earlier trees were read, leaving no
            // stable verdict. Retry only this read once; prior capture count
            // does not prove stability. Ordinary UI instability still fails,
            // and a second stalled capture propagates without another retry.
            const detail = error instanceof NativeCommandError ? error.details : undefined;
            if (
              args[0] !== 'wait' ||
              args[1] !== 'stable' ||
              detail?.code !== 'COMMAND_FAILED' ||
              detail.details?.reason !== 'wait_stable_timeout' ||
              detail.details.captureStalled !== true
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
        if (step.mode !== 'scroll') {
          // Keep an explicitly requested text constraint when IDs are reused.
          const labelConstraint =
            target.id && target.text && node.label ? ` label=${JSON.stringify(node.label)}` : '';
          await this.runSection(step.run!, {
            ...env,
            TARGET: selector(node) + labelConstraint,
          });
        }
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

/** Explicit opt-in for this isolated QA device, never an automatic fill side effect. */
export async function restoreAndroidIme(
  config: { platform?: string; serial?: string; component?: string },
  adb: (args: string[]) => Promise<string>
) {
  const { platform, serial, component } = config;
  if (platform !== 'android' || serial !== 'emulator-5560')
    throw new Error('Real IME restoration is restricted to Android emulator-5560');
  if (
    !component ||
    !/^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(component) ||
    component.includes('agentdevice.imehelper')
  )
    throw new Error('Explicit installed real IME component is required');
  if ((await adb(['get-serialno'])).trim() !== serial)
    throw new Error('Real IME device serial mismatch');
  const avd = (await adb(['emu', 'avd', 'name'])).trim().split(/\r?\n/)[0];
  if (avd !== 'muqun_ui_clean_qa_20261015') throw new Error('Real IME AVD mismatch');
  const installed = (await adb(['shell', 'ime', 'list', '-s'])).trim().split(/\r?\n/);
  if (!installed.includes(component)) throw new Error('Configured real IME is not installed');
  await adb(['shell', 'ime', 'set', component]);
  if (
    (await adb(['shell', 'settings', 'get', 'secure', 'default_input_method'])).trim() !== component
  )
    throw new Error('Real IME selection was not observed');
  return { platform, serial, avd, action: 'restore-ime', component };
}

export function subprocess(binary: string, common: string[], log: string, cwd: string): Invoke {
  let sequence = 0;
  const record = async (name: string, value: unknown) =>
    writeFile(
      path.join(log, `${String(++sequence).padStart(4, '0')}-${name}.json`),
      JSON.stringify(value, null, 2)
    );
  const execute = async (
    command: string,
    commandArgs: string[],
    name: string,
    recordedArgs: string[]
  ) => {
    const result = await new Promise<{ stdout: string; stderr: string; status: number }>(
      (resolve, reject) => {
        const child = spawn(command, commandArgs, {
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
    await record(name, { command, args: recordedArgs, ...result });
    return result;
  };
  return async (args) => {
    if (args[0] === 'keyboard' && args[1] === 'restore-ime') {
      const flag = (name: string) => {
        const index = common.indexOf(name);
        return index < 0 ? undefined : common[index + 1];
      };
      try {
        if (args.length !== 2)
          throw new Error('restore-ime accepts no implicit device/component arguments');
        const serial = flag('--serial') ?? '';
        const data = await restoreAndroidIme(
          { platform: flag('--platform'), serial, component: process.env.E2E_ANDROID_REAL_IME },
          async (adbArgs) => {
            const fullArgs = ['-s', serial, ...adbArgs];
            const result = await execute('adb', fullArgs, 'adb', fullArgs);
            if (result.status !== 0)
              throw new Error(`Real IME adb command failed: ${adbArgs.join(' ')}`);
            return result.stdout;
          }
        );
        await record('keyboard', {
          args,
          status: 0,
          stderr: '',
          stdout: JSON.stringify({ success: true, data }),
        });
        return data;
      } catch (error) {
        await record('keyboard', {
          args,
          status: 1,
          stderr: String(error),
          stdout: JSON.stringify({ success: false }),
        });
        throw error;
      }
    }
    const result = await execute(binary, [...args, ...common, '--json'], args[0], args);
    return decodeReply(result.stdout, result.status);
  };
}
