# Hocuspocus Vertical Scaling Model (Render)

## TL;DR

These are practical ballpark ranges for a **single Hocuspocus instance** (no Redis backplane), assuming:

- typical collaborative load (not all users typing continuously)
- average active doc has about 3 connected sessions
- safety targets: CPU < 70%, memory < 65% of instance RAM

| Render plan | RAM / CPU | Healthy active WS sessions | Active docs (@ ~3 sessions/doc) | Hot single-doc cap |
|---|---:|---:|---:|---:|
| Free | 512 MB / 0.1 | 3-8 | 1-3 | 2-4 typers |
| Starter | 512 MB / 0.5 | 12-35 | 4-12 | 5-10 typers |
| Standard | 2 GB / 1 | 50-160 | 17-53 | 10-22 typers |
| Pro | 4 GB / 2 | 110-300 | 37-100 | 18-38 typers |
| Pro Plus | 8 GB / 4 | 220-650 | 73-216 | 35-70 typers |
| Pro Max | 16 GB / 4 | 260-800 | 87-266 | 40-80 typers |
| Pro Ultra | 32 GB / 8 | 500-1500 | 167-500 | 70-140 typers |

Notes:

- `Pro Max` mostly adds memory headroom over `Pro Plus` (same CPU count), so throughput gain is not proportional.
- If your traffic is "hot-room heavy" (many users editing the same doc), reduce these ranges by roughly 30-50%.

---

## Advanced Analysis

### 1) Why capacity is not just "users"

Realtime editor load is dominated by **document fanout**, not total registered users:

- each inbound edit on a doc is broadcast to the other collaborators
- broadcast work scales roughly with `k * (k - 1)` for a doc with `k` active sessions
- a few hot docs can saturate CPU before memory looks full

So the right scaling units are:

- active docs (`D`)
- avg sessions per active doc (`k`)
- update rate (`u`, updates/sec/session)

### 2) Core model

#### Memory model

```text
M_total = M_base + (C * m_conn) + (D * m_doc) + headroom

where:
C = D * k
```

Definitions:

- `M_base`: baseline process RSS with no active docs/connections
- `m_conn`: average memory slope per websocket session
- `m_doc`: average memory slope per active Y.Doc
- `headroom`: 20-30% for GC spikes + transient bursts

Safe memory budget:

```text
M_budget ~= 0.65 * instance_RAM
```

#### CPU/fanout model

```text
R_in  = D * k * u
R_out = D * k * u * (k - 1)
B_out ~= R_out * p
```

Definitions:

- `R_in`: inbound updates/sec
- `R_out`: outbound fanout updates/sec
- `p`: avg outbound payload bytes/update
- `B_out`: outbound bytes/sec

### 3) Worked example

Assume:

- `D = 120` active docs
- `k = 12` sessions/doc
- `u = 0.6` updates/sec/session
- `p = 350 bytes`

Then:

- `R_in = 120 * 12 * 0.6 = 864 msg/sec`
- `R_out = 120 * 12 * 0.6 * 11 = 9504 msg/sec`
- `B_out ~= 9504 * 350 = 3.3 MB/sec (~26 Mbps)`

Interpretation: memory can still look "fine" while fanout CPU/event-loop delay becomes the bottleneck.

### 4) Practical guardrails for with.md

Track these in production:

- p95 event-loop lag < 40ms
- process CPU ideally < 70% sustained
- RSS < 65-70% instance RAM
- reconnect/error rate during deploy/scale events

If CPU or lag breaches first, you're fanout-bound.
If RSS breaches first, you're memory-bound.

### 5) Calibration plan (recommended before paid jumps)

Run 3 synthetic load tests to replace estimates with measured coefficients:

1. Connection slope test:
   - fixed 1 doc, vary websocket count
   - derive `m_conn`
2. Doc slope test:
   - fixed 1 client/doc, vary active docs
   - derive `m_doc`
3. Fanout stress test:
   - vary `k` and `u` on same doc
   - derive safe `R_out` range before lag/CPU degrade

### 6) Architecture caveat

This document is for **vertical scaling** (single instance size upgrades).

If you scale horizontally to multiple instances without a shared realtime backplane or deterministic doc sharding, collaborators on the same doc can be split across instances and lose realtime consistency.

