# Agent artwork

The OpenAI glyph used for the Codex entry is embedded in
`assets/glyphs/brand-codex.svg` and rendered by `src/components/codex-icon.tsx`
through the generated Nano font. Its path and 24 × 24 viewBox are unchanged from
[Simple Icons 14.15.0](https://github.com/simple-icons/simple-icons/blob/14.15.0/icons/openai.svg).
The [source metadata](https://github.com/simple-icons/simple-icons/blob/14.15.0/_data/simple-icons.json)
identifies [OpenAI's brand page](https://openai.com/brand) as the original source.
Simple Icons is distributed under [CC0-1.0](https://github.com/simple-icons/simple-icons/blob/14.15.0/LICENSE.md).

Only the glyph is drawn: the SVG has no background, and its fill uses the
surrounding agent entry's theme color. The OpenAI mark remains OpenAI's trademark;
it identifies the Codex agent, not Muqun's application icon or an endorsement.

The Pi coding agent mark comes from
[Simple Icons](https://github.com/simple-icons/simple-icons/blob/90646e4bf7f3b89df6c37e65baf3e7bc759a517c/icons/pi.svg),
whose metadata identifies [pi.dev's favicon](https://pi.dev/favicon.svg) as its
source. This is the coding agent formerly hosted at `badlogic/pi-mono`, now
`earendil-works/pi`. The Simple Icons drawing is CC0-1.0.

The fx mark is the `logo-fx` glyph path published in the official
[fx website](https://fx.sh/), retrieved on 2026-10-30. The static path is retained;
the website's hover shimmer is omitted. The Qoder mark comes from its official
[website favicon](https://qoder.com/favIcon.svg), linked by the homepage reached
from [Qoder's documentation](https://docs.qoder.com/), retrieved on the same date.
Its background plate is omitted and its viewBox is cropped around the mark.
Neither website states a separate artwork license; no license or trademark
grant is inferred from the fx repository's Apache-2.0 code license.

The Claude mark, used for Claude Code in both its terminal panes and its native
sessions, comes from [Simple Icons 16.36.0](https://github.com/simple-icons/simple-icons/blob/16.36.0/icons/claude.svg),
CC0-1.0; the path is unchanged. The mark remains Anthropic's trademark.

These marks identify their respective agents. Their trademark rights remain with
their owners, and their inclusion does not imply endorsement. Like the existing
Codex mark, all three inherit the surrounding entry's theme color and are
compiled into the local icon font; the app does not fetch brand assets at runtime.
