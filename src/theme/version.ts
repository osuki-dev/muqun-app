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
  return aPre < bPre ? -1 : 1;
}

function split(version: string): [number[], string | undefined] {
  const [core, pre] = version.split('-', 2);
  return [core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre];
}
