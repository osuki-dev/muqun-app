import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  NativeRunner,
  deviceFlags,
  junit,
  selectFlows,
  subprocess,
  tokenize,
  validateTarget,
  type Suite,
} from './e2e-native';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const which = (name: string) =>
  (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((directory: string) => path.join(directory, name))
    .find((file: string) => existsSync(file));
const base = path.join(root, 'e2e/agent-device');
const suite = JSON.parse(await readFile(path.join(base, 'suite.json'), 'utf8')) as Suite;
let tag = 'full';
let name: string | undefined;
let device = process.env.E2E_AD_DEVICE;
let platform = process.env.E2E_AD_PLATFORM;
let check = false;
let list = false;
let script: string | undefined;
const env: Record<string, string> = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const argument = args[i];
  const value = () => {
    const next = args[++i];
    if (!next || next.startsWith('--')) throw new Error(`${argument} requires a value`);
    return next;
  };
  switch (argument) {
    case '--smoke':
      tag = 'smoke';
      break;
    case '--full':
      tag = 'full';
      break;
    case '--tag':
      tag = value();
      break;
    case '--flow':
      name = value();
      break;
    case '--device':
      device = value();
      break;
    case '--platform':
      platform = value();
      break;
    case '--script':
      script = value();
      break;
    case '--check':
      check = true;
      break;
    case '--list':
      list = true;
      break;
    case '--test':
    case '--replay':
      break;
    case '--env': {
      const input = value();
      const separator = input.indexOf('=');
      if (separator < 1) throw new Error('--env requires NAME=value');
      env[input.slice(0, separator)] = input.slice(separator + 1);
      break;
    }
    case '--help':
    case '-h':
      console.log(
        'bash scripts/e2e.sh [--smoke|--full|--tag capture] [--flow name] [--device ID] [--platform ios|android] [--check|--list] [--env NAME=value]'
      );
      process.exit(0);
    default:
      throw new Error(`Unknown argument: ${argument}`);
  }
}

async function validate(): Promise<void> {
  if (suite.version !== 1) throw new Error('Unsupported suite manifest version');
  const names = new Set<string>();
  for (const flow of suite.flows) {
    if (names.has(flow.name)) throw new Error(`Duplicate flow: ${flow.name}`);
    names.add(flow.name);
    if (!suite.programs[flow.program]) throw new Error(`Missing flow program: ${flow.program}`);
  }
  for (const program of Object.values(suite.programs)) {
    const visit = async (steps: typeof program, stack: string[] = []): Promise<void> => {
      for (const step of steps) {
        if (step.target !== undefined) validateTarget(step.target);
        if (step.when?.target !== undefined) validateTarget(step.when.target);
        if (step.include) {
          if (stack.includes(step.include) || !suite.programs[step.include])
            throw new Error(`Invalid include: ${step.include}`);
          await visit(suite.programs[step.include], [...stack, step.include]);
        }
        if (step.steps) await visit(step.steps, stack);
        if (step.run) {
          const [file, section] = step.run.split('#');
          const contents = await readFile(path.join(base, file), 'utf8');
          if (section && !contents.split('\n').includes(`# section ${section}`))
            throw new Error(`Missing section: ${step.run}`);
          for (const line of contents.split('\n')) {
            if (!line.trim() || line.startsWith('#') || line.startsWith('context ')) continue;
            const command = tokenize(line)[0];
            if (
              ![
                'open',
                'wait',
                'press',
                'longpress',
                'fill',
                'type',
                'is',
                'scroll',
                'gesture',
                'screenshot',
                'snapshot',
                'keyboard',
                'back',
                'react-native',
                'close',
              ].includes(command)
            )
              throw new Error(`Unsupported native command: ${command}`);
          }
        }
      }
    };
    await visit(program);
  }
  console.log(`e2e: native syntax and manifest references valid (${suite.flows.length} flows)`);
}

