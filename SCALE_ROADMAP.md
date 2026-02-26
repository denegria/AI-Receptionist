# AI Receptionist Backend — Multi-Tenant Scale Roadmap

## Purpose
Define a practical evolution path from **0 clients** to **1,000,000 clients** while preserving speed now and reliability later.

Core principle: **use SQLite as Stage 0 accelerator**, but build interfaces and migration rails now so we can move before capacity pain.

---

## Guiding Metrics (more important than raw client count)
- **Concurrent active calls** (primary capacity driver)
- **Latency SLO** (first-response start and p95/p99 call turn latency)
- **Error budget** (failed/dropped calls)
- **Queue depth and wait time**
- **Cost per call and per tenant**

> Client count is a weak proxy. A small number of high-volume tenants can stress the system more than thousands of low-volume tenants.

---

## Stage 0 — 0 to 20 clients (Now)
### Goal
Ship quickly, validate product and onboarding loop.

### Stack
- Single backend deployment
- SQLite per-tenant shards (`client-*.db`) + shared registry (`shared.db`)
- Current voice stack

### Must-have hardening now
1. **Strict tenant routing**
   - Remove default/fallback tenant IDs in call routing
   - Resolve tenant from trusted source (phone mapping / registry)
2. **BYOK model resolver**
   - Resolve model/key per call: tenant key → platform default → safe fallback
3. **Config safety**
   - Schema validation + config versioning
   - Hot reload with rollback on invalid config
4. **Basic observability**
   - Active calls, p95 latency, failure/drop rate, queue events

### Exit criteria to Stage 1
- Sustained >10 concurrent calls
- Need predictable 24/7 reliability under bursts

---

## Stage 1 — 20 to 200 clients (Launch-Grade)
### Goal
Reliably support launch target (**100 concurrent calls**) with controlled degradation.

### Architecture changes
1. **Stateless call worker pool**
   - N identical workers; each call loads tenant config + key into isolated call context
2. **Redis for realtime state/queues**
   - Session state, short-lived call context, overload queue, idempotency keys
3. **Admission control + backpressure**
   - Queue-first policy
   - Fallback to voicemail/forward when wait threshold exceeded
4. **Load test harness**
   - Automated tests at 10 / 25 / 50 / 100 concurrent calls

### SLO framing
- Target: sub-500ms response start under normal load
- Practical uptime objective: 99.95%+ with graceful degradation

### Exit criteria to Stage 2
- Sustained >30 concurrent calls
- Need horizontal multi-instance scaling without local-file DB friction

---

## Stage 2 — 200 to 2,000 clients (Production Core)
### Goal
Stabilize data plane for scale and multi-instance operation.

### Architecture changes
1. **Migrate tenant data to Postgres**
   - Tenant-scoped tables and indexes
   - Keep Redis for ephemeral session/queue state
2. **Secrets and key management**
   - Encrypted tenant BYOK storage
   - Rotation + audit trails
3. **Tenant guardrails**
   - Per-tenant rate limits
   - Spend caps and alerting
4. **Autoscaling**
   - Scale workers based on active calls, queue depth, and latency

### Exit criteria to Stage 3
- Regional HA requirements
- Growing enterprise/compliance demands

---

## Stage 3 — 2,000 to 20,000 clients (Regional Resilience)
### Goal
Resilient operations with better QoS segmentation.

### Architecture changes
1. Multi-AZ resiliency and failover
2. Queue partitioning by tenant tier/priority
3. Optional premium isolation pools for high-SLA tenants
4. Stronger observability
   - Per-call traces
   - Per-tenant QoS and cost dashboards

---

## Stage 4 — 20,000 to 200,000 clients (Platform Maturity)
### Goal
Global-scale operational posture.

### Architecture changes
1. Multi-region active-active control plane
2. Data partitioning/sharding strategy
3. Region-aware tenant placement
4. Policy controls for compliance/data residency

---

## Stage 5 — 200,000 to 1,000,000 clients (Internet Scale)
### Goal
Tiered platform at very high scale.

### Architecture changes
1. Domain-focused platform teams (runtime/data/control plane/billing)
2. Tenant segmentation
   - Shared pools for SMB
   - Dedicated pools for enterprise tiers
3. Predictive autoscaling + pre-warmed capacity
4. Formal SLO contracts per plan tier

---

## Non-Negotiable Design Rules (all stages)
1. **No tenant state in global mutable memory**
2. **Per-call tenant context must be explicit and isolated**
3. **All config changes are validated, versioned, and rollback-capable**
4. **Graceful degradation beats hard failure**
5. **Measure capacity with load tests, not assumptions**

---

## Immediate Execution Plan (next 2–3 weeks)
1. Keep SQLite in place for speed (Stage 0)
2. Implement strict tenant routing + remove unsafe defaults
3. Add BYOK resolver with fallback chain
4. Introduce worker-pool runtime behavior and Redis-backed transient state
5. Add overload queue + fallback policy
6. Run repeatable load tests and define launch gates
   - Must pass 100 concurrent synthetic calls
   - Validate latency/error thresholds

---

## Migration Gate (SQLite → Postgres)
Perform migration when **any** of these are true:
- Sustained concurrency regularly exceeds Stage 0 comfort range
- Multi-instance scaling required for uptime goals
- SQLite write contention appears in production metrics
- Cross-tenant analytics/operations become expensive or fragile

---

## Launch Readiness Checklist (minimum)
- [ ] Tenant routing guaranteed and tested
- [ ] BYOK + default provider fallback working
- [ ] Config hot reload with safe rollback
- [ ] Queue/backpressure and fallback behavior implemented
- [ ] 100-concurrent load test pass
- [ ] On-call dashboards and alerts for latency/failure/queue depth
