import { cloneThemeData } from './clone';
import { contrastRatio } from './contrast';
import type { ThemeManifest } from './schema';

type Variant = ThemeManifest['variants']['light'];
export type OpacityIssue = { path: string; ratio: number; required: number };
type Pair = { path: string; ink: string; base: string; required: number; overlay?: string };

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
}

function luminance(channels: number[]): number {
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

/** Bound every alpha from floor through 1, not just one sample. Optional
 * semantic tints are painted over a normal surface; both paints use the global
 * alpha. Their channel polynomials can have interior extrema, included here.
 * Independent channel bounds are conservative when extrema differ by channel. */
function minimumContrast(pair: Pair, floor: number): number {
  const base = rgb(pair.base);
  const overlay = pair.overlay ? rgb(pair.overlay) : base;
  const tint = pair.overlay
    ? pair.overlay.length === 9
      ? Number.parseInt(pair.overlay.slice(7), 16) / 255
      : 1
    : 0;
  const low: number[] = [];
  const high: number[] = [];
  for (let channel = 0; channel < 3; channel++) {
    const bounds: number[] = [];
    for (const under of [0, 1]) {
      const b = base[channel] - under + tint * (overlay[channel] - under);
      const c = -tint * (base[channel] - under);
      const samples = [floor, 1];
      if (c !== 0) {
        const turning = -b / (2 * c);
        if (turning > floor && turning < 1) samples.push(turning);
      }
      bounds.push(...samples.map((alpha) => under + b * alpha + c * alpha * alpha));
    }
    low.push(Math.max(0, Math.min(...bounds)));
    high.push(Math.min(1, Math.max(...bounds)));
  }
  const ink = luminance(rgb(pair.ink));
  const closest = Math.max(luminance(low), Math.min(luminance(high), ink));
  return (Math.max(ink, closest) + 0.05) / (Math.min(ink, closest) + 0.05);
}

function policy(pairs: Pair[]) {
  const baselineIssues: OpacityIssue[] = pairs.flatMap((pair) => {
    const ratio = minimumContrast(pair, 1);
    return !Number.isFinite(ratio) || ratio < pair.required
      ? [{ path: pair.path, ratio, required: pair.required }]
      : [];
  });
  const explain = () =>
    pairs
      .map((pair) => ({ path: pair.path, required: pair.required, floor: pairFloor(pair) }))
      .sort((a, b) => b.floor - a.floor);
  // A theme with baseline failures needs this most of all, so it comes back on
  // both paths rather than only on the one that got as far as a search.
  if (baselineIssues.length) return { minimum: 1, baselineIssues, explain };
  const safe = (alpha: number) =>
    pairs.every((pair) => minimumContrast(pair, alpha) >= pair.required);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (safe(middle)) high = middle;
    else low = middle;
  }
  return {
    minimum: Math.min(1, Math.ceil(high * 100) / 100),
    baselineIssues,
    /**
     * The floor each pair would impose on its own, worst first.
     *
     * The group's floor is the highest of these, so this is the answer to the
     * question the number alone cannot answer: which colours to change. Computed
     * on demand rather than eagerly -- the policy cache is on the hot render
     * path and nothing there needs it.
     */
    explain,
  };
}

/** The lowest alpha at which one pair still meets its ratio. */
function pairFloor(pair: Pair): number {
  if (minimumContrast(pair, 1) < pair.required) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (minimumContrast(pair, middle) >= pair.required) high = middle;
    else low = middle;
  }
  return Math.min(1, Math.ceil(high * 100) / 100);
}

/** Declared label/chrome pairings only; disabled text, arbitrary terminal ANSI
 * combinations and content-supplied colors are not a universal contrast claim. */
