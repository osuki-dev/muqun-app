/**
 * Orders two manifest `version` strings.
 *
 * The schema already holds them to `major.minor.patch` with an optional
 * pre-release tag, so this compares the three numbers and then treats a
 * pre-release as older than the release it precedes. Negative when `a` is
 * older, positive when newer, zero when the same.
 */
export function compareThemeVersions(a: string, b: string): number {
  const [aCore, aPre] = split(a);
  const [bCore, bPre] = split(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (aCore[index] ?? 0) - (bCore[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (aPre === bPre) return 0;
  if (aPre === undefined) return 1;
  if (bPre === undefined) return -1;
  return comparePreRelease(aPre, bPre);
}

/**
 * SemVer's pre-release order: dot-separated identifiers left to right, numbers
 * by value and before words, and a shorter list before a longer one it starts.
 */
function comparePreRelease(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const x = left[index]!;
    const y = right[index]!;
    if (x === y) continue;
    const xNumber = /^\d+$/.test(x);
    const yNumber = /^\d+$/.test(y);
    if (xNumber && yNumber) return Number(x) - Number(y);
    if (xNumber !== yNumber) return xNumber ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

function split(version: string): [number[], string | undefined] {
  const dash = version.indexOf('-');
  const core = dash < 0 ? version : version.slice(0, dash);
  const pre = dash < 0 ? undefined : version.slice(dash + 1);
  return [core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre];
}
