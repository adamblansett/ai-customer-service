# Contributing to Open-Source AI Customer Service

Thank you for your interest in contributing to the open-source AI customer service and contact center platform! We welcome contributions from developers, VoIP engineers, AI practitioners, and security researchers.

---

## 1. Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for all contributors. Please treat fellow contributors with respect, maintain constructive feedback, and prioritize software safety and reliability.

---

## 2. Development Environment Setup

### Prerequisites
- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **npm**: `v10.x` or `v11.x`
- **Git**: `2.30+`
- **Docker & Docker Compose** (optional for local development; embedded PostgreSQL runs automatically via PGlite)

### Initial Setup
```bash
# 1. Clone the repository
git clone https://github.com/adamblansett/ai-customer-service.git
cd ai-customer-service

# 2. Install workspace dependencies
npm install

# 3. Create local environment file
cp .env.example .env

# 4. Verify the test suite (runs offline against embedded WebAssembly PostgreSQL)
npm test

# 5. Build all packages and applications
npm run build
```

---

## 3. Monorepo Structure

We use npm workspaces with TypeScript:

| Directory | Name | Description |
| :--- | :--- | :--- |
| `packages/db` | `@customer-service/db` | Drizzle ORM PostgreSQL schema, PGlite embedded test runner, and seed utilities. |
| `packages/core` | `@customer-service/core` | Conversation engine, state machines, AI abstraction, knowledge retriever, safety guards, and telephony adapters. |
| `apps/api` | `@customer-service/api` | Express REST API, inbound voice webhook handlers, public chat endpoints, and audit logging. |
| `apps/web` | `@customer-service/web` | Next.js 14 App Router administration console, live conversation monitor, and call simulator UI. |

---

## 4. Branching and Commit Guidelines

### Branch Naming Conventions
- `feature/<feature-name>`: New features or major capabilities.
- `fix/<issue-name>`: Bug fixes or security patches.
- `docs/<doc-name>`: Documentation improvements.
- `refactor/<target>`: Code restructuring without functional changes.
- `test/<target>`: Additional test suites or test framework improvements.

### Commit Messages
Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
- `feat: add whisper speech-to-text adapter for customer-managed PBX`
- `fix: prevent race condition in conversation state transition during call hangup`
- `docs: update SIP integration guide with Kamailio configuration`
- `test: add unit tests for hours-aware escalation across UTC daylight saving transitions`

---

## 5. Coding Standards

### TypeScript
- All code must pass strict type checking (`npm run build` checks all workspaces).
- Avoid `any` types; prefer strict interfaces, union types, or `unknown` with type guards.
- Use explicit return types on public service methods and API endpoints.

### Multi-Tenancy & Security Rules
- **Never perform un-scoped queries**: Every database select, insert, update, or delete must include `eq(table.tenantId, tenantId)`.
- **Validate permissions on the server**: Never trust client-supplied tenant IDs or roles; always authenticate via JWT and verify membership via `requireTenantRole`.
- **Sanitize outputs**: Use `redactSensitiveData` and `sanitizeLogObject` before logging any payload or error.
- **Guard against prompt injection**: All untrusted caller inputs must be isolated, and retrieved business knowledge must be placed in delimited XML tags.
- **Never execute prohibited actions**: Do not bypass `ToolRegistry` prohibited action checks.

---

## 6. Testing Requirements

All contributions must include automated tests:

### Running Tests
```bash
# Run entire test suite across all packages
npm test

# Run tests in watch mode for core package
npm test --workspace=@customer-service/core -- --watch

# Run tests with coverage
npm test -- --coverage
```

### Test Standards
- **Zero external dependencies**: Tests should execute using the `@customer-service/db` PGlite memory database adapter so they can run without a live PostgreSQL daemon or Docker.
- **Determinism**: Never write tests that depend on live third-party network APIs (OpenAI, Anthropic, Twilio). Use `MockAiProvider` and simulated telephony payloads.
- **Negative testing**: In addition to happy paths, test error cases: unauthorized tenant access, invalid state transitions, rate limits, and injection attempts.

---

## 7. Submitting a Pull Request (PR)

1. Ensure the working tree is clean and all tests pass:
   ```bash
   npm test && npm run build
   ```
2. Push your feature branch to your fork.
3. Open a Pull Request against `main`.
4. Provide a clear PR description detailing:
   - What problem is solved.
   - Any architectural design choices.
   - How the change was tested.
   - Any database migrations or schema adjustments included.
5. Address code review feedback promptly.