function calculateThemeOpacityPolicy(variant: Variant) {
  const { colors, terminal } = variant;
  const surfaces = ['background', 'surface', 'surfaceRaised'] as const;
  const surfacePairs: Pair[] = [];
  for (const base of surfaces) {
    for (const ink of ['text', 'textMuted', 'textSubtle'] as const)
      surfacePairs.push({
        path: `colors.${ink}/${base}`,
        ink: colors[ink],
        base: colors[base],
        required: 4.5,
      });
    for (const ink of ['primary', 'danger', 'info', 'success', 'warning'] as const)
      surfacePairs.push({
        path: `colors.${ink}/${base}`,
        ink: colors[ink],
        base: colors[base],
        required: 3,
      });
    // Selected command labels and error chips use these authored tints over
    // their enclosing normal surface, not over an invented opaque tint.
    for (const [ink, overlay] of [
      ['primary', 'primarySubtle'],
      ['danger', 'dangerSubtle'],
    ] as const)
      surfacePairs.push({
        path: `colors.${ink}/${overlay}/${base}`,
        ink: colors[ink],
        base: colors[base],
        overlay: colors[overlay],
        required: 4.5,
      });
  }
  surfacePairs.push({
    path: 'colors.onPrimary/primary',
    ink: colors.onPrimary,
    base: colors.primary,
    required: 4.5,
  });
  const terminalPairs: Pair[] = (['foreground', 'link', 'cursor'] as const).map((key) => ({
    path: `terminal.${key}/background`,
    ink: terminal[key],
    base: terminal.background,
    required: key === 'cursor' ? 3 : 4.5,
  }));
  const ansiIssues: OpacityIssue[] = [];
  terminal.ansi.forEach((ink, index) => {
    const ratio = contrastRatio(ink, terminal.background);
    const path = `terminal.ansi.${index}/background`;
    if (ratio < 4.5) ansiIssues.push({ path, ratio, required: 4.5 });
    else terminalPairs.push({ path, ink, base: terminal.background, required: 4.5 });
  });
  return { surface: policy(surfacePairs), terminal: policy(terminalPairs), ansiIssues };
}

const policyCache = new Map<string, ReturnType<typeof calculateThemeOpacityPolicy>>();

/** Slider changes do not change color mathematics. Bound the shared cache so
 * repeated preview/compile renders reuse the proof without retaining packs. */
export function themeOpacityPolicy(variant: Variant) {
  const { terminal } = variant;
  const key = JSON.stringify([
    variant.colors,
    terminal.background,
    terminal.foreground,
    terminal.cursor,
    terminal.link,
    terminal.ansi,
  ]);
  const cached = policyCache.get(key);
  if (cached) return cached;
  const result = calculateThemeOpacityPolicy(variant);
  for (const group of [
    result.surface.baselineIssues,
    result.terminal.baselineIssues,
    result.ansiIssues,
  ]) {
    group.forEach(Object.freeze);
    Object.freeze(group);
  }
  Object.freeze(result.surface);
  Object.freeze(result.terminal);
  Object.freeze(result);
  if (policyCache.size >= 32) policyCache.delete(policyCache.keys().next().value!);
  policyCache.set(key, result);
  return result;
}

/** Shared slider controls both modes, so both use the same conservative floor.
 * Preserve omitted defaults and never change the author's original manifest. */
export function clampThemeOpacity(input: ThemeManifest): ThemeManifest {
  const manifest = cloneThemeData(input);
  const policies = [
    themeOpacityPolicy(manifest.variants.light),
    themeOpacityPolicy(manifest.variants.dark),
  ];
  const surface = Math.max(...policies.map((value) => value.surface.minimum));
  const terminal = Math.max(...policies.map((value) => value.terminal.minimum));
  for (const variant of Object.values(manifest.variants)) {
    if (variant.surfaces?.backgroundOpacity !== undefined)
      variant.surfaces.backgroundOpacity = Math.max(surface, variant.surfaces.backgroundOpacity);
    if (variant.terminal.backgroundOpacity !== undefined)
      variant.terminal.backgroundOpacity = Math.max(terminal, variant.terminal.backgroundOpacity);
  }
  return manifest;
}

/** Artwork above translucent paint consumes the same contrast budget. Compute
 * opaqueMaximum with requested=1; never reuse an already-clamped art request. */
export function jointArtworkOpacity(
  opaqueMaximum: number,
  baseAlpha: number,
  requested = 1
): number {
  if (![opaqueMaximum, baseAlpha, requested].every(Number.isFinite) || baseAlpha <= 0) return 0;
  const maximum = Math.max(0, Math.min(1, opaqueMaximum));
  const base = Math.min(1, baseAlpha);
  return Math.min(Math.max(0, Math.min(1, requested)), Math.max(0, 1 - (1 - maximum) / base));
}