await validate();
if (check) process.exit(0);
if (list) {
  for (const flow of suite.flows)
    console.log(
      `${flow.name}: ${flow.disabled ? `disabled (${flow.disabled})` : flow.tags.join(', ')} [${flow.platforms.join(', ')}]`
    );
  process.exit(0);
}
if (!device) {
  const candidates: { id: string; platform: string }[] = [];
  if (which('adb')) {
    const result = spawnSync('adb', ['devices']);
    if (result.status !== 0) throw new Error('Cannot enumerate Android devices');
    for (const line of result.stdout.toString().split('\n')) {
      const match = line.match(/^(\S+)\s+device$/);
      if (match) candidates.push({ id: match[1], platform: 'android' });
    }
  }
  if (which('xcrun')) {
    const result = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']);
    if (result.status !== 0) throw new Error('Cannot enumerate iOS simulators');
    const devices = JSON.parse(result.stdout.toString()).devices as Record<
      string,
      { udid: string; state: string }[]
    >;
    for (const entry of Object.values(devices).flat())
      if (entry.state === 'Booted') candidates.push({ id: entry.udid, platform: 'ios' });
  }
  const eligible = candidates.filter((candidate) => !platform || candidate.platform === platform);
  if (eligible.length !== 1)
    throw new Error('Choose one dedicated test device with --device and --platform');
  device = eligible[0].id;
  platform = eligible[0].platform;
}
platform ??= /^[0-9a-f-]{36}$/i.test(device) ? 'ios' : 'android';
if (!['ios', 'android'].includes(platform)) throw new Error('Platform must be ios or android');
// Device-derived branch input cannot be overridden by a user-supplied --env.
env.PLATFORM = platform;
const androidSerials: string[] = [];
if (platform === 'android' && which('adb')) {
  const devices = spawnSync('adb', ['devices']);
  if (devices.status !== 0) throw new Error('Cannot enumerate Android device serials');
  for (const line of devices.stdout.toString().split('\n')) {
    const match = line.match(/^(\S+)\s+device$/);
    if (match) androidSerials.push(match[1]);
  }
}
const binary = process.env.AGENT_DEVICE_BIN ?? which('agent-device');
if (!binary) throw new Error('Set AGENT_DEVICE_BIN to the installed agent-device executable');
const version = spawnSync(binary, ['--version']);
if (version.status !== 0 || version.stdout.toString().trim() !== '0.20.10')
  throw new Error(
    'This suite requires agent-device 0.20.10; review compatibility before changing the pin'
  );
if (script) {
  const relative = path.relative(base, path.resolve(root, script));
  if (relative.startsWith('..')) throw new Error('Native script must be under e2e/agent-device');
  name = path.basename(relative, '.ad');
  suite.flows.push({ name, program: 'single', tags: [], platforms: [platform] });
  suite.programs.single = [{ run: relative }];
}
const flows = selectFlows(suite, tag, platform, name);
if (!flows.length) throw new Error('No runnable flows selected');
const reportRoot = path.resolve(process.env.E2E_REPORT_DIR ?? path.join(root, 'dist/e2e-reports'));
const runDirectory = path.join(reportRoot, `${name ?? tag}-${Date.now()}`);
await mkdir(runDirectory, { recursive: true });
const results: { name: string; seconds: number; error?: string }[] = [];
for (const flow of flows) {
  const started = Date.now();
  const artifacts = path.join(runDirectory, flow.name);
  await mkdir(artifacts, { recursive: true });
  console.log(`e2e: ${flow.name} on ${platform}/${device}`);
  const invoke = subprocess(
    binary,
    [
      '--session',
      process.env.E2E_AD_SESSION ?? 'muqun-e2e',
      ...deviceFlags(platform, device, androidSerials),
    ],
    artifacts,
    root
  );
  const runner = new NativeRunner(suite, base, artifacts, invoke, {
    metroHost: process.env.E2E_AD_METRO_HOST,
    metroPort: process.env.E2E_AD_METRO_PORT,
    devClientUrl: process.env.E2E_DEV_CLIENT_URL,
    allowCameraDenial: flow.name === 'pairing-manual',
  });
  let failure: string | undefined;
  try {
    await runner.run(suite.programs[flow.program], env);
  } catch (error) {
    failure = String(error);
    console.error(`e2e: FAILED ${flow.name}: ${failure}`);
    await invoke(['screenshot', path.join(artifacts, 'failure.png')]).catch(() => undefined);
    await invoke(['snapshot']).catch(() => undefined);
  } finally {
    try {
      await invoke(['close']);
    } catch (error) {
      failure ??= `Session cleanup failed: ${String(error)}`;
    }
  }
  results.push({
    name: flow.name,
    seconds: (Date.now() - started) / 1000,
    ...(failure ? { error: failure } : {}),
  });
  await writeFile(path.join(reportRoot, `junit-${name ?? tag}.xml`), junit(results));
  await writeFile(path.join(runDirectory, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(
  `e2e: ${results.filter((result) => !result.error).length}/${results.length} passed. Evidence: ${runDirectory}`
);
if (results.some((result) => result.error)) process.exitCode = 1;
