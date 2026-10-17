# Operational Runbook & Production Administration

This document outlines standard operating procedures, backup and recovery guidelines, secret rotation workflows, and incident response playbooks for the open-source AI customer-service platform.

---

## 1. Production Deployment & Upgrade Procedures

### System Requirements
- **CPU**: Minimum 2 vCPU (4 vCPU recommended for high concurrent call volume)
- **RAM**: Minimum 4 GB RAM (8 GB recommended)
- **Disk**: 40 GB+ SSD storage (persistent volume for PostgreSQL and audit logs)
- **Operating System**: Linux (Ubuntu 22.04 LTS, Debian 12, or RHEL 9 recommended)
- **Runtimes**: Docker 24+ and Docker Compose v2+

### Clean Deployment Workflow
1. **Clone repository and checkout release tag**:
   ```bash
   git clone https://github.com/adamblansett/ai-customer-service.git /opt/ai-customer-service
   cd /opt/ai-customer-service
   git checkout tags/v1.0.0
   ```
2. **Configure production environment variables**:
   ```bash
   cp .env.example .env
   chmod 600 .env
   ```
   Generate strong cryptographic secrets:
   ```bash
   # Generate 32-byte hex key for AES-256-GCM vault
   openssl rand -hex 32
   # Generate 32-byte hex secret for JWT signing
   openssl rand -hex 32
   # Generate strong DB password
   openssl rand -base64 24
   ```
   Populate `.env` with the generated values, production database URL, and public hostnames.
3. **Build and launch containerized services**:
   ```bash
   docker compose up -d --build
   ```
4. **Verify container health**:
   ```bash
   docker compose ps
   docker compose logs -f api
   ```
   Check health endpoints:
   - API: `curl -f http://localhost:3001/health` (returns `{"status":"ok",...}`)
   - Web Console: `curl -f http://localhost:3000`

### Zero-Downtime Upgrade Workflow
1. Pull new release tag:
   ```bash
   git fetch --tags
   git checkout tags/v1.1.0
   ```
2. Review migration scripts in `packages/db/src/schema` or release notes for breaking changes.
3. Build new container images:
   ```bash
   docker compose build --pull
   ```
4. Perform rolling restart:
   ```bash
   docker compose up -d --no-deps --build api
   docker compose up -d --no-deps --build web
   ```
5. Prune dangling images:
   ```bash
   docker image prune -f
   ```

---

## 2. Backup & Recovery

### Automated PostgreSQL Backup Strategy
PostgreSQL stores all tenant configurations, conversations, audit logs, and encrypted credentials in the `postgres_data` volume.

#### Nightly Snapshot Script (`/opt/scripts/backup-db.sh`)
```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/var/backups/ai-customer-service"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

docker compose -f /opt/ai-customer-service/docker-compose.yml exec -T postgres \
  pg_dump -U postgres customer_service | gzip > "${FILENAME}"

chmod 600 "${FILENAME}"

# Retain 30 days of snapshots
find "${BACKUP_DIR}" -type f -name "postgres_*.sql.gz" -mtime +30 -delete

echo "Backup completed successfully: ${FILENAME}"
```

### Full Disaster Recovery (Restore Workflow)
1. Stop the application services:
   ```bash
   docker compose stop api web
   ```
2. Drop and recreate database from snapshot:
   ```bash
   gunzip -c /var/backups/ai-customer-service/postgres_20261016_000000.sql.gz | \
     docker compose exec -T postgres psql -U postgres -d customer_service
   ```
3. Restart application services and verify:
   ```bash
   docker compose start api web
   curl -f http://localhost:3001/health
   ```

---

## 3. Database Migrations

The platform utilizes Drizzle ORM schema declarations in `packages/db/src/schema/index.ts`.

### Schema Versioning Guidelines
- Never alter column data types in a destructive manner on live tables.
- Add new columns as `nullable` or with safe default values.
- For column deprecations, use a two-phase release: first make the column optional, then drop it in the subsequent release.

---

## 4. Secret Rotation & Master Key Management

