import { eq, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import type { ChannelType } from '../conversation/types.js';

export interface JourneyEvent {
  id: string;
  conversationId: string;
  timestamp: string;
  channel: ChannelType;
  direction: 'inbound' | 'outbound';
  summary: string;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated';
  csatScore?: number;
  agentName?: string;
  durationSeconds?: number;
  status: string;
}

export interface Customer360Profile {
  id: string;
  tenantId: string;
  name: string;
  phoneNumbers: string[];
  emails: string[];
  externalId?: string;
  totalConversations: number;
  averageCsat?: number;
  lifetimeSentiment: 'positive' | 'neutral' | 'negative';
  journeyEvents: JourneyEvent[];
}

export class CustomerJourneyManager {
  private db: DatabaseInstance;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  public async buildCustomer360(
    tenantId: string,
    customerId: string
  ): Promise<Customer360Profile | null> {
    const [customer] = await this.db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId));

    if (!customer || customer.tenantId !== tenantId) {
      return null;
    }

    // Fetch all conversations for this customer
    const convs = await this.db
      .select({
        conv: schema.conversations,
        agent: schema.users,
      })
      .from(schema.conversations)
      .leftJoin(schema.users, eq(schema.conversations.assignedAgentId, schema.users.id))
      .where(eq(schema.conversations.customerId, customerId))
      .orderBy(desc(schema.conversations.createdAt));

    const journeyEvents: JourneyEvent[] = [];
    const csatScores: number[] = [];
    const sentiments: string[] = [];

    for (const row of convs) {
      const meta = (row.conv.metadata || {}) as Record<string, any>;
      const csat = meta.csatScore ? Number(meta.csatScore) : undefined;
      const sentiment = meta.sentiment as 'positive' | 'neutral' | 'negative' | 'frustrated' | undefined;

      if (csat !== undefined && !isNaN(csat)) {
        csatScores.push(csat);
      }
      if (sentiment) {
        sentiments.push(sentiment);
      }

      journeyEvents.push({
        id: `journey_${row.conv.id}`,
        conversationId: row.conv.id,
        timestamp: row.conv.createdAt.toISOString(),
        channel: row.conv.channel as ChannelType,
        direction: (meta.direction as 'inbound' | 'outbound') || 'inbound',
        summary: row.conv.summary || `Customer inquiry via ${row.conv.channel.toUpperCase()}`,
        sentiment,
        csatScore: csat,
        agentName: row.agent?.name || 'AI Assistant',
        durationSeconds: meta.durationSeconds ? Number(meta.durationSeconds) : undefined,
        status: row.conv.status,
      });
    }

    const averageCsat =
      csatScores.length > 0
        ? Number((csatScores.reduce((a, b) => a + b, 0) / csatScores.length).toFixed(1))
        : undefined;

    const positiveCount = sentiments.filter((s) => s === 'positive').length;
    const negativeCount = sentiments.filter((s) => s === 'negative' || s === 'frustrated').length;
    const lifetimeSentiment =
      negativeCount > positiveCount ? 'negative' : positiveCount > 0 ? 'positive' : 'neutral';

    const phoneNumbers = [customer.phoneNumber].filter(Boolean) as string[];
    const emails = [customer.email].filter(Boolean) as string[];

    return {
      id: customer.id,
      tenantId: customer.tenantId,
      name: customer.name || 'Anonymous Customer',
      phoneNumbers,
      emails,
      externalId: customer.externalId || undefined,
      totalConversations: convs.length,
      averageCsat,
      lifetimeSentiment,
      journeyEvents,
    };
  }

  public async mergeCustomers(
    tenantId: string,
    primaryCustomerId: string,
    secondaryCustomerId: string
  ): Promise<Customer360Profile> {
    // Re-link all conversations from secondary customer to primary customer
    await this.db
      .update(schema.conversations)
      .set({ customerId: primaryCustomerId })
      .where(eq(schema.conversations.customerId, secondaryCustomerId));

    // Delete secondary customer record
    await this.db
      .delete(schema.customers)
      .where(eq(schema.customers.id, secondaryCustomerId));

    const updated = await this.buildCustomer360(tenantId, primaryCustomerId);
    if (!updated) {
      throw new Error(`Failed to load merged profile for customer ${primaryCustomerId}`);
    }
    return updated;
  }
}
