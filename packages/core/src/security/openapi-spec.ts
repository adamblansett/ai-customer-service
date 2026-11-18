/**
 * OpenAPI 3.1.0 Specification Generator for the AI Customer Service & Contact Center Platform
 */

export function generateOpenApiSpec(baseUrl = 'http://localhost:3001') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Open-Source AI Customer Service & Contact Center Platform API',
      version: '0.1.0',
      license: {
        name: 'Apache-2.0',
        url: 'https://www.apache.org/licenses/LICENSE-2.0',
      },
      description:
        'Multi-tenant REST, Carrier Webhook (Twilio, Telnyx, Plivo), WebSocket Audio/Coaching, SCIM 2.0, and Server-Sent Events API powered by Built-In Open-Weights AI (Qwen 2.5, Llama 3.1/3.2, Mistral Small 24B, Faster-Whisper STT, Kokoro-82M TTS) and BYOK cloud providers.',
    },
    servers: [{ url: baseUrl, description: 'Primary API Server' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    tags: [
      { name: 'System & Observability', description: 'Liveness, readiness, Prometheus /metrics, and OpenAPI 3.1 spec' },
      { name: 'Built-In Open-Weights AI & Speech', description: '5 LLM presets, 3 Faster-Whisper STT presets, and 2 Kokoro/Piper TTS presets' },
      { name: 'Telephony & Carrier Webhooks', description: 'Twilio TwiML, Telnyx Call Control v2, Plivo XML, and AMD Voicemail Drop' },
      { name: 'Knowledge Base & Governance', description: 'Hybrid Vector + BM25 RAG, web/CSV/Zendesk ingestion, version snapshots & rollback' },
      { name: 'Appointments & Workforce (WFM)', description: 'Conflict-free 2-hour technician scheduling & Erlang-C 80/20 SLA forecasting' },
      { name: 'PCI-DSS Payments, CSAT & Incidents', description: 'Checkout links, masked DTMF card capture, CSAT surveys, Slack/Teams/PagerDuty alerts' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['System & Observability'],
          summary: 'Liveness probe',
          responses: { '200': { description: 'Service healthy' } },
        },
      },
      '/metrics': {
        get: {
          tags: ['System & Observability'],
          summary: 'Prometheus 0.0.4 metrics exposition',
          responses: { '200': { description: 'Prometheus text metrics' } },
        },
      },
      '/api/v1/tenants/{tenantId}/ai/builtin': {
        get: {
          tags: ['Built-In Open-Weights AI & Speech'],
          summary: 'Get active 3-tier AI resolution & all 5 open-weights LLM presets',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Active AI mode and available profiles' } },
        },
      },
      '/api/v1/tenants/{tenantId}/speech/builtin': {
        get: {
          tags: ['Built-In Open-Weights AI & Speech'],
          summary: 'Get active Faster-Whisper STT & Kokoro-82M / Piper TTS presets',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Active STT and TTS open-weights presets' } },
        },
      },
      '/api/v1/voice/inbound': {
        post: {
          tags: ['Telephony & Carrier Webhooks'],
          summary: 'Twilio inbound voice webhook (HMAC-SHA1 X-Twilio-Signature verified)',
          responses: { '200': { description: 'TwiML XML response' } },
        },
      },
      '/api/v1/voice/telnyx': {
        post: {
          tags: ['Telephony & Carrier Webhooks'],
          summary: 'Telnyx Call Control v2 webhook',
          responses: { '200': { description: 'Telnyx command JSON' } },
        },
      },
      '/api/v1/voice/plivo': {
        post: {
          tags: ['Telephony & Carrier Webhooks'],
          summary: 'Plivo inbound voice XML webhook (HMAC-SHA256 X-Plivo-Signature-V2 verified)',
          responses: { '200': { description: 'Plivo XML response' } },
        },
      },
      '/api/v1/tenants/{tenantId}/appointments': {
        get: {
          tags: ['Appointments & Workforce (WFM)'],
          summary: 'List scheduled technician appointments',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Appointment list and AI tool definitions' } },
        },
        post: {
          tags: ['Appointments & Workforce (WFM)'],
          summary: 'Book conflict-free 2-hour technician dispatch window',
          security: [{ bearerAuth: [] }],
          responses: { '201': { description: 'Confirmed appointment' } },
        },
      },
      '/api/v1/tenants/{tenantId}/workforce/forecast': {
        post: {
          tags: ['Appointments & Workforce (WFM)'],
          summary: 'Compute Erlang-C staffing forecast for 80/20 SLA target',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Erlang-C staffing forecast' } },
        },
      },
      '/api/v1/tenants/{tenantId}/knowledge/{docId}/versions': {
        get: {
          tags: ['Knowledge Base & Governance'],
          summary: 'List version history snapshots for a knowledge document',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Document revision history' } },
        },
      },
      '/api/v1/tenants/{tenantId}/knowledge/{docId}/rollback': {
        post: {
          tags: ['Knowledge Base & Governance'],
          summary: 'Rollback a knowledge document to a prior version and re-embed chunks',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Restored document and re-indexed chunks' } },
        },
      },
      '/api/v1/tenants/{tenantId}/ai/dataset-export': {
        get: {
          tags: ['Built-In Open-Weights AI & Speech'],
          summary: 'Export PII-redacted ShareGPT / Unsloth or OpenAI JSONL fine-tuning dataset',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Fine-tuning JSONL dataset' } },
        },
      },
      '/api/v1/tenants/{tenantId}/incidents/dispatch': {
        post: {
          tags: ['PCI-DSS Payments, CSAT & Incidents'],
          summary: 'Dispatch SLA breach or low-CSAT incident to Slack, Microsoft Teams & PagerDuty',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Formatted Slack Block Kit, Teams Adaptive Card & PagerDuty payloads' } },
        },
      },
    },
  };
}