### BYOK Master Encryption Key Rotation (`AES-256-GCM`)
All third-party credentials (OpenAI, Anthropic, Gemini, Twilio) are encrypted at rest with an authenticated 256-bit key.

When rotating the master key:
1. Generate new 32-byte hex key:
   ```bash
   openssl rand -hex 32
   ```
2. Set secondary key in `.env`:
   ```bash
   ENCRYPTION_MASTER_KEY_V1=existing_key_hex
   ENCRYPTION_MASTER_KEY_V2=new_key_hex
   ENCRYPTION_ACTIVE_KEY_VERSION=2
   ```
3. Run re-encryption batch job across `integration_credentials`:
   - Decrypts ciphertexts where `key_version = 1` using `ENCRYPTION_MASTER_KEY_V1`.
   - Re-encrypts payload using `ENCRYPTION_MASTER_KEY_V2`.
   - Updates record with `key_version = 2`.
4. Once all records are migrated, remove `ENCRYPTION_MASTER_KEY_V1`.

### JWT Secret Rotation
1. Update `JWT_SECRET` in `.env`.
2. Existing active agent sessions will be invalidated and prompted to re-authenticate at `/login`.

---

## 5. Monitoring & Alerting Recommendations

### Recommended Health & Diagnostic Metrics
| Component | Metric | Warning Threshold | Critical Threshold |
| :--- | :--- | :--- | :--- |
| **API Server** | HTTP 5xx error rate | > 1% over 5m | > 5% over 5m |
| **API Server** | P95 Response Latency | > 800ms | > 2000ms |
| **Database** | Active Connection Pool Usage | > 75% | > 90% |
| **Voice Gateway** | Failed Inbound Call Ratio | > 2% | > 5% |
| **Voice Gateway** | Fallback Callback Spike | > 10 in 15m | > 30 in 15m |
| **AI Providers** | Rate Limit Errors (429) | > 5 in 5m | > 20 in 5m |

### Health Check Endpoints
- `GET /health`: Returns service health, uptime, database connectivity status, and memory consumption.

---

## 6. Incident Response Playbooks

### Playbook A: Telephony Gateway Outage (Twilio / Carrier Down)
**Symptoms**: Inbound calls fail to connect; webhook timeouts; spike in carrier error webhooks.
**Action Items**:
1. Check external carrier status page (e.g. status.twilio.com).
2. If carrier is degraded, update telephony fallback routing in carrier console to forward calls directly to the enterprise backup emergency DID.
3. Review `/api/v1/voice/inbound` access logs in `docker compose logs --tail=100 api` to confirm webhook receipt.
4. Notify support managers to monitor `/overview` and `/calls` for accumulated callback requests.

### Playbook B: AI Provider Outage or Rate-Limiting
**Symptoms**: `AiRateLimitError` or `AiTimeoutError` in logs; AI responses take > 4 seconds; calls escalate immediately to human queues.
**Action Items**:
1. Navigate to `/integrations` in the Admin Console.
2. Switch active provider or update API credentials (e.g., fallback from primary OpenAI to secondary Anthropic or Groq).
3. If all external AI providers are unavailable, the platform automatically activates safety fallback: callers are greeted with the approved offline announcement and transferred directly to human representatives or queued for callbacks.

### Playbook C: Suspected Prompt Injection or Abuse Attempt
**Symptoms**: `AUDIT_EVENT` with `event_type = 'prompt_injection_detected'` or `prohibited_action_blocked` in the audit log.
**Action Items**:
1. Query audit events for the suspicious `conversation_id` or caller phone number:
   ```sql
   SELECT * FROM audit_events WHERE event_type IN ('prompt_injection_detected', 'prohibited_action_blocked') ORDER BY created_at DESC LIMIT 20;
   ```
2. Review the caller utterance in the conversation transcripts.
3. Confirm that the safety engine neutralized the attack (verified by system prompt refusal and zero state compromise).
4. If a specific caller is engaging in malicious automated dialing, block the caller's E.164 number at the telephony carrier or SIP trunk firewall.
