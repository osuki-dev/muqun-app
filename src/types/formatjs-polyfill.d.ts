// The `@formatjs/*` packages ship their `/polyfill-force` and `/locale-data/*`
// entry points as real files but do not declare them in `exports.types`, so
// TypeScript refuses a side-effect import of a module it cannot resolve.
//
// These are side-effect-only imports -- they install into the global `Intl` and
// export nothing -- so an empty declaration is the whole truth about them, not
// a stub hiding a real API.
declare module '@formatjs/intl-getcanonicallocales/polyfill-force';
declare module '@formatjs/intl-locale/polyfill-force';
declare module '@formatjs/intl-pluralrules/polyfill-force';
declare module '@formatjs/intl-pluralrules/locale-data/*';
