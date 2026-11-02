import type { PermissionDecision, PermissionRequest } from './agent-session';

/**
 * The safety net under YOLO mode.
 *
 * YOLO auto-approves every permission request the engine raises, but it is not
 * a blank cheque: a small, deliberately conservative list of irreversibly
 * destructive shell commands is still answered with `deny` and reported. The
 * list targets whole-system damage — wiping filesystem roots, writing block
 * devices, formatting disks, fork bombs, making the root filesystem world-
 * writable, and piping a remote script into a shell. Everything else, including
 * awkward but recoverable commands, is left to the engine's own rules.
 *
 * The checks run on the scanner-produced resource strings the engine sends with
 * `shell` permission requests, which is why `sudo rm -rf /` classifies even
 * though only `rm -rf /` appears in the patterns: the wrapper is stripped first.
 */
const CRITICAL_ROOT_DIRS = new Set([
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/proc',
  '/root',
  '/sbin',
  '/sys',
  '/usr',
  '/var',
]);

/** Strip sudo/doas/env wrappers and normalise whitespace before matching. */
function scanCommand(raw: string): string {
  const stripped = raw
    .toLowerCase()
    .replace(/\b(sudo|doas|env)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped;
}

function classifyRm(target: string): string | undefined {
  const first = target.split(/\s+/)[0];
  if (!first) return undefined;
  if (/^--?no-preserve-root$/.test(first)) return 'rm-system-root';
  if (/^\$(?:home|\{home\})$/.test(first) || /^~(?:\/|$)/.test(first)) return 'rm-system-root';
  const rootPath = first.startsWith('/') ? first.replace(/\/$/, '') : null;
  if (rootPath === '' || first === '/*' || first.startsWith('/*')) return 'rm-system-root';
  if (rootPath && CRITICAL_ROOT_DIRS.has(rootPath)) return 'rm-system-root';
  return undefined;
}

export function dangerousShellReason(raw: string): string | undefined {
  const cmd = scanCommand(raw);

  // rm -rf (or rm -fr, rm -r -f …) aimed at a filesystem root or a
  // system-critical directory.
  const rm = cmd.match(/\brm\s+((?:-{1,2}[a-z0-9]+\s+)+)(.+)/);
  if (rm) {
    const flags = rm[1];
    if (/r/.test(flags) && /f/.test(flags)) {
      const reason = classifyRm(rm[2]);
      if (reason) return reason;
    }
  }

  // :(){ :|:& };: — the fork bomb.
  if (/:\(\)\s*\{[^;`]*:[|&][^;`]*\};/.test(cmd)) return 'fork-bomb';

  // Redirecting shell input into a block device ("cmd > /dev/sda").
  if (
    /(^|[\s;&|]|\d?>|>>)\s*\/dev\/(sd|hd|vd|fd)[a-z]|(^|[\s;&|]|\d?>|>>)\s*\/dev\/(mmcblk|nvme)[0-9]/i.test(
      raw
    )
  ) {
    return 'block-device-write';
  }

  // dd writing directly to a device.
  if (
    /\bdd\b[^|;&`]{0,160}\bof=\s*\/dev\/(sd|hd|vd|fd)[a-z]|(^|[\s;&|]|\d?>|>>)\s*\/dev\/(mmcblk|nvme)[0-9]/i.test(
      raw
    )
  ) {
    return 'block-device-write';
  }

  // mkfs / mkfs.ext4 … on a device.
  if (
    /\bmkfs(\.\w+)?\s+((-\S+\s+)+)?\/dev\/(sd|hd|vd|fd)[a-z]|(^|[\s;&|]|\d?>|>>)\s*\/dev\/(mmcblk|nvme)[0-9]/i.test(
      raw
    )
  ) {
    return 'disk-format';
  }

  // chmod that makes the root filesystem world-writable (or removes all
  // permission) — the path target must be the root itself, not every
  // command whose arguments happen to start with `/`.
  if (
    /\bchmod\b[^|;&`]{0,80}\b(777|000|a\+rwx|a\+wx|go\+w|ugo\+w|o\+w)\s+(\/\s*$|\/\*\s*$)/.test(raw)
  ) {
    return 'chmod-system-root';
  }

  // curl | sh / wget | sh / sh <(curl …): remote code fed to a shell.
  if (/\b(curl|wget)\b[^|;&`]{1,300}\|\s*(sudo\s+)?(ba)?sh(\s|$|;)/.test(raw)) {
    return 'remote-pipe-shell';
  }
  if (/\b(ba)?sh\s*<\s*\(\s*(curl|wget)\b/.test(raw)) {
    return 'remote-pipe-shell';
  }

  return undefined;
}

/** Whether a permission request must still be denied while YOLO is on. */
export function dangerousPermissionReason(request: PermissionRequest): string | undefined {
  if (request.action !== 'shell' && request.action !== 'bash') return undefined;
  for (const resource of request.resources) {
    const reason = dangerousShellReason(resource);
    if (reason) return reason;
  }
  return undefined;
}

export function isDangerousPermission(request: PermissionRequest): boolean {
  return dangerousPermissionReason(request) !== undefined;
}

/**
 * The operations YOLO answers by itself, in the words the gateway states them:
 * OpenCode's permission names, and the ACP tool kinds the gateway maps onto
 * them (`delete`, `move` and `search` have no OpenCode name of their own).
 *
 * These need no resource. A host asking "Edit a file?" without naming the
 * file is still asking to edit a file, and an ACP agent lists a file in
 * `locations` only when it has one -- requiring the path kept every such
 * request waiting for a tap with the switch on. A shell is different: its
 * command is what the safety scanner reads, so one without the command text
 * stays a tap.
 */
const FILE_OR_READ_ACTIONS: ReadonlySet<string> = new Set([
  'read',
  'edit',
  'write',
  'patch',
  'glob',
  'grep',
  'list',
  'delete',
  'move',
  'search',
  'webfetch',
  'websearch',
  'external_directory',
]);

/** Unknown operations, shells without a command and ambiguous choices stay for a human. */
export function yoloDecision(request: PermissionRequest): PermissionDecision | undefined {
  const shell = request.action === 'shell' || request.action === 'bash';
  if (!shell && !FILE_OR_READ_ACTIONS.has(request.action)) return undefined;
  if ((shell && !request.resources.length) || request.resources.some((value) => !value.trim()))
    return undefined;
  if (request.options.filter((option) => option.decision === 'allow').length !== 1)
    return undefined;
  const decision = dangerousPermissionReason(request) ? 'deny' : 'allow';
  return request.options.filter((option) => option.decision === decision).length === 1
    ? decision
    : undefined;
}
