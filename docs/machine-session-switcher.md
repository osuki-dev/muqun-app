# Machine and session switching

The terminal header has one entry for paired machines and their live backend
sessions. One paired machine with zero or one live session has no switch
button; adding and managing machines remains available through existing Home
and Settings surfaces

The sheet groups sessions beneath machine names. It does not poll every saved
machine: tapping another machine loads its sessions through that record's own
encrypted transport or SSH tunnel, leaving the current terminal selected until
the request succeeds. A first visit with multiple sessions asks for a choice;
a returning visit can open the remembered session directly

Closing while a session request is pending discards its result. Failed reads
stay in the sheet with an inline retry message. Session IDs and remembered pane
IDs are scoped to the gateway, never shared across machines. Session preference
is persisted; pane return locations are kept for the current App launch

New gateways expose `connected` on `/api/sessions`. Older gateways are supported
using their per-session `/health` data. Stopped backends remain configured but
are not offered as switch targets. A reachable backend with no panes is still
a valid target. All-stopped configurations retain a configured session for the
existing unavailable-backend presentation rather than inventing a session ID

Saved Herdr SSH machines are not automatically imported: that requires remote
routing support in the gateway, not just a Herdr version check

Validation uses fake session responses and the isolated offline demo, never
the user's pairing credentials or terminal URLs
