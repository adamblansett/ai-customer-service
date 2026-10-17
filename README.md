# Open-Source AI Customer Service & Contact Center Platform

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/adamblansett/ai-customer-service/actions/workflows/ci.yml/badge.svg)](https://github.com/adamblansett/ai-customer-service/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14.x-black.svg)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)

An open-source, self-hosted, Docker-first AI customer-service and contact-center platform. The system empowers businesses to deploy an AI voice assistant capable of answering inbound calls, identifying itself as an automated AI agent, answering customer questions using approved business information, handling SMS conversations, and reliably escalating to human representatives with automatic fallback callback scheduling and live WebRTC softphone answering.

---

## Key Capabilities

1. **Provider-Neutral Inbound Voice & SMS Architecture**:
   - Telephony adapters for **Twilio-compatible voice and SMS webhooks** and **Customer-managed SIP / PBX** infrastructures (Asterisk / FreeSWITCH).
   - Generates compliant TwiML XML (`<Say>`, `<Gather>`, `<Dial>`, `<Message>`, `<Hangup>`).
   - Integrated offline **Voice Call Lifecycle Simulator** for zero-cost testing.

2. **Unified Multi-Channel Conversation Engine**:
   - Reusable across **Inbound Voice Calls**, **SMS Text Messaging**, and **Website Chat**.
   - Explicit state machine with strict transition guards (`active`, `waiting_agent`, `transferred`, `interrupted`, `closed`, `failed`).
   - Idempotency manager preventing duplicate webhook or retry processing.

3. **Streaming Speech-to-Text & Text-to-Speech Pipeline**:
   - Provider-neutral STT and TTS interfaces with `SpeechPipeline` for low-latency full-duplex speech.
   - Built-in adapter templates for **Deepgram Nova-2** (real-time streaming transcription) and **ElevenLabs Flash v2** (low-latency streaming neural synthesis), with zero-cost mock adapters for CI and offline environments.

4. **Contact Center Queues & Automatic Call Distribution (ACD)**:
   - `CallQueueManager` supporting priority tiers, skills-based routing (`requiredSkills`), and agent assignment strategies (`longest-idle`, `round-robin`).
   - Abandonment tracking (`dequeueCall`) and real-time queue wait-time metrics.

5. **In-Browser WebRTC Softphone Interface**:
   - Real-time agent call answering console embedded directly in the web dashboard.
   - Live softphone controls: Mute/Unmute microphone, Call Hold/Resume, and one-click Call Disconnect.

6. **Post-Call Conversation Analytics & CSAT Scoring**:
   - `ConversationAnalyzer` extracts multi-turn customer sentiment (`positive`, `neutral`, `negative`, `frustrated`), CSAT score (1–5), resolution status, key topics, and AI-generated call summaries.
   - Automated compliance auditing verifying AI identity disclosure and recording consent notices.

7. **Multi-Tenancy & Authenticated Zero-Knowledge BYOK Security**:
   - Strict tenant boundary isolation enforced on all database queries and tool executions.
   - Role-Based Access Control (RBAC): `Owner`, `Admin`, `Agent`.
   - Bring-Your-Own-Key (BYOK) credential encryption at rest using **AES-256-GCM** authenticated encryption.
   - PII and credential log sanitization preventing secrets from leaking into operational logs.

8. **Business Knowledge Base & Source Attribution**:
   - Semantic Markdown and plain text chunking with token estimation.
   - Fast BM25 keyword and phrase relevance search.
   - Strict hallucination defense: unverified questions trigger clarification or human escalation.
   - Source attribution (document title, URI, chunk index).

9. **Hours-Aware Human Escalation & Fallback Callbacks**:
   - Timezone-aware business operating hours evaluator.
   - Configurable fallback transfer phone numbers (E.164 validated).
   - Failed transfer fallback: if an agent is busy, times out, or doesn't answer, automatically captures a callback ticket so callers are never abandoned.
   - After-hours routing: schedules next-business-day callbacks.

10. **Bidirectional WebSocket Media Streaming & Sub-500ms Barge-In**:
    - `MediaStreamGateway` and `MediaStreamSession` for real-time Twilio and FreeSWITCH audio streams.
    - Immediate audio cancellation (`clear` message frame) when caller interrupts assistant speech.

11. **External CRM & Helpdesk Webhook Dispatcher**:
    - `CrmDispatcher` automatically forwards callback requests to HubSpot Tickets, Zendesk, Salesforce Cases, and Zapier/Make webhooks.
    - HMAC-SHA256 request signing (`X-Customer-Service-Signature`) and bearer token authentication.

12. **SaaS Billing & Consumption Metering Engine**:
    - `UsageMeter` with multi-tier subscription quotas (`Starter`, `Pro`, `Enterprise`).
    - Tracks voice minutes and AI tokens with configurable overage rate calculations and monthly invoice estimators.

13. **Web Administration & Agent Console**:
    - Built with **Next.js 14 App Router**, TypeScript, and Tailwind CSS.
    - Live Conversation Monitor with human takeover, transfer, and message injection.
    - Knowledge Base Manager with interactive test search preview.
    - Business Settings & Operating Hours scheduler.
    - BYOK Credential Manager with masked key displays.
    - Interactive Call Simulator UI for testing phone calls in the browser.

---


## Monorepo Architecture

```
├── apps/
│   ├── api/          # Express REST API, Voice Webhooks, Call Simulator, Chat endpoints
│   └── web/          # Next.js 14 App Router Administration & Agent Console
├── packages/
│   ├── core/         # Conversation Engine, AI Providers, Knowledge Retriever, Safety Guards, Telephony
│   └── db/           # Drizzle ORM PostgreSQL schema, migrations, PGlite test runner, seed scripts
├── docker-compose.yml# Production deployment configuration (Postgres, API, Web)
└── .env.example      # Environment variables template
```

---

## Documentation Index

Comprehensive guides for operators, architects, and developers:

- [Platform Architecture & Technical Design](ARCHITECTURE.md): System topology, conversation state machine, data flow, component breakdown, and extension points.
- [Telephony Integration & Protocol Guide](TELEPHONY.md): Twilio webhooks, Asterisk/FreeSWITCH SIP integration, TwiML protocol, speech interruption (barge-in), and call simulation.
- [Security & AI Safety Policy](SECURITY.md): Threat model, BYOK encryption, key rotation, RBAC, prohibited action guardrails, prompt injection defenses, and PII scrubbing.
- [Operational Runbooks & Production Administration](OPERATIONS.md): Deployment, zero-downtime upgrades, PostgreSQL backup/recovery, monitoring metrics, and incident response playbooks.
- [Commercial Readiness & Monetization Assessment](COMMERCIAL_READINESS.md): SaaS transition roadmap, usage metering schema, billing boundaries, and compliance assessment (SOC2, GDPR, HIPAA, PCI-DSS).
- [Contributing Guidelines](CONTRIBUTING.md): Monorepo standards, TypeScript guidelines, development setup, and pull request procedures.


---

## Quickstart (Local Development)

### Prerequisites
- Node.js `v20+` or `v22+`
- npm `v10+`

### 1. Clone & Install
```bash
git clone https://github.com/adamblansett/ai-customer-service.git
cd ai-customer-service
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Ensure `ENCRYPTION_MASTER_KEY` and `JWT_SECRET` are set. (Default values are provided for local dev).

### 3. Run Automated Test Suite
The test suite runs against embedded WebAssembly PostgreSQL (`PGlite`) with zero external database dependencies:
```bash
npm test
```
All 88 unit, integration, and security tests will execute and pass across 15 test suites.

### 4. Build Monorepo
```bash
npm run build
```

### 5. Launch Development Servers
```bash
# Terminal 1: Launch API Server
npm run dev --workspace=@customer-service/api

# Terminal 2: Launch Next.js Web Console
npm run dev --workspace=@customer-service/web
```
- Web Console: [http://localhost:3000](http://localhost:3000)
- API Server: [http://localhost:3001](http://localhost:3001)

### Default Seed Credentials (Local Development)
- **Business Owner**: `admin@acme-hvac.example.com` / `DevPassword123!`
- **Support Agent**: `sarah.agent@acme-hvac.example.com` / `DevPassword123!`

---

## Docker Deployment

To deploy in production using Docker Compose:

```bash
docker compose up -d --build
```

The stack provisions:
1. `postgres`: PostgreSQL 16 Alpine container with persistent named volume `postgres_data` (isolated on internal network).
2. `api`: Multi-stage unprivileged (`node`) container exposing port `3001`.
3. `web`: Standalone Next.js unprivileged (`nextjs`) container exposing port `3000`.

---

## License & Rationale

Licensed under the [Apache License, Version 2.0](LICENSE).

**Rationale**: Apache-2.0 was selected over copyleft licenses (such as AGPL-3.0) because customer service platforms must integrate with proprietary enterprise telephony hardware, on-premise PBXs, and custom CRM databases. Apache-2.0 provides broad commercial flexibility while preserving patent protections, contributor attribution, and limitation of liability.
