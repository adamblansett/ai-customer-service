export interface CrmContact {
  id?: string;
  externalId?: string;
  email?: string;
  phone: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  customProperties?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CrmCallActivity {
  id?: string;
  externalCallId: string;
  contactId?: string;
  contactPhone: string;
  direction: 'inbound' | 'outbound';
  durationSeconds: number;
  status: 'completed' | 'failed' | 'in-progress' | 'busy' | 'no-answer';
  sentimentScore?: number;
  summary: string;
  recordingUrl?: string;
  timestamp: Date;
}

export interface CrmSyncResult {
  success: boolean;
  externalId?: string;
  provider: 'salesforce' | 'hubspot';
  error?: string;
  details?: Record<string, any>;
}

export interface CrmConnector {
  provider: 'salesforce' | 'hubspot';
  upsertContact(contact: Partial<CrmContact>): Promise<CrmSyncResult>;
  logCallActivity(activity: CrmCallActivity): Promise<CrmSyncResult>;
  getContactByPhone(phone: string): Promise<CrmContact | null>;
}
