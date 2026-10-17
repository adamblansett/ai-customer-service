# Live Carrier Sandbox & End-to-End Walkthrough Guide

This guide details how to test real-world telephony, SMS, email, and WhatsApp interactions with the platform using local simulation tools and public tunnels.

---

## 1. Zero-Cost Browser Call Simulator

The web console includes a built-in phone simulator that emulates audio calls without requiring carrier credentials or a phone number:

1. Launch local development servers:
   ```bash
   npm run dev --workspace=@customer-service/api
   npm run dev --workspace=@customer-service/web
   ```
2. Navigate to [http://localhost:3000/simulator](http://localhost:3000/simulator)
3. Click **"Simulate Inbound Call"**.
4. Type or speak customer queries.
5. Test human transfer and fallback callbacks in real time.

---

## 2. Terminal End-to-End Voice Simulation

Execute a complete 5-step call lifecycle against a running local API server:

```bash
npx tsx scripts/sandbox/simulate-live-call.ts
```

This automated script executes:
1. **Health Probe**: Validates `/health` readiness.
2. **Inbound Call Ring**: Sends `POST /api/v1/voice/inbound` and logs the initial `<Say>` + `<Gather>` TwiML.
3. **Knowledge Retrieval**: Sends a customer question and verifies assistant answers using verified tenant knowledge.
4. **Human Escalation**: Asks for a supervisor and verifies `<Dial>` bridge generation.
5. **Transfer Failover**: Simulates a busy agent and verifies automatic fallback callback ticket persistence.

---

## 3. Connecting a Real Phone Number via Ngrok & Twilio

To call your AI agent directly from your mobile phone:

### Step 1: Start the Public Tunnel
```bash
./scripts/sandbox/start-tunnel.sh
```
Note the HTTPS forwarding URL (e.g. `https://abc123.ngrok-free.app`).

### Step 2: Configure Twilio Phone Number
1. In the [Twilio Console](https://console.twilio.com/), go to **Phone Numbers** -> **Manage** -> **Active Numbers**.
2. Select your test phone number.
3. Under **Voice Configuration**:
   - **A CALL COMES IN**: `Webhook`
   - **URL**: `https://<YOUR_TUNNEL_DOMAIN>/api/v1/voice/inbound?tenantId=tenant_acme_hvac_001`
   - **HTTP METHOD**: `POST`
4. Under **Messaging Configuration** (SMS):
   - **A MESSAGE COMES IN**: `Webhook`
   - **URL**: `https://<YOUR_TUNNEL_DOMAIN>/api/v1/sms/inbound?tenantId=tenant_acme_hvac_001`
   - **HTTP METHOD**: `POST`
5. Click **Save Configuration**.

### Step 3: Dial the Number
Dial the Twilio phone number from your mobile phone. You will hear:
> *"Thank you for calling Acme HVAC. I am an AI assistant. This call may be recorded for quality assurance. How can I help you today?"*

Speak naturally to ask about operating hours, diagnostic fees, or request a human agent.

---

## 4. Testing Inbound Email & WhatsApp Webhooks via cURL

### Test Inbound Email (SendGrid / Postmark style)
```bash
curl -X POST "http://localhost:3001/api/v1/email/inbound?tenantId=tenant_acme_hvac_001" \
  -H "Content-Type: application/json" \
  -d '{
    "From": "customer@example.com",
    "To": "support@acme-hvac.example.com",
    "Subject": "AC Filter Question",
    "TextBody": "How often should I change my central air filter?"
  }'
```

### Test WhatsApp Business Webhook Handshake
```bash
curl -G "http://localhost:3001/api/v1/whatsapp/webhook" \
  --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=customer_service_wa_verify_token" \
  --data-urlencode "hub.challenge=HANDSHAKE_OK"
```

### Test WhatsApp Inbound Message
```bash
curl -X POST "http://localhost:3001/api/v1/whatsapp/webhook?tenantId=tenant_acme_hvac_001" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "15551234567",
            "id": "wa_msg_001",
            "text": { "body": "What are your business hours?" },
            "type": "text"
          }]
        }
      }]
    }]
  }'
```
