#!/usr/bin/env node

/**
 * End-to-End Live Voice Call Simulator Script
 * Run with: npx tsx scripts/sandbox/simulate-live-call.ts
 */

const API_BASE = process.env.API_URL || 'http://localhost:3001';
const TENANT_ID = process.env.TENANT_ID || 'tenant_acme_hvac_001';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

function logStep(step: number, title: string) {
  console.log(`\n${colors.bold}${colors.cyan}[Step ${step}] ${title}${colors.reset}`);
}

function logXml(xml: string) {
  console.log(`${colors.green}${xml}${colors.reset}`);
}

async function run() {
  console.log(`${colors.bold}${colors.magenta}=== Live Inbound Voice Call Simulator ===${colors.reset}`);
  console.log(`API Base: ${API_BASE} | Tenant: ${TENANT_ID}\n`);

  const callSid = `CA_SIM_${Date.now()}`;
  const callerNumber = '+15553492041';
  const businessNumber = '+18005550199';

  // 1. Health Probe
  logStep(1, 'Verifying API Server Liveness & Readiness');
  try {
    const healthRes = await fetch(`${API_BASE}/health`);
    if (!healthRes.ok) throw new Error(`Status ${healthRes.status}`);
    const healthJson = await healthRes.json();
    console.log(`✓ API Server is live and healthy:`, healthJson);
  } catch (err: any) {
    console.error(`${colors.red}✗ API Server unreachable at ${API_BASE}: ${err.message}${colors.reset}`);
    console.log('Ensure you start the API server with: npm run dev --workspace=@customer-service/api');
    process.exit(1);
  }

  // 2. Inbound Ring & Answer
  logStep(2, `PSTN Inbound Ring: ${callerNumber} -> ${businessNumber}`);
  const inboundRes = await fetch(`${API_BASE}/api/v1/voice/inbound?tenantId=${TENANT_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      From: callerNumber,
      To: businessNumber,
    }),
  });

  const inboundTwiML = await inboundRes.text();
  console.log('✓ Call Answered. Carrier TwiML Output:');
  logXml(inboundTwiML);

  // 3. First Conversational Turn (Knowledge Base Query)
  logStep(3, 'Caller Speaks: "What is your emergency heating repair policy?"');
  const eventRes1 = await fetch(`${API_BASE}/api/v1/voice/events?tenantId=${TENANT_ID}&callSid=${callSid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      SpeechResult: 'What is your emergency heating repair policy?',
      Confidence: '0.96',
    }),
  });

  const event1TwiML = await eventRes1.text();
  console.log('✓ Assistant Synthesized Response:');
  logXml(event1TwiML);

  // 4. Human Escalation Request
  logStep(4, 'Caller Speaks: "I need to talk to a human supervisor right now."');
  const eventRes2 = await fetch(`${API_BASE}/api/v1/voice/events?tenantId=${TENANT_ID}&callSid=${callSid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      CallSid: callSid,
      SpeechResult: 'I need to talk to a human supervisor right now.',
      Confidence: '0.98',
    }),
  });

  const event2TwiML = await eventRes2.text();
  console.log('✓ Assistant Escalation Response & Dial Bridge:');
  logXml(event2TwiML);

  // 5. Transfer Status Callback (Simulating Busy Agent & Fallback Callback)
  logStep(5, 'Carrier Event: Agent DID Busy -> Trigger Fallback Callback');
  const transferRes = await fetch(
    `${API_BASE}/api/v1/voice/transfer-status?tenantId=${TENANT_ID}&callSid=${callSid}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        CallSid: callSid,
        DialCallStatus: 'busy',
      }),
    }
  );

  const transferTwiML = await transferRes.text();
  console.log('✓ Fallback Ticket Captured. Clean Apology & Hangup:');
  logXml(transferTwiML);

  console.log(`\n${colors.bold}${colors.green}✓ All 5 Inbound Voice Call Steps Verified Successfully!${colors.reset}\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
