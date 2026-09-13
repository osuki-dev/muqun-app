# The theme contract: what v1 freezes, and how it is allowed to grow

`docs/custom-theme-design.md` describes what a theme _is_. This describes what
we may still change about it once packs exist that we did not write, and what we
must therefore decide before that day rather than after it.

The distinction matters because a published pack is a file on someone else's
disk. We can ship a new app to every reader; we cannot re-author their packs.
So every part of this format divides into three, and the third is the one that
costs money later:

- **Frozen** — changing it breaks packs that exist. Never change it.
- **Growable** — can gain members without breaking anything, in either
  direction. Safe to extend forever.
- **Retrofit-only-now** — cannot be added later without breaking something, so
  it is added before we open up or not at all.

## The defect this fixed, and why it had to be before opening up

Until this was written the schema was `strictObject` almost everywhere, which
meant **one unknown key rejected the whole manifest**. Measured on the shipped
CLI, not assumed:

```
$ muqun-theme validate .          # pack declares a slot a newer app added
decoration: Unrecognized key: "drawer.background"

$ muqun-theme validate .          # pack declares gallery metadata
$: Unrecognized keys: "description", "minAppVersion"
```

The pack is not degraded on an older app. It is refused, and the reader is told
their theme is invalid — which is both useless and untrue.

The consequence was worth stating plainly: **adding a single decoration slot or
material in a future release would have been a breaking change for every app
already installed.** `schemaVersion: z.literal(1)` closed the other door — a v2
pack was refused by a v1 app with the same unhelpful error.

`icons` is the exception and it is right. It is `z.record`, the app reads only
the names in `THEME_ICONS`, and an unknown glyph falls back to the built-in one.
Its docblock already argues the general case:

> "A name this build does not know" is therefore the same situation as "not
> supplied" [...] Rejecting the entire theme for it would make every new glyph a
> breaking change for everyone who has not updated yet.

That reasoning is correct and was applied to exactly one field. It applies
equally to decoration slots, materials, and the manifest root.

**The rule, now in force: strict where a typo is unambiguously a mistake with no
sensible fallback; open with a warning everywhere a pack can legitimately grow.**

| Field           | Was          | Now                             | Why                                                                                                                                                   |
| --------------- | ------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colors`        | strict       | **strict, unchanged**           | Every colour is required and the set is complete (proven below). There is no "partial colour" fallback, so an unknown key is a typo and nothing else. |
| `terminal`      | strict       | **strict, unchanged**           | Same.                                                                                                                                                 |
| `decoration`    | strict       | open + warn                     | A slot is already optional; an unknown one is indistinguishable from an absent one.                                                                   |
| `materials`     | strict       | open + warn                     | Same.                                                                                                                                                 |
| root            | strict       | open + warn                     | Otherwise no metadata can ever be added — see below.                                                                                                  |
| `icons`         | open         | unchanged                       | Already correct.                                                                                                                                      |
| `schemaVersion` | `literal(1)` | `int >= 1`, accept `<=` own max | So a newer pack fails with "this theme needs a newer Muqun", not "invalid".                                                                           |

`muqun-theme validate` reports every ignored key as a warning, so an author
still hears about a typo — as a warning, where it belongs, rather than as a
refusal that reaches their readers instead of them.

## What was added now, because it could not be added later

While the root was strict, no field could be added without breaking shipped
apps. Even with it open, anything a _reader's_ app must act on has to exist
before packs do, because an old app ignoring a field is only safe when ignoring
it is harmless. All four are in v1:

- **`minAppVersion`** — a pack had no way to say "I need a newer Muqun". Without
  it the only failure is a schema error that blames the author for the reader's
  old app. This is the field that makes every _other_ future change survivable,
  so it is the one to regret missing.
- **Gallery metadata: `description`, `tags`, `preview`** — the website gallery
  will need all three. Harmless for an app to ignore; impossible for a gallery
  to invent.

Nothing else is worth pre-building. Speculative fields age worse than absent
ones.

## Frozen in v1 — never change these

**The 17 colour names.** `background`, `surface`, `surfaceRaised`, `border`,
`borderStrong`, `text`, `textMuted`, `textSubtle`, `textDisabled`, `primary`,
`onPrimary`, `primarySubtle`, `danger`, `dangerSubtle`, `success`, `warning`,
`info`.

This set can be frozen with confidence because it is **provably complete**:
every `colors.*` the app reads is one of the 17 or is derived from them. The
richest consumer, `usePaneChatColors`, looks like it has its own palette and
does not — `muted`, `subtle`, `accent`, `bubble`, `added`, `removed`,
`status.*` are all computed from the 17 plus `terminal.ansi`:

```ts
muted: theme.colors.textMuted,
accent: theme.colors.primary,
bubble: withAlpha(theme.colors.primary, 0.16),
removed: terminal.ansi[1] ?? theme.colors.danger,
addedBackground: withAlpha(added, 0.14),
```

So there is no colour in this app that a pack cannot reach, and no reason to
expect an 18th. A new semantic colour should be derived from these, the way
every existing one is; adding a required key would invalidate every pack, and
adding an optional one splits the contract into "colours you can rely on" and
"colours you cannot", which is worse than deriving.

**The terminal field set.** `background`, `foreground`, `cursor`, `link`,
`selection`, and exactly 16 `ansi` entries, normal 0–7 then bright 8–15.

**Colour syntax.** `#RRGGBB`, with `#RRGGBBAA` only where the schema already
permits alpha (`primarySubtle`, `dangerSubtle`, `terminal.selection`). Text and
surfaces stay opaque; translucency is the reader's slider, not a colour.

**Asset addressing.** `assets/<name>.(png|jpg|jpeg|webp)`, package-relative,
never host-absolute; or a public HTTPS URL. Asset ids are the `identifier`
shape.

**Precedence.** colour base → shared slot → mode override → width override →
reader's decoration opt-out and readability protection. `undefined` inherits,
`null` removes.

**`homeIdentity`'s three modes.** `default` / `hidden` / `custom`, name and logo
independent, and a pack that says nothing gets nothing.

**Identity.** The manifest `id` is author-provided and untrusted. Installation
identity is local and content-hashed; a duplicate author id never silently
overwrites.

## Growable without a version bump

- **Decoration slots.** 10 today. New ones are additive once `decoration` is
  open; a pack that uses one an app does not know simply does not decorate
  there.
- **Icon names.** 3 today (`chrome.back`, `chrome.send`, `chrome.attach`). Already
  growable.
- **Materials.** `auto` / `solid` / `glass` over 4 surfaces.
- **`THEME_LIMITS`.** Raising a limit is always safe. **Lowering one is a
  breaking change** and belongs with a `schemaVersion` bump — worth writing down
  because a limit looks like a tuning knob and is not.

## What `schemaVersion: 2` would be for

Only for a change that cannot be expressed as an addition: removing or
renaming a frozen name, changing precedence, changing colour syntax, or
lowering a limit. Everything else is additive, and if the rule above is adopted,
additive changes never need it.

When it happens, a v1 app must say "this theme needs a newer Muqun" and name the
version. That is what `minAppVersion` and a non-literal `schemaVersion` buy, and
it is why both belong in v1.

## Remote assets

An `https` asset is a download at install time from a host we do not control.
Three properties are contract, not implementation: it is fetched once and owned
locally thereafter, never re-fetched behind the reader's back; `sha256` is
honoured when declared; and a pack whose remote asset is gone still installs
with that slot empty rather than failing wholesale. A gallery should prefer
self-contained `.muqun-theme` packages and treat URL assets as the exception —
they are the one part of a pack that can change meaning after publication.
