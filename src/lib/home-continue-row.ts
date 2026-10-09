/**
 * What one Continue row says: a title and a single meta line,
 * `<kind> · <computer> · <path> · <status> · <seen>`.
 *
 * Pure, so the wording rules are pinned by Bun tests; `home-recent-sessions.tsx`
 * and `home-attention.tsx` are the views.
 */

import type { GatewayRecord } from './gateway-storage';
import { isCommandPathTitle, isLaunchCommandTitle } from './herdr-entity';

/** The ellipsis a shortened path carries where its middle was. */
export const PATH_ELLIPSIS = '…';

/** A shortened path keeps at least this much, even when the rest of the line is long. */
const MIN_PATH_CHARS = 12;

/** Used until the list has been measured. */
export const DEFAULT_META_CHARS = 44;

/** A caption glyph is about this much of its font size wide, on average. */
const CAPTION_ADVANCE = 0.58;

/**
 * A path as the reader would spell it: `~` for a home directory, no trailing
 * slash. The app does not know the gateway's `$HOME`, so the common home roots
 * (`/home/<user>`, `/Users/<user>`, `/root`) stand in for it.
 */
export function homePathLabel(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  const clean = trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed;
  const home = /^(?:\/home\/[^/]+|\/Users\/[^/]+|\/root)(?=\/|$)/.exec(clean);
  return home ? `~${clean.slice(home[0].length)}` : clean;
}

/**
 * Shorten a path from the middle so its tail -- the part that tells two
 * projects apart -- survives: `~/…/work/muqun/app`. Cut at a `/` when one
 * fits; a single last segment longer than the budget keeps its own end.
 */
export function middleTruncatePath(path: string, maxChars: number): string {
  const max = Math.max(1, Math.floor(maxChars));
  if (path.length <= max) return path;
  const head = path.startsWith('~/') ? '~/' : path.startsWith('/') ? '/' : '';
  const room = max - head.length - PATH_ELLIPSIS.length;
  if (room > 0) {
    const tail = path.slice(path.length - room);
    const cut = tail.indexOf('/');
    // `cut + 1 < tail.length`: a boundary that would leave nothing is no boundary.
    if (cut >= 0 && cut + 1 < tail.length) return `${head}${PATH_ELLIPSIS}${tail.slice(cut)}`;
  }
  return `${PATH_ELLIPSIS}${path.slice(path.length - (max - PATH_ELLIPSIS.length))}`;
}

function lastSegment(path: string): string {
  if (path === '/' || path === '~') return path;
  const parts = path.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : path;
}

const SHELL_PROMPT = /^[^\s@:]+@[^\s:]+:\s*/;

function isPathLike(value: string): boolean {
  return value === '~' || value.startsWith('~/') || value.startsWith('/');
}

/**
 * A terminal row's title: the folder the pane is in. A shell names its pane
 * after its prompt (`user@host:~/…/proj`), which is noisy, leaks the host and
 * the whole path, and wraps; the folder is what the reader recognises.
 *
 * A pane an agent runs in keeps its own title when that title is not a prompt
 * or a path -- it is usually the agent's task. Otherwise it is named by the
 * agent (`Codex`), never by the binary's path the terminal put there
 * (`'/opt/homebrew/bin/codex'`). With no cwd, the title has its `user@host:`
 * prefix removed, and a path left behind gives its last folder.
 */
export function terminalRowTitle(input: {
  paneTitle: string;
  cwd?: string;
  hasAgent?: boolean;
  /** The agent's display name, for a pane whose own title says nothing. */
  agentName?: string;
}): string {
  const raw = input.paneTitle.trim();
  const prompt = SHELL_PROMPT.test(raw);
  const stripped = raw.replace(SHELL_PROMPT, '').trim();
  if (input.hasAgent) {
    if (
      stripped &&
      !prompt &&
      !isPathLike(stripped) &&
      !isCommandPathTitle(stripped) &&
      !isLaunchCommandTitle(stripped)
    ) {
      return stripped;
    }
    const name = input.agentName?.trim();
    if (name) return name;
  }
  const cwd = input.cwd ? homePathLabel(input.cwd) : '';
  if (cwd) return lastSegment(cwd);
  return isPathLike(stripped) ? lastSegment(stripped) : stripped;
}

/**
 * The path a terminal row's meta line shows, or nothing when the title has
 * already said it (the pane sits right in `~`, `/`, or one folder under them).
 */
export function terminalRowPath(title: string, cwd: string | undefined): string | undefined {
  const path = cwd ? homePathLabel(cwd) : '';
  if (!path) return undefined;
  if (path === title || path === `~/${title}` || path === `/${title}`) return undefined;
  return path;
}

/** The computer a row belongs to: always the paired record's own label. */
export function homeContinueComputerLabel(
  servers: readonly Pick<GatewayRecord, 'serverId' | 'label'>[],
  serverId: string | undefined
): string | undefined {
  if (!serverId) return undefined;
  const label = servers.find((server) => server.serverId === serverId)?.label.trim();
  return label || undefined;
}

export type HomeContinueMetaRole = 'kind' | 'computer' | 'path' | 'status' | 'seen';
export type HomeContinueMetaPart = { role: HomeContinueMetaRole; text: string };

export const META_SEPARATOR = ' · ';

/**
 * The meta line's parts, in order, with empty ones dropped and the path
 * shortened from the middle to what the rest of the line leaves of `maxChars`.
 */
export function homeContinueMetaParts(input: {
  kind: string;
  computer?: string;
  path?: string;
  status?: string;
  seen?: string;
  maxChars?: number;
}): HomeContinueMetaPart[] {
  const parts: HomeContinueMetaPart[] = [];
  const push = (role: HomeContinueMetaRole, text: string | undefined) => {
    const value = text?.trim();
    if (value) parts.push({ role, text: value });
  };
  push('kind', input.kind);
  push('computer', input.computer);
  push('path', input.path);
  push('status', input.status);
  push('seen', input.seen);
  const path = parts.find((part) => part.role === 'path');
  if (path) {
    const others = parts
      .filter((part) => part !== path)
      .reduce((sum, part) => sum + part.text.length, 0);
    const separators = (parts.length - 1) * META_SEPARATOR.length;
    const budget = Math.max(
      MIN_PATH_CHARS,
      (input.maxChars ?? DEFAULT_META_CHARS) - others - separators
    );
    path.text = middleTruncatePath(path.text, budget);
  }
  return parts;
}

/** How many caption characters fit across `width` points. */
export function homeContinueMetaChars(width: number, captionFontSize: number): number {
  if (!(width > 0) || !(captionFontSize > 0)) return DEFAULT_META_CHARS;
  return Math.max(MIN_PATH_CHARS, Math.floor(width / (captionFontSize * CAPTION_ADVANCE)));
}
