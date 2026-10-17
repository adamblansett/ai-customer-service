# Containerized Deployment & Verification Guide

This document describes the container architecture, multi-stage Docker build process, healthcheck probes, and verification workflows for the open-source AI customer service platform.

---

## 1. Container Topology & Architecture

The stack is orchestrated using Docker Compose (`docker-compose.yml`) with strict network boundaries and least-privilege security principles:

```
                          Internet / PSTN / SIP Carriers
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                  ┌─────────────┐           ┌─────────────┐
                  │  apps/web   │           │  apps/api   │
                  │  (Port 3000)│           │  (Port 3001)│
                  └──────┬──────┘           └──────┬──────┘
                         │                         │
                         └───────────┬─────────────┘
                                     │ (contact-center-net bridge)
                                     ▼
                            ┌─────────────────┐
                            │    postgres     │
                            │   (Postgres 16) │
                            │ (Internal only) │
                            └─────────────────┘
```

### Services

| Service | Image / Build | Port Binding | Healthcheck Probe | Security Context |
| :--- | :--- | :--- | :--- | :--- |
| `postgres` | `postgres:16-alpine` | `5432` (Internal only) | `pg_isready -U postgres` | Sandboxed to internal network |
| `api` | `apps/api/Dockerfile` | `3001:3001` | `curl -f http://localhost:3001/health` | Non-root `node` (UID 1000) |
| `web` | `apps/web/Dockerfile` | `3000:3000` | `curl -f http://localhost:3000` | Non-root `nextjs` (UID 1001) |

---

## 2. Multi-Stage Docker Builds

Both `apps/api` and `apps/web` use optimized multi-stage Dockerfiles based on `node:22-alpine`:
- **Stage 1 (`builder`)**: Installs full monorepo dependencies (`npm ci`), compiles TypeScript packages (`@customer-service/db`, `@customer-service/core`, `@customer-service/api`), and generates Next.js standalone server bundles.
- **Stage 2 (`runner`)**: Copies only the compiled `dist/` or `.next/standalone/` artifacts, production dependencies (`npm ci --omit=dev`), drops all build tools, and runs under unprivileged system user IDs.

---

## 3. Quickstart & Deployment

### 1. Configure Environment Variables
Copy and customize your production secrets in `.env`:
```bash
cp .env.example .env
```
Ensure `ENCRYPTION_MASTER_KEY` (32-byte hex/string) and `JWT_SECRET` are securely generated and distinct from development defaults.

### 2. Launch the Stack
```bash
docker compose up -d --build
```

### 3. Check Service Logs
```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f postgres
```

### 4. Run Automated Container Smoke Test
Execute the automated smoke test script to verify Docker syntax, network probes, and test suite:
```bash
./scripts/sandbox/docker-smoke-test.sh
```

---

## 4. Health & Readiness Probes

The API server provides dual health probes for container orchestrators (Docker Swarm, Kubernetes, Nomad, AWS ECS):
- **Liveness Probe**: `GET /health` -> `{ "status": "ok", "timestamp": "..." }`
- **Readiness Probe**: `GET /health/ready` -> `{ "status": "ready", "database": "connected" }` (validates live database responsiveness via `SELECT 1`).

---

## 5. End-to-End Synthetic Call Simulation

To test live TwiML generation, voice dialog turn synthesis, and transfer escalation fallback against the running containerized API:
```bash
API_URL=http://localhost:3001 npx tsx scripts/sandbox/simulate-live-call.ts
```
Expected output:
1. API Liveness & Readiness check passes.
2. Inbound ring answered with TwiML `<Gather>` / `<Say>`.
3. Conversational turn synthesized with grounded knowledge base context.
4. Human escalation request dynamically resolved with bridge transfer (`<Dial>`).
5. Carrier busy/timeout callback ticket generated and apology rendered.
