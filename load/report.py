#!/usr/bin/env python3
"""Prints a compact table for one or more load result directories."""
import json, sys

def fmt(v, d=1):
    return "-" if v is None else f"{v:.{d}f}"

for path in sys.argv[1:]:
    print(path)
    print(f"{'rate':>5} {'achieved':>9} {'p50':>7} {'p95':>8} {'p99':>8} {'max':>8} | {'srv p95':>7} {'srv p99':>7} | {'hot95':>7} {'cold95':>8} | {'drop':>6} {'unexp':>5} | {'served':>7} {'stored':>7} drain | cpu% avg (redirect/worker/postgres/valkey/k6)")
    for line in open(f"{path}/summary.jsonl"):
        d = json.loads(line)
        s = d.get("server_side_ms") or {}
        c = d["cpu_avg"]
        print(f"{d['rate']:>5} {fmt(d['achieved']):>9} {fmt(d['p50'],2):>7} {fmt(d['p95']):>8} {fmt(d['p99']):>8} {fmt(d['max'],0):>8} | {fmt(s.get('p95')):>7} {fmt(s.get('p99')):>7} | {fmt(d['hot95']):>7} {fmt(d['cold95']):>8} | {d['dropped']:>6} {fmt(d['unexpected'],3):>5} | {d['served_302']:>7} {d['events_stored']:>7} {d['drain_seconds']:>4}s | " + "/".join(f"{c.get(k, 0):.0f}" for k in ("redirect", "worker", "postgres", "valkey", "k6")))
