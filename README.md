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

10. **Omnichannel Email & WhatsApp Business Messaging**:
    - **Inbound Email**: `EmailAdapter` and `EmailConversationHandler` parsing SendGrid, Postmark, and Mailgun webhooks with automatic message threading (`In-Reply-To`), knowledge-grounded AI responses, and prompt injection defense.
    - **WhatsApp Business Cloud API**: Meta Graph API webhook subscription handshake and real-time message handler producing compliant WhatsApp messaging payloads.

11. **Local & Air-Gapped AI Inference (Ollama & vLLM)**:
    - First-class providers for self-hosted LLMs: **Ollama** (`OllamaAiProvider`, streaming NDJSON, model discovery) and **vLLM** (`VllmAiProvider`, OpenAI-compatible high-throughput endpoint with 131k context window) enabling 100% air-gapped, zero-cost AI deployments.

12. **Bidirectional WebSocket Media Streaming & Sub-500ms Barge-In**:
    - `MediaStreamGateway` and `MediaStreamSession` for real-time Twilio and FreeSWITCH audio streams.
    - Immediate audio cancellation (`clear` message frame) when caller interrupts assistant speech.

13. **External CRM & Helpdesk Webhook Dispatcher**:
    - `CrmDispatcher` automatically forwards callback requests to HubSpot Tickets, Zendesk, Salesforce Cases, and Zapier/Make webhooks.
    - HMAC-SHA256 request signing (`X-Customer-Service-Signature`) and bearer token authentication.

14. **SaaS Billing & Consumption Metering Engine**:
    - `UsageMeter` with multi-tier subscription quotas (`Starter`, `Pro`, `Enterprise`).
    - Tracks voice minutes and AI tokens with configurable overage rate calculations and monthly invoice estimators.

15. **Production Cloud Infrastructure (Kubernetes Helm & Terraform)**:
    - **Helm Chart** (`deploy/helm/ai-customer-service`): Complete Kubernetes manifests for API replicas, Web console, Ingress with TLS, ConfigMaps, Secrets, and Horizontal Pod Autoscaling (HPA).
    - **Terraform / OpenTofu Modules** (`deploy/terraform`): Multi-cloud IaC for AWS (ECS Fargate + RDS Postgres + ElastiCache) and GCP (Cloud Run + Cloud SQL + Memorystore).

16. **Live Carrier Sandbox & Developer Tooling**:
    - Interactive CLI call simulator (`scripts/sandbox/simulate-live-call.ts`) running a full 5-step call lifecycle.
    - Automated tunnel setup script (`scripts/sandbox/start-tunnel.sh`) for testing real cell phone calls via Twilio with zero deployment friction.

17. **Web Administration & Agent Console**:
    - Built with **Next.js 14 App Router**, TypeScript, and Tailwind CSS (16 static routes).
    - Real-time Contact Center Queues & ACD Wallboard (`/queues`) with live staff presence.
    - Post-Call Analytics & CSAT Scoring (`/analytics`) with compliance auditing and AI summaries.
    - Subscription & Usage Metering Portal (`/billing`) with quota progress meters and Stripe billing.
    - Live Conversation Monitor with human takeover, transfer, and message injection.
    - Knowledge Base Manager with interactive test search preview.
    - BYOK Credential Manager with masked key displays.
    - Interactive Call Simulator UI for testing phone calls in the browser.

---

## Monorepo Architecture

```
├── apps/
│   ├── api/          # Express REST API, Voice Webhooks, Call Simulator, Chat endpoints
│   └── web/          # Next.js 14 App Router Administration & Agent Console
├── packages/
│   ├── core/         # Conversation Engine, AI Providers (OpenAI, Gemini, Ollama, vLLM), Knowledge, Telephony, Messaging
│   └── db/           # Drizzle ORM PostgreSQL schema, migrations, PGlite test runner, seed scripts
├── deploy/
│   ├── helm/         # Kubernetes Helm Chart (API, Web, Ingress, HPA)
│   └── terraform/    # Infrastructure-as-Code for AWS and GCP
├── scripts/
│   └── sandbox/      # Carrier tunnel and live call simulation scripts
├── docker-compose.yml# Production deployment configuration (Postgres, API, Web)
└── .env.example      # Environment variables template
```

---

## Documentation Index

Comprehensive guides for operators, architects, and developers:

