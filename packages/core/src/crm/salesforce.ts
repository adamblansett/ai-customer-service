import { CrmConnector, CrmContact, CrmCallActivity, CrmSyncResult } from './types.js';

export interface SalesforceConfig {
  instanceUrl: string;
  accessToken: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
}

export class SalesforceCrmConnector implements CrmConnector {
  public readonly provider = 'salesforce';
  private instanceUrl: string;
  private accessToken: string;
  private apiVersion: string;
  private fetchFn: typeof fetch;

  constructor(config: SalesforceConfig) {
    this.instanceUrl = config.instanceUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion || 'v59.0';
    this.fetchFn = config.fetchFn || fetch.bind(globalThis);
  }

  public async upsertContact(contact: Partial<CrmContact>): Promise<CrmSyncResult> {
    try {
      const payload: Record<string, any> = {
        FirstName: contact.firstName,
        LastName: contact.lastName || 'Unknown',
        Phone: contact.phone,
        Email: contact.email,
        ...(contact.company ? { Title: contact.company } : {}),
        ...(contact.customProperties || {}),
      };

      let url: string;
      let method: string;

      if (contact.externalId) {
        url = `${this.instanceUrl}/services/data/${this.apiVersion}/sobjects/Contact/${contact.externalId}`;
        method = 'PATCH';
      } else {
        url = `${this.instanceUrl}/services/data/${this.apiVersion}/sobjects/Contact`;
        method = 'POST';
      }

      const res = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          success: false,
          provider: this.provider,
          error: `Salesforce contact upsert failed: ${res.status} ${errorText}`,
        };
      }

      if (method === 'PATCH') {
        return {
          success: true,
          externalId: contact.externalId,
          provider: this.provider,
        };
      }

      const data = (await res.json()) as { id: string; success: boolean };
      return {
        success: true,
        externalId: data.id,
        provider: this.provider,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.provider,
        error: err.message,
      };
    }
  }

  public async logCallActivity(activity: CrmCallActivity): Promise<CrmSyncResult> {
    try {
      const payload: Record<string, any> = {
        Subject: `Call: ${activity.direction === 'inbound' ? 'Inbound' : 'Outbound'} (${activity.status})`,
        Status: 'Completed',
        Priority: 'Normal',
        TaskSubtype: 'Call',
        Description: `${activity.summary}${activity.recordingUrl ? `\nRecording: ${activity.recordingUrl}` : ''}`,
        CallDurationInSeconds: activity.durationSeconds,
        CallType: activity.direction === 'inbound' ? 'Inbound' : 'Outbound',
        ActivityDate: activity.timestamp.toISOString().split('T')[0],
        ...(activity.contactId ? { WhoId: activity.contactId } : {}),
      };

      const url = `${this.instanceUrl}/services/data/${this.apiVersion}/sobjects/Task`;
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          success: false,
          provider: this.provider,
          error: `Salesforce task creation failed: ${res.status} ${errorText}`,
        };
      }

      const data = (await res.json()) as { id: string; success: boolean };
      return {
        success: true,
        externalId: data.id,
        provider: this.provider,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.provider,
        error: err.message,
      };
    }
  }

  public async getContactByPhone(phone: string): Promise<CrmContact | null> {
    try {
      const sanitizedPhone = phone.replace(/[^+\d]/g, '');
      const query = encodeURIComponent(
        `SELECT Id, FirstName, LastName, Email, Phone, MobilePhone FROM Contact WHERE Phone = '${sanitizedPhone}' OR MobilePhone = '${sanitizedPhone}' LIMIT 1`
      );
      const url = `${this.instanceUrl}/services/data/${this.apiVersion}/query?q=${query}`;

      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) return null;

      const data = (await res.json()) as { totalSize: number; records: any[] };
      if (!data.records || data.records.length === 0) return null;

      const record = data.records[0];
      return {
        externalId: record.Id,
        firstName: record.FirstName,
        lastName: record.LastName,
        email: record.Email,
        phone: record.Phone || record.MobilePhone || phone,
      };
    } catch {
      return null;
    }
  }
}
