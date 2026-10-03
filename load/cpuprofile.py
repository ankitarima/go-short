#!/usr/bin/env python3
"""Top self-time functions from a V8 .cpuprofile (written by `node --cpu-prof`)."""
import collections, json, sys

p = json.load(open(sys.argv[1]))
top = int(sys.argv[2]) if len(sys.argv) > 2 else 25
nodes = {n["id"]: n for n in p["nodes"]}
self_us = collections.Counter()
for sid, dt in zip(p["samples"], p["timeDeltas"]):
    self_us[sid] += dt
total = sum(self_us.values())
agg = collections.Counter()
for nid, us in self_us.items():
    cf = nodes[nid]["callFrame"]
    url = cf["url"].split("/")[-1] if cf["url"] else ""
    agg[(cf["functionName"] or "(anonymous)", f"{url}:{cf['lineNumber']}" if url else "")] += us
print(f"profile length {total/1e6:.1f}s of samples; top self time:")
for (fn, loc), us in agg.most_common(top):
    print(f"{us/total*100:5.1f}%  {us/1000:9.0f} ms  {fn:<40} {loc}")