- [Platform Architecture & Technical Design](ARCHITECTURE.md): System topology, conversation state machine, data flow, component breakdown, and extension points.
- [Telephony Integration & Protocol Guide](TELEPHONY.md): Twilio webhooks, Asterisk/FreeSWITCH SIP integration, TwiML protocol, speech interruption (barge-in), and call simulation.
- [Live Carrier Sandbox & Walkthrough Guide](SANDBOX.md): Step-by-step instructions for testing inbound phone calls, SMS, email, and WhatsApp via local tunnels and simulators.
- [Cloud Infrastructure as Code Guide](deploy/terraform/README.md): Kubernetes Helm charts and Terraform provisioning instructions for AWS and GCP.
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
All 108 unit, integration, and security tests will execute and pass across 18 test suites.

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

## ⚖️ Legal Disclaimer & Limitation of Liability

### 1. "AS IS" and Express Warranty Disclaimer
This software, documentation, automated conversational workflows, AI agent pipelines, telephony integrations, and messaging infrastructure are provided on an **"AS IS"** and **"AS AVAILABLE"** basis, **WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND**, either express, implied, statutory, or otherwise. To the maximum extent permitted by applicable law, the author, copyright holders, and contributors expressly disclaim all warranties, including but not limited to implied warranties of merchantability, fitness for a particular purpose, title, quiet enjoyment, and non-infringement.

### 2. Conversational AI Non-Determinism & No Emergency Services
- **AI Output Non-Determinism:** Autonomous customer service agents rely on large language models that are non-deterministic and capable of generating inaccurate, incomplete, misleading, or unexpected statements. The software should not be deployed to make binding legal, contractual, medical, financial, or safety commitments without appropriate human supervision, approval gates, and guardrails.
- **CRITICAL: NO EMERGENCY SERVICES:** THIS SOFTWARE IS **NOT** INTENDED, DESIGNED, LICENSED, OR AUTHORIZED FOR USE IN EMERGENCY COMMUNICATIONS, EMERGENCY SERVICES DISPATCH (SUCH AS 911, E911, 999, 112, OR PUBLIC SAFETY ANSWERING POINTS), OR LIFE-CRITICAL SYSTEMS.

### 3. Telecommunications & Regulatory Compliance (TCPA, CAN-SPAM, WhatsApp, GDPR)
- The deployment of automated voice calls, SMS messages, WhatsApp chats, and marketing emails is subject to strict international, federal, and state regulations (including the US Telephone Consumer Protection Act [TCPA], the CAN-SPAM Act, CTIA Messaging Principles, the Meta WhatsApp Business Policy, and the EU General Data Protection Regulation [GDPR]).
- Users and deploying organizations are solely and exclusively responsible for obtaining lawful prior express written consent from recipients, honoring opt-outs (e.g. STOP requests), managing unsubscribes, maintaining audit logs, and adhering to carrier registration requirements (e.g. A2P 10DLC).
- The author and contributors disclaim all liability for regulatory fines, statutory damages (including statutory TCPA damages of $500–$1,500 per call/text), carrier surcharges, or legal actions resulting from the use or deployment of this software.

### 4. Limitation of Liability
To the maximum extent permitted by applicable law, **IN NO EVENT SHALL THE AUTHOR, COPYRIGHT HOLDERS, OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES** (including, but not limited to, loss of use, data, revenue, profits, business, or goodwill; regulatory fines or penalties; telephony billing charges; carrier suspensions; customer disputes; or procurement of substitute goods or services), however caused and on any theory of liability, whether in contract, strict liability, tort (including negligence or otherwise), or statute, arising in any way out of the use, reproduction, modification, distribution, or reliance upon this software, even if advised of the possibility of such damages.

### 5. Third-Party Trademarks & Non-Affiliation
All product names, logos, brands, and registered trademarks mentioned within this project (including Twilio, WhatsApp, Meta, OpenAI, Ollama, vLLM, Docker, Next.js, and PostgreSQL) are the property of their respective owners. Mention of these entities does not imply endorsement, sponsorship, or affiliation with the author.

---

## License & Rationale

Licensed under the [Apache License, Version 2.0](LICENSE).

**Rationale**: Apache-2.0 was selected over copyleft licenses (such as AGPL-3.0) because customer service platforms must integrate with proprietary enterprise telephony hardware, on-premise PBXs, and custom CRM databases. Apache-2.0 provides broad commercial flexibility while preserving patent protections, contributor attribution, and limitation of liability.
