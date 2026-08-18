export const MINIMUM_HERDR_VERSION = '0.7.5';

type HerdrCompatibility = {
  connected?: boolean;
  version?: string;
  protocol?: number;
  compatible?: boolean;
  supportedProtocolMin?: number;
  supportedProtocolMax?: number | null;
};

type HerdrCompatibilityHealth = {
  herdr?: HerdrCompatibility;
};

function describeHerdr(herdr: HerdrCompatibility): string {
  const version = herdr.version ? `Herdr ${herdr.version}` : 'the Herdr on this server';
  return typeof herdr.protocol === 'number'
    ? `${version} (protocol ${herdr.protocol})`
    : version;
}

/**
 * Explain a refusal the gateway has already decided on.
 *
 * Which side is behind decides what the user should actually do, and the two
 * cases point opposite ways. Below the gateway's floor, Herdr is the old one.
 * Above its ceiling, Herdr is fine and the gateway is the one that needs
 * updating -- telling the user to update Herdr there sends them to upgrade the
 * thing they just upgraded.
 */
function explainIncompatibility(herdr: HerdrCompatibility): string {
  const running = describeHerdr(herdr);
  const { protocol, supportedProtocolMin: min, supportedProtocolMax: max } = herdr;

  if (typeof protocol === 'number' && typeof min === 'number' && protocol < min) {
    return `${running} is older than Muqun Gateway supports (protocol ${min} or newer). `
      + 'Update Herdr and restart the session.';
  }
  if (typeof protocol === 'number' && typeof max === 'number' && protocol > max) {
    return `${running} is newer than Muqun Gateway supports (up to protocol ${max}). `
      + 'Herdr is fine -- update Muqun Gateway on the server and restart it.';
  }
  return `Muqun Gateway reports it cannot speak to ${running}. `
    + 'Update Muqun Gateway on the server and restart it.';
}

/**
 * Refuse a backend the gateway itself has refused.
 *
 * The gateway is the only side that knows which Herdr protocols it can speak,
 * so it decides and this reports. The app used to re-derive the verdict by
 * comparing the protocol number against a constant of its own, which meant a
 * Herdr release the gateway served perfectly well still could not be reached:
 * Herdr's protocol number versions its TUI wire format, not the JSON API the
 * gateway consumes, so it moves for reasons neither side cares about. Failing
 * here at all is still worth it -- it keeps a genuinely unusable server from
 * looking connected and then producing unrelated errors from every workspace,
 * pane, and event request that follows.
 */
export function assertSupportedHerdr(health: HerdrCompatibilityHealth): void {
  const herdr = health.herdr;
  if (!herdr?.connected) {
    throw new Error(`Start Herdr ${MINIMUM_HERDR_VERSION} or newer, then try again.`);
  }
  // Only an explicit `false` is a refusal. A gateway old enough to omit the
  // field has still told us it connected, and that is the only verdict it has;
  // treating absent as incompatible would break every older gateway.
  if (herdr.compatible === false) {
    throw new Error(explainIncompatibility(herdr));
  }
}
