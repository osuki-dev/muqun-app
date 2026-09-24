#!/usr/bin/env python3
"""Summarise a converted release-profiler trace (Chrome trace JSON).

    python3 scripts/perf/analyze-profile.py <trace.json> [--top 25]

`react-native-release-profiler --local/--fromDownload` writes the Hermes
sampling profile as nested B/E events per thread. This rebuilds the stacks and
prints, per thread: the sampled wall time, the functions with the most self
time, the app source files with the most self time, and the app functions with
the most inclusive time (so a cheap component that renders an expensive
subtree still shows up).
"""

import argparse
import collections
import json


def label(event):
    args = event.get("args") or {}
    url = args.get("url") or ""
    line = args.get("line")
    where = f"{url}:{line}" if url else ""
    return event.get("name", "?"), where


def is_app(where):
    return where.startswith("/src/") or "/src/" in where and "node_modules" not in where


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("trace")
    parser.add_argument("--top", type=int, default=25)
    options = parser.parse_args()

    raw = json.load(open(options.trace))
    events = raw["traceEvents"] if isinstance(raw, dict) else raw
    by_thread = collections.defaultdict(list)
    for event in events:
        if event.get("ph") in ("B", "E"):
            by_thread[event["tid"]].append(event)

    for tid, thread_events in by_thread.items():
        thread_events.sort(key=lambda e: e["ts"])
        stack = []
        self_time = collections.Counter()
        file_self = collections.Counter()
        inclusive = collections.Counter()
        total = 0.0
        for event in thread_events:
            if event["ph"] == "B":
                stack.append([event, event["ts"], 0.0])
                continue
            if not stack:
                continue
            begin, start, children = stack.pop()
            duration = event["ts"] - start
            own = max(duration - children, 0.0)
            name, where = label(begin)
            key = f"{name}  {where}"
            self_time[key] += own
            if where:
                file_self[where.rsplit(":", 1)[0]] += own
            # Inclusive time for app functions, counted once per nested run.
            if is_app(where) and not any(label(frame[0]) == (name, where) for frame in stack):
                inclusive[key] += duration
            if stack:
                stack[-1][2] += duration
            if name != "[root]":
                total += own

        ms = lambda us: us / 1000.0
        print(f"\n=== thread {tid}: {ms(total):.0f} ms of sampled JS work")
        print(f"\n-- top self time")
        for key, value in self_time.most_common(options.top):
            if key.startswith("[root]"):
                continue
            print(f"{ms(value):9.1f} ms  {key}")
        print(f"\n-- top files by self time")
        for key, value in file_self.most_common(options.top):
            print(f"{ms(value):9.1f} ms  {key}")
        print(f"\n-- app functions by inclusive time")
        for key, value in inclusive.most_common(options.top):
            print(f"{ms(value):9.1f} ms  {key}")


if __name__ == "__main__":
    main()
