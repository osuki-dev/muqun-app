#!/usr/bin/env python3
"""Load generator for `scripts/terminal-soak.ts`. Run it *in the soak's own pane*.

Impersonates the pane shape every bug on card #721 was measured against: a
full-screen program on the alternate screen that keeps a transcript scrolling
above an eight-row composer pinned to the bottom, with a mode-line timer that
changes on every single frame whether or not anything scrolled. Herdr reports
`max_offset_from_bottom: 0` for a pane like this, which is what makes it the
interesting case -- there is no scrollback to page, so the window the reader
holds is built entirely out of what arrived.

Every transcript row is stamped `«000123»`. That stamp is the whole point: it
gives the soak ground truth against a live pane. A window whose stamps are not
strictly increasing has reordered or duplicated something, and the harness can
say so without needing to have watched every frame itself.

The rate varies deliberately, including bursts far wider than one screen: below
about nineteen rows between reads an aligned overlap places, and above it
nothing scores, which is exactly where the duplication used to start.
"""
import random
import sys
import time

VIEWPORT = 65
COMPOSER = 8
BODY = VIEWPORT - COMPOSER

WORDS = [
    "reading src/terminal/history.ts", "Bash(git status --porcelain)",
    "the placement anchors on the run from the read's own head",
    "⎿  === branch ===", "     ## main...origin/main", "     ?? .claude/worktrees/",
    "… +10 lines (ctrl+o to expand)", "⎿  Allowed by auto mode classifier",
    "Update(src/app/servers/[serverId].tsx)", "⎿  Wrote 41 lines",
    "分析 react-native-runtimes 项目的适用性", "測定した結果はこうなりました",
    "thinking about whether the ring should come back on",
]


def transcript_row(index: int) -> str:
    return f"«{index:06d}» {random.choice(WORDS)}"


def composer(tick: int) -> list[str]:
    return [
        "─" * 78,
        "❯ ",
        "─" * 78,
        "  ⏵⏵ accept edits on",
        "  ✻ agent: sonnet · muqun-soak-721",
        "",
        f"  {tick // 60}m {tick % 60}s · ↓ {tick * 37 % 9000} tokens",
        "",
    ]


def main() -> None:
    out = sys.stdout
    out.write("\x1b[?1049h")  # alternate screen: no scrollback, like an agent
    next_row = 0
    tick = 0
    body: list[str] = []
    started = time.monotonic()
    try:
        while True:
            tick += 1
            # A mix of quiet frames, ordinary scrolling and bursts wider than a
            # screen -- the last of which is where every placement gave up.
            roll = random.random()
            if roll < 0.35:
                grew = 0
            elif roll < 0.85:
                grew = random.randint(1, 18)
            elif roll < 0.97:
                grew = random.randint(19, 60)
            else:
                grew = random.randint(61, 400)
            for _ in range(grew):
                body.append(transcript_row(next_row))
                next_row += 1
            body = body[-BODY:]

            out.write("\x1b[H\x1b[2J")
            frame = body + [""] * max(0, BODY - len(body)) + composer(tick)
            out.write("\r\n".join(frame[:VIEWPORT]))
            out.flush()
            time.sleep(random.uniform(0.08, 0.5))
            if time.monotonic() - started > 60 * 60 * 6:
                break
    except KeyboardInterrupt:
        pass
    finally:
        out.write("\x1b[?1049l")
        out.flush()


if __name__ == "__main__":
    main()
