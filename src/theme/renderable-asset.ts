/**
 * Which image URIs a theme surface may draw.
 *
 * An installed theme's assets are files the import pipeline wrote under the
 * app's own directory, so the rule everywhere used to be "a `file:///` or
 * nothing": a manifest can never point a surface at an author URL or an
 * arbitrary path. The built-in default theme ships inside the binary instead,
 * and Metro's asset registry hands its files out as whatever the platform
 * loads them by -- a `file:///` inside the iOS app bundle, a bare drawable name
 * in an Android release build, a packager URL in development. Those exact
 * URIs, and only those, are registered here when the built-in theme loads,
 * so the rule stays "app-owned or nothing".
 */
const bundled = new Set<string>();

export function registerBundledThemeAssets(uris: Iterable<string>): void {
  for (const uri of uris) bundled.add(uri);
}

export function isRenderableThemeAsset(uri: string | null | undefined): uri is string {
  return typeof uri === 'string' && (uri.startsWith('file:///') || bundled.has(uri));
}
