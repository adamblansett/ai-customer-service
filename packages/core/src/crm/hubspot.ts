import { CrmConnector, CrmContact, CrmCallActivity, CrmSyncResult } from './types.js';

export interface HubspotConfig {
  accessToken: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class HubspotCrmConnector implements CrmConnector {
  public readonly provider = 'hubspot';
  private accessToken: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(config: HubspotConfig) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl || 'https://api.hubapi.com').replace(/\/+$/, '');
    this.fetchFn = config.fetchFn || fetch.bind(globalThis);
  }

  public async upsertContact(contact: Partial<CrmContact>): Promise<CrmSyncResult> {
    try {
      const properties: Record<string, string> = {};
      if (contact.email) properties.email = contact.email;
      if (contact.phone) properties.phone = contact.phone;
      if (contact.firstName) properties.firstname = contact.firstName;
      if (contact.lastName) properties.lastname = contact.lastName;
      if (contact.company) properties.company = contact.company;

      if (contact.customProperties) {
        for (const [key, value] of Object.entries(contact.customProperties)) {
          properties[key] = String(value);
        }
      }

      let url: string;
      let method: string;

      if (contact.externalId) {
        url = `${this.baseUrl}/crm/v3/objects/contacts/${contact.externalId}`;
        method = 'PATCH';
      } else {
        url = `${this.baseUrl}/crm/v3/objects/contacts`;
        method = 'POST';
      }

      const res = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          success: false,
          provider: this.provider,
          error: `HubSpot contact upsert failed: ${res.status} ${errorText}`,
        };
      }

      const data = (await res.json()) as { id: string };
      return {
        success: true,
        externalId: data.id || contact.externalId,
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
      const properties: Record<string, any> = {
        hs_timestamp: activity.timestamp.toISOString(),
        hs_call_title: `Call: ${activity.direction === 'inbound' ? 'Inbound' : 'Outbound'}`,
        hs_call_body: activity.summary,
        hs_call_duration: String(activity.durationSeconds * 1000), // milliseconds in HubSpot
        hs_call_status: 'COMPLETED',
        hs_call_direction: activity.direction.toUpperCase(),
        ...(activity.recordingUrl ? { hs_call_recording_url: activity.recordingUrl } : {}),
      };

      const associations = activity.contactId
        ? [
            {
              to: { id: activity.contactId },
              types: [
                {
                  associationCategory: 'HUBSPOT_DEFINED',
                  associationTypeId: 194, // Call to Contact
                },
              ],
            },
          ]
        : [];

      const url = `${this.baseUrl}/crm/v3/objects/calls`;
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties, associations }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          success: false,
          provider: this.provider,
          error: `HubSpot call logging failed: ${res.status} ${errorText}`,
        };
      }

      const data = (await res.json()) as { id: string };
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
      const url = `${this.baseUrl}/crm/v3/objects/contacts/search`;
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'phone',
                  operator: 'EQ',
                  value: phone,
                },
              ],
            },
          ],
          properties: ['firstname', 'lastname', 'email', 'phone', 'company'],
          limit: 1,
        }),
      });

      if (!res.ok) return null;

      const data = (await res.json()) as { total: number; results: any[] };
      if (!data.results || data.results.length === 0) return null;

      const contactObj = data.results[0];
      const props = contactObj.properties || {};

      return {
        externalId: contactObj.id,
        firstName: props.firstname,
        lastName: props.lastname,
        email: props.email,
        phone: props.phone || phone,
        company: props.company,
      };
    } catch {
      return null;
    }
  }
}
