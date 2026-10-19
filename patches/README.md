# Dependency patch notes

## @osuki-dev/ui 2.0.0-beta.3

The source-only icon patch removes the optional Lucide runtime loader and its
fallback lookup. Muqun supplies semantic Nano glyphs through `IconProvider`;
Kit's built-in controls are translated at `src/icons/kit-resolver.tsx`.
This keeps Metro from resolving an unused SVG peer. No generated library
output is patched. Remove the patch when Kit supports disabling its optional
Lucide lookup or ships a resolver-only icon implementation.
