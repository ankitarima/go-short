#!/usr/bin/env python3
"""Turns one load run (k6 summary JSON + docker stats CSV + accounting + service metrics) into one JSON line."""
import csv, json, re, sys


def to_mib(text):
    m = re.match(r"\s*([\d.]+)\s*([KMG]i?B)", text)
    if not m:
        return 0.0
    v, unit = float(m.group(1)), m.group(2)
    return v / 1024 if unit.startswith("K") else v * 1024 if unit.startswith("G") else v


def parse(path):
    """Prometheus text -> {(name, frozenset(labels)): value}"""
    out = {}
    try:
        lines = open(path).read().splitlines()
    except OSError:
        return out
    for line in lines:
        if line.startswith("#") or not line.strip():
            continue
        m = re.match(r"^([a-zA-Z_:][\w:]*)(\{.*\})?\s+(\S+)$", line)
        if not m:
            continue
        labels = dict(re.findall(r'(\w+)="([^"]*)"', m.group(2) or ""))
        out[(m.group(1), frozenset(labels.items()))] = float(m.group(3))
    return out


def hist_quantiles(before, after, name, qs=(0.5, 0.95, 0.99)):
    """Server-side latency quantiles (ms) over the run window, from cumulative histogram bucket deltas.
    A quantile is reported as the upper edge of the bucket that contains it (an upper bound)."""
    buckets = {}
    for (n, labels), v in after.items():
        if n != name + "_bucket":
            continue
        le = dict(labels).get("le")
        edge = float("inf") if le == "+Inf" else float(le)
        buckets[edge] = buckets.get(edge, 0.0) + v - before.get((n, labels), 0.0)
    if not buckets:
        return None
    edges = sorted(buckets)
    total = buckets[edges[-1]]
    if total <= 0:
        return None
    return {f"p{int(q * 100)}": next((e * 1000 for e in edges if buckets[e] >= q * total), None) for q in qs}


def gauge(after, name):
    vals = [v for (n, _), v in after.items() if n == name]
    return max(vals) if vals else None


def ms(v):
    return None if v is None else v * 1000


def main(summary_path, stats_path, rate, accounting_path, outdir=None, tag=None):
    s = json.load(open(summary_path))["metrics"]
    acct = json.load(open(accounting_path))
    dur = s["http_req_duration"]
    cls = {c: s.get(f"http_req_duration{{class:{c}}}") for c in ("hot", "cold", "miss")}

    # Per service and sample time, SUM over replicas (several redirect containers count as one service).
    per_cpu, per_mem = {}, {}
    for row in csv.reader(open(stats_path)):
        if len(row) < 4:
            continue
        epoch, name, c, m = row[:4]
        name = re.sub(r"^goshort-|-\d+$", "", name)
        try:
            per_cpu[(name, epoch)] = per_cpu.get((name, epoch), 0.0) + float(c.strip("%"))
        except ValueError:
            continue
        per_mem[(name, epoch)] = per_mem.get((name, epoch), 0.0) + to_mib(m.split("/")[0])
    cpu, mem = {}, {}
    for (name, _), v in per_cpu.items():
        cpu.setdefault(name, []).append(v)
    for (name, _), v in per_mem.items():
        mem.setdefault(name, []).append(v)

    out = {
        "rate": rate,
        "reqs": s["http_reqs"]["count"],
        "achieved": s["http_reqs"]["rate"],
        "p50": dur["med"], "p95": dur["p(95)"], "p99": dur["p(99)"], "max": dur["max"],
        "hot95": cls["hot"]["p(95)"] if cls["hot"] else None,
        "cold95": cls["cold"]["p(95)"] if cls["cold"] else None,
        "cold99": cls["cold"]["p(99)"] if cls["cold"] else None,
        "unexpected": s["unexpected"]["value"] if "unexpected" in s else None,
        "dropped": s.get("dropped_iterations", {}).get("count", 0),
        "cpu_avg": {k: sum(v) / len(v) for k, v in cpu.items()},
        "cpu_max": {k: max(v) for k, v in cpu.items()},
        "mem_max_mib": {k: max(v) for k, v in mem.items()},
        **acct,
    }
    if outdir:
        rb = parse(f"{outdir}/before-redirect-{tag}.txt")
        ra = parse(f"{outdir}/metrics-redirect-{tag}.txt")
        out["server_side_ms"] = hist_quantiles(rb, ra, "goshort_redirect_duration_seconds")
        out["db_lookup_ms"] = hist_quantiles(rb, ra, "goshort_redirect_db_lookup_seconds")
        out["eventloop_lag_p99_ms"] = {}
        out["eventloop_lag_max_ms"] = {}
        for svc in ("redirect", "worker", "api"):
            a = parse(f"{outdir}/metrics-{svc}-{tag}.txt")
            out["eventloop_lag_p99_ms"][svc] = ms(gauge(a, "nodejs_eventloop_lag_p99_seconds"))
            out["eventloop_lag_max_ms"][svc] = ms(gauge(a, "nodejs_eventloop_lag_max_seconds"))
        cb = {dict(l).get("result"): v for (n, l), v in rb.items() if n == "goshort_redirect_cache_total"}
        ca = {dict(l).get("result"): v for (n, l), v in ra.items() if n == "goshort_redirect_cache_total"}
        out["cache"] = {k: ca.get(k, 0) - cb.get(k, 0) for k in ca}
    print(json.dumps(out))


main(*sys.argv[1:7])
