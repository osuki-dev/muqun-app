# Terminal soft keyboard

## Interaction

The first row is one horizontally scrolling shortcut strip. It contains complete
combinations such as Shift Tab, Ctrl C, Alt with all four arrows, and the ordered
Esc Esc sequence. Contextual nvim actions, including leader sequences and write,
remain in that same row. Opening the keyboard removes duplicate bare Enter, Esc,
Tab, Backspace and arrow shortcuts because their actual keys are directly below.
The compact row outside the full keyboard keeps its existing contents.

The keyboard body has Esc, Tab, Ctrl, Alt and hide controls, three staggered QWERTY
rows, and Symbols, Space, four arrows and Return. Symbol pages cover terminal
ASCII punctuation with straight quotes. No emoji picker, language switch,
autocorrect, predictive text or clipboard auto-submit is introduced. The existing
composer remains the deliberate route for system input and reviewing pasted text.

Shift, Ctrl and Alt visibly arm the next key. Combinations also apply to Tab,
arrows and Space. Escape always sends Escape and clears armed modifiers. A
successful gesture consumes Ctrl and Alt; letter Shift is one-shot. The symbols
page selector remains active until changed. It has separate state from Shift:
More symbols selects punctuation and does not modify Tab or arrow keys. Choosing
Letters or Symbols explicitly releases one-shot Shift and resets the symbol page.
Named-key dispatch otherwise preserves every armed modifier, including
Ctrl+Shift+arrows and Ctrl+Alt+Shift+arrows; only the transport encoder collapses
legacy control-letter bytes. Unsupported control punctuation does
not fall back to inserting a character. Target changes remount the keyboard;
disconnection clears armed modifiers so they cannot leak to another terminal.

Stable QWERTY geometry uses ten letter-width units, centered home-row keys and
1.5-unit Shift/Backspace caps. Actual key height is 44 points; dead gaps are not
counted as accessible hit areas. Keys use native Pressable accessibility and
selected modifier states. Layout remains capped at 640 points on wide screens.

## Architecture and safety

`virtual-keyboard-input.ts` resolves a gesture into exact text or a validated key
name without dispatching. `VirtualKeyboard` owns transient UI state. Workspaces
own destinations and transport, preserving the existing raw terminal path.
`keyboardCombinationKeys` derives full-keyboard shortcuts without changing the
compact row or mutating gateway-provided actions. Ordered Esc Esc is represented
as two keys and delivered in one Gateway request / one SSH byte write, never as
an invented `esc+esc` key. Nvim text, leader spaces and explicit submit flags remain
unchanged. Applications on the host define what each shortcut does; no shortcut
is treated as approval or successful task completion.

No automatic repeat is added for commands, Return, interrupts or macros. A long
press must not become a burst of remote operations, and uncertain delivery is not
retried by the keyboard. Network delivery guarantees are owned by the transport.

## Validation

Pure tests cover all printable ASCII input, all control letters and their bytes,
modified navigation/Tab/Space, unsupported combinations, exact Esc ordering,
shortcut deduplication and unchanged nvim macro semantics. Geometry checks cover
row widths and actual key height. A registered native full-suite flow covers the
rendered keyboard and state transitions. Android device evidence and full-suite
results must be recorded before opening the implementation PR. iOS runtime
verification is deferred to the user's iOS environment and must not be claimed
from Android or pure tests.

## Android validation record

On 2026-09-14, the dedicated `muqun_collaboration_qa` Android emulator ran the
keyboard branch using its own Metro server on port 8086. The registered keyboard
flow passed inside the full suite, including one-shot modifier clearing,
Ctrl+Alt+Shift navigation, symbol pages and nvim actions in the same first row.
Native selected/checked attributes are omitted by agent-device 0.20.10's Android
normalization; exact visible/spoken checkmark labels establish UI state while the
component retains native togglebutton and checked accessibility semantics.

Direct SSH demo typing returned `you said: qwe`; Ctrl+C returned `^C`, and the next
plain letter returned `you said: q`. This proves the App's demo SSH byte consumer,
not a connection to a remote SSH server. Hide and reopen were also exercised.
The full run reported 15/18 passes: the theme catalogue loaded online when the
flow expected an offline empty state; Settings required a selected attribute the
automation tool omits; and SSH keyboard opening failed while a development warning
overlay was visible. A scoped overlay-dismissal guard was added; the focused SSH
flow then passed (1/1). The overall full-suite gate is not claimed green.

Extended tmux chords additionally require the Gateway key-translation correction
in Gateway PR #27. Its isolated tmux 3.7c byte capture passed for Alt arrows,
Ctrl+Shift arrows, triple modifiers, Ctrl+Space and control letters. Preserving
modifier names does not promise every terminal protocol distinguishes Ctrl+Shift
letters. No native dependency or new Gateway endpoint is introduced by this App PR.
