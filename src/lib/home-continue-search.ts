import type { HomeContinueEntry } from './home-continue';
import { homeContinueKind, homeContinueTarget, visibleHomeContinueEntries } from './home-continue';
import { agentDisplayName } from './home-launch-model';
import type { MirroredServerDiscovery } from './agent-discovery';
import { findAgent } from './agent-discovery';
import { agentMarkKind } from './agent-mark-kind';
import { contrastRatio } from '@/theme/contrast';

export function homeContinueSearchEnabled(count: number): boolean {
  return count > 15;
}

/** Search inventory before collapse, retaining its visit ranking and destination objects. */
export function searchedHomeContinueEntries(
  entries: readonly HomeContinueEntry[],
  query: string,
  expanded: boolean,
  limit: number | undefined,
  discovery: Readonly<Record<string, MirroredServerDiscovery | undefined>> = {},
  serverLabels: Readonly<Record<string, string>> = {}
): readonly HomeContinueEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    const visible = visibleHomeContinueEntries(entries, expanded);
    return limit !== undefined && !expanded ? visible.slice(0, limit) : visible;
  }
  return entries.filter((entry) => {
    const target = homeContinueTarget(entry.destination);
    const rowKind = homeContinueKind(entry.destination);
    const serverId =
      entry.destination.type === 'pane'
        ? entry.destination.serverId
        : target?.kind !== 'ssh-host'
          ? target?.serverId
          : undefined;
    const agents = serverId ? discovery[serverId]?.agents?.agents : undefined;
    const agentId = rowKind.kind === 'agent' ? rowKind.agentId : undefined;
    const directory =
      entry.destination.type === 'pane'
        ? entry.destination.cwd
        : target?.kind === 'agent-session'
          ? target.directory
          : undefined;
    const metadata = [
      entry.title,
      directory,
      entry.agentLabel,
      rowKind.kind,
      serverId ? serverLabels[serverId] : undefined,
      agentId,
      agentId ? agentDisplayName(agents, agentId) : undefined,
      agentId ? findAgent(agents, agentId)?.kind : undefined,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((word) => metadata.includes(word));
  });
}

type ProviderPalette = {
  primary: string;
  info: string;
  success: string;
  text: string;
  textMuted: string;
  /** Underlay for the selected row's translucent primarySubtle fill. */
  surface?: string;
};

/** Only provider text uses these theme inks; marks, titles and status keep their own roles. */
export function homeProviderTextColor(
  kind: string,
  colors: ProviderPalette,
  surface: string
): string {
  const brand = agentMarkKind(kind.trim().toLowerCase().split(/\s+/)[0]);
  if (!brand) return colors.textMuted;
  const authored = { opencode: colors.primary, deepseek: colors.info, t3: colors.success };
  const contrastSurface = providerContrastSurface(surface, colors.surface);
  // Authored theme inks are opaque #RRGGBB (themeColorsSchema). A runtime token
  // outside that contract must remain untouched, not become a half-parsed color.
  if (
    !contrastSurface ||
    ![...Object.values(authored), colors.text].every((color) => /^#[0-9a-f]{6}$/i.test(color))
  )
    return authored[brand];
  const adjusted = {
    opencode: readableProviderInk(authored.opencode, colors.text, contrastSurface),
    deepseek: readableProviderInk(authored.deepseek, colors.text, contrastSurface),
    t3: readableProviderInk(authored.t3, colors.text, contrastSurface),
  };
  if (
    distinctProviderInks(adjusted) &&
    Object.values(adjusted).every((ink) => contrastRatio(ink, contrastSurface) >= 4.5)
  )
    return adjusted[brand];

  // Installed palettes may assign the same ink to every semantic role, or the
  // contrast correction may converge on one ink. Resolve the three together,
  // using stable orange/blue/green hues rather than depending on call order.
  const anchor =
    contrastRatio('#000000', contrastSurface) >= contrastRatio('#ffffff', contrastSurface)
      ? '#000000'
      : '#ffffff';
  const fallback = {
    opencode: readableProviderInk('#c2410c', anchor, contrastSurface),
    deepseek: readableProviderInk('#2563eb', anchor, contrastSurface),
    t3: readableProviderInk('#16a34a', anchor, contrastSurface),
  };
  if (distinctProviderInks(fallback)) return fallback[brand];
  // On a mid-luminance surface only inks close to black or white can meet 4.5.
  // These three minimal hue tints retain uniqueness even at that boundary.
  const boundary =
    anchor === '#000000'
      ? { opencode: '#010000', deepseek: '#000001', t3: '#000100' }
      : { opencode: '#fffffe', deepseek: '#feffff', t3: '#fffeff' };
  return boundary[brand];
}

/** Installed fills use hex alpha; built-in primarySubtle tokens also use rgba(). */
function providerContrastSurface(fill: string, behind: string | undefined): string | undefined {
  if (/^#[0-9a-f]{6}$/i.test(fill)) return fill;
  if (!behind || !/^#[0-9a-f]{6}$/i.test(behind)) return undefined;
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(fill);
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(fill);
  if (!hex && !rgba) return undefined;
  const front = hex
    ? [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16))
    : [Number(rgba?.[1]), Number(rgba?.[2]), Number(rgba?.[3])];
  const alpha = hex ? Number.parseInt(hex[2], 16) / 255 : Number(rgba?.[4]);
  if (
    !Number.isFinite(alpha) ||
    alpha < 0 ||
    alpha > 1 ||
    front.some((channel) => channel < 0 || channel > 255)
  )
    return undefined;
  return (
    '#' +
    front
      .map((channel, index) =>
        Math.round(
          channel * alpha +
            Number.parseInt(behind.slice(1 + index * 2, 3 + index * 2), 16) * (1 - alpha)
        )
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

function distinctProviderInks(inks: Record<string, string>): boolean {
  return new Set(Object.values(inks).map((ink) => ink.toLowerCase())).size === 3;
}

function readableProviderInk(ink: string, text: string, surface: string): string {
  if (contrastRatio(ink, surface) >= 4.5) return ink;
  // Fine steps preserve hue near the contrast boundary instead of snapping to text.
  for (let step = 1; step <= 100; step++) {
    const weight = step / 100;
    const mixed =
      '#' +
      [1, 3, 5]
        .map((offset) =>
          Math.round(
            Number.parseInt(ink.slice(offset, offset + 2), 16) * (1 - weight) +
              Number.parseInt(text.slice(offset, offset + 2), 16) * weight
          )
            .toString(16)
            .padStart(2, '0')
        )
        .join('');
    if (contrastRatio(mixed, surface) >= 4.5) return mixed;
  }
  return text;
}
