import { describe, it, expect, vi } from 'vitest';
import { SalesforceCrmConnector, HubspotCrmConnector } from '../crm/index.js';

describe('SalesforceCrmConnector', () => {
  it('should create contact when externalId is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sf_contact_123', success: true }),
    } as any);

    const connector = new SalesforceCrmConnector({
      instanceUrl: 'https://test.salesforce.com',
      accessToken: 'mock_token',
      fetchFn: mockFetch,
    });

    const result = await connector.upsertContact({
      firstName: 'Alice',
      lastName: 'Smith',
      phone: '+15551234567',
      email: 'alice@example.com',
      company: 'Acme Corp',
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('sf_contact_123');
    expect(result.provider).toBe('salesforce');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test.salesforce.com/services/data/v59.0/sobjects/Contact');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer mock_token');
    const body = JSON.parse(init.body);
    expect(body.FirstName).toBe('Alice');
    expect(body.LastName).toBe('Smith');
    expect(body.Phone).toBe('+15551234567');
  });

  it('should patch contact when externalId is present', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    } as any);

    const connector = new SalesforceCrmConnector({
      instanceUrl: 'https://test.salesforce.com',
      accessToken: 'mock_token',
      fetchFn: mockFetch,
    });

    const result = await connector.upsertContact({
      externalId: 'sf_contact_123',
      firstName: 'Alice',
      phone: '+15551234567',
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('sf_contact_123');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test.salesforce.com/services/data/v59.0/sobjects/Contact/sf_contact_123');
    expect(init.method).toBe('PATCH');
  });

  it('should log call activity as a Salesforce Task', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sf_task_456', success: true }),
    } as any);

    const connector = new SalesforceCrmConnector({
      instanceUrl: 'https://test.salesforce.com',
      accessToken: 'mock_token',
      fetchFn: mockFetch,
    });

    const result = await connector.logCallActivity({
      externalCallId: 'call_999',
      contactId: 'sf_contact_123',
      contactPhone: '+15551234567',
      direction: 'inbound',
      durationSeconds: 145,
      status: 'completed',
      summary: 'Customer called about billing inquiry. Resolved.',
      recordingUrl: 'https://s3.amazonaws.com/recordings/call_999.wav',
      timestamp: new Date('2026-10-17T10:00:00Z'),
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('sf_task_456');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test.salesforce.com/services/data/v59.0/sobjects/Task');
    const body = JSON.parse(init.body);
    expect(body.TaskSubtype).toBe('Call');
    expect(body.CallType).toBe('Inbound');
    expect(body.CallDurationInSeconds).toBe(145);
    expect(body.WhoId).toBe('sf_contact_123');
    expect(body.Description).toContain('Customer called about billing inquiry.');
    expect(body.Description).toContain('https://s3.amazonaws.com/recordings/call_999.wav');
  });

  it('should search contact by phone using SOQL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        totalSize: 1,
        records: [
          {
            Id: 'sf_contact_789',
            FirstName: 'Bob',
            LastName: 'Builder',
            Email: 'bob@example.com',
            Phone: '+15559876543',
          },
        ],
      }),
    } as any);

    const connector = new SalesforceCrmConnector({
      instanceUrl: 'https://test.salesforce.com',
      accessToken: 'mock_token',
      fetchFn: mockFetch,
    });

    const contact = await connector.getContactByPhone('+15559876543');
    expect(contact).not.toBeNull();
    expect(contact?.externalId).toBe('sf_contact_789');
    expect(contact?.firstName).toBe('Bob');
    expect(contact?.lastName).toBe('Builder');
  });
});

describe('HubspotCrmConnector', () => {
  it('should create contact in HubSpot', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'hs_contact_123' }),
    } as any);

    const connector = new HubspotCrmConnector({
      accessToken: 'hs_pat_token',
      fetchFn: mockFetch,
    });

    const result = await connector.upsertContact({
      firstName: 'Charlie',
      lastName: 'Day',
      email: 'charlie@paddys.com',
      phone: '+15550001111',
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('hs_contact_123');
    expect(result.provider).toBe('hubspot');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/contacts');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.properties.firstname).toBe('Charlie');
    expect(body.properties.email).toBe('charlie@paddys.com');
  });

  it('should log call activity with duration in ms and contact association', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'hs_call_456' }),
    } as any);

    const connector = new HubspotCrmConnector({
      accessToken: 'hs_pat_token',
      fetchFn: mockFetch,
    });

    const result = await connector.logCallActivity({
      externalCallId: 'call_abc',
      contactId: 'hs_contact_123',
      contactPhone: '+15550001111',
      direction: 'outbound',
      durationSeconds: 120,
      status: 'completed',
      summary: 'Appointment reminder confirmed.',
      timestamp: new Date('2026-10-17T11:00:00Z'),
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('hs_call_456');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/calls');
    const body = JSON.parse(init.body);
    expect(body.properties.hs_call_duration).toBe('120000'); // 120s * 1000
    expect(body.properties.hs_call_direction).toBe('OUTBOUND');
    expect(body.associations).toHaveLength(1);
    expect(body.associations[0].to.id).toBe('hs_contact_123');
  });

  it('should search contact by phone in HubSpot', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 1,
        results: [
          {
            id: 'hs_contact_999',
            properties: {
              firstname: 'Dennis',
              lastname: 'Reynolds',
              email: 'dennis@paddys.com',
              phone: '+15552223333',
            },
          },
        ],
      }),
    } as any);

    const connector = new HubspotCrmConnector({
      accessToken: 'hs_pat_token',
      fetchFn: mockFetch,
    });

    const contact = await connector.getContactByPhone('+15552223333');
    expect(contact).not.toBeNull();
    expect(contact?.externalId).toBe('hs_contact_999');
    expect(contact?.firstName).toBe('Dennis');
    expect(contact?.email).toBe('dennis@paddys.com');
  });
});
