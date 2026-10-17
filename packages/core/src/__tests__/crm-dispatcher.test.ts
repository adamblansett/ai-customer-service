import { describe, it, expect, vi } from 'vitest';
import {
  CrmDispatcher,
  CallbackWebhookPayload,
  CrmDispatcherConfig,
} from '../escalation/crm-dispatcher.js';

describe('CRM & External Helpdesk Webhook Dispatcher', () => {
  const sampleCallback: CallbackWebhookPayload = {
    callbackId: 'cb_test_001',
    tenantId: 'tenant_acme_hvac_001',
    callerPhone: '+15551234567',
    requestedAt: '2026-10-16T12:00:00Z',
    preferredTime: 'Tomorrow morning',
    reason: 'Emergency furnace repair - after hours',
    status: 'pending',
    conversationId: 'conv_voice_001',
  };

  it('generates consistent HMAC-SHA256 signature', () => {
    const payload = JSON.stringify({ test: 'data' });
    const secret = 'super_secret_webhook_key_123';

    const sig = CrmDispatcher.generateSignature(payload, secret);
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

    // Verify deterministic signature for identical payload
    const sig2 = CrmDispatcher.generateSignature(payload, secret);
    expect(sig).toBe(sig2);
  });

  describe('Provider Formatting', () => {
    it('formats HubSpot ticket payload correctly', () => {
      const formatted = CrmDispatcher.formatPayload(sampleCallback, 'hubspot');

      expect(formatted.properties).toBeDefined();
      expect(formatted.properties.hs_ticket_priority).toBe('HIGH');
      expect(formatted.properties.customer_phone).toBe('+15551234567');
      expect(formatted.properties.subject).toContain('+15551234567');
      expect(formatted.properties.content).toContain('Emergency furnace repair');
    });

    it('formats Zendesk ticket payload correctly', () => {
      const formatted = CrmDispatcher.formatPayload(sampleCallback, 'zendesk');

      expect(formatted.ticket).toBeDefined();
      expect(formatted.ticket.subject).toContain('+15551234567');
      expect(formatted.ticket.priority).toBe('urgent');
      expect(formatted.ticket.comment.body).toContain('Emergency furnace repair');
    });

    it('formats Salesforce Case payload correctly', () => {
      const formatted = CrmDispatcher.formatPayload(sampleCallback, 'salesforce');

      expect(formatted.Subject).toContain('+15551234567');
      expect(formatted.Priority).toBe('High');
      expect(formatted.Origin).toBe('Phone');
      expect(formatted.Description).toContain('Emergency furnace repair');
    });

    it('formats Generic webhook envelope correctly', () => {
      const formatted = CrmDispatcher.formatPayload(sampleCallback, 'generic');

      expect(formatted.event).toBe('callback.created');
      expect(formatted.data).toEqual(sampleCallback);
    });
  });

  describe('HTTP Dispatching & Signature Headers', () => {
    it('successfully dispatches signed webhook to external endpoint', async () => {
      let interceptedUrl = '';
      let interceptedHeaders: any = {};
      let interceptedBody = '';

      const mockFetch = vi.fn().mockImplementation(async (url, init) => {
        interceptedUrl = url;
        interceptedHeaders = init.headers;
        interceptedBody = init.body;

        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({ ticket_id: 'hubspot_tk_9999' }),
        };
      });

      const config: CrmDispatcherConfig = {
        provider: 'hubspot',
        endpointUrl: 'https://api.hubapi.com/crm/v3/objects/tickets',
        apiKey: 'pat-na1-12345678',
        signingSecret: 'my_webhook_secret',
      };

      const result = await CrmDispatcher.dispatch(config, sampleCallback, mockFetch as any);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(201);
      expect(result.provider).toBe('hubspot');
      expect(interceptedUrl).toBe('https://api.hubapi.com/crm/v3/objects/tickets');
      expect(interceptedHeaders['Authorization']).toBe('Bearer pat-na1-12345678');
      expect(interceptedHeaders['X-Customer-Service-Signature']).toMatch(/^sha256=/);

      const parsedBody = JSON.parse(interceptedBody);
      expect(parsedBody.properties.customer_phone).toBe('+15551234567');
    });

    it('handles remote server 500 error gracefully', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }));

      const config: CrmDispatcherConfig = {
        provider: 'zendesk',
        endpointUrl: 'https://acme.zendesk.com/api/v2/tickets.json',
      };

      const result = await CrmDispatcher.dispatch(config, sampleCallback, mockFetch as any);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.responseBody).toBe('Internal Server Error');
    });

    it('catches network abort / timeout exceptions without crashing', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network connection timeout'));

      const config: CrmDispatcherConfig = {
        provider: 'salesforce',
        endpointUrl: 'https://salesforce.example.com/services/data/v58.0/sobjects/Case',
      };

      const result = await CrmDispatcher.dispatch(config, sampleCallback, mockFetch as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network connection timeout');
    });
  });
});
