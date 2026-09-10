import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type Target = { text?: string; id?: string; selected?: boolean; checked?: boolean };

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
};
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
  constructor(readonly details: { code?: string; details?: Record<string, unknown> }) {
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
  // Match agent-device 0.20.10's semantic type normalization, not raw AX or
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

export class NativeRunner {
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

  async readySnapshot(): Promise<Node[]> {
    let capture = await this.readCapture();
    let nodes = snapshotNodes(capture);
    if (capture.androidSnapshot) {
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
    }
    if (!hasAlert(nodes)) return nodes;
    const deny = notificationDenyButton(nodes, this.runtime.allowCameraDenial);
    if (!deny)
      throw new Error(
        'Unexpected system alert blocks the test; inspect the saved snapshot before continuing'
      );
    // Only the app's notification request is an automatic setup action. The
    // device language may differ from the app language. Never press or swipe
    // app controls underneath a native alert, even if they remain in its tree.
    await this.invoke(['press', selector(deny)]);
    await this.invoke(['wait', 'stable', '300', '5000']);
    nodes = snapshotNodes(await this.readCapture());
    if (hasAlert(nodes)) throw new Error('Notification permission alert did not dismiss');
    return nodes;
  }

  private async readCapture(): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      const capture = await this.invoke(['snapshot']);
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
      if (guardedMutations.has(args[0])) await this.readySnapshot();
      let result: Record<string, unknown>;
      try {
        result = await this.invoke(args);
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
