import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import type { AiToolDefinition } from '../ai/types.js';

export type TicketingProvider = 'zendesk' | 'jira' | 'servicenow';

export const TICKETING_AI_TOOLS: AiToolDefinition[] = [
  {
    name: 'create_support_ticket',
    description:
      'Creates a tracked helpdesk/ITSM ticket in Zendesk, Jira Service Management, or ServiceNow when an issue requires engineering or back-office follow-up.',
    parameters: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Concise ticket summary.',
        },
        description: {
          type: 'string',
          description: 'Detailed context of the customer issue.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Ticket urgency level.',
        },
        provider: {
          type: 'string',
          enum: ['zendesk', 'jira', 'servicenow'],
          description: 'Target ticketing provider (defaults to zendesk).',
        },
      },
      required: ['subject', 'description'],
    },
  },
];

export class TicketingConnectorService {
  constructor(private db: DatabaseInstance) {}

  static generateExternalKey(provider: TicketingProvider): string {
    const num = crypto.randomInt(10000, 99999);
    if (provider === 'jira') return `SUP-${num}`;
    if (provider === 'servicenow') return `INC00${num}`;
    return `ZD-${num}`;
  }

  async createTicket(params: {
    tenantId: string;
    provider?: TicketingProvider;
    conversationId?: string;
    customerPhone?: string;
    subject: string;
    description: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    assignee?: string;
  }) {
    const provider: TicketingProvider = params.provider || 'zendesk';
    const externalKey = TicketingConnectorService.generateExternalKey(provider);

    const [ticket] = await this.db
      .insert(schema.externalTickets)
      .values({
        id: `tkt_${crypto.randomUUID()}`,
        tenantId: params.tenantId,
        provider,
        externalKey,
        conversationId: params.conversationId || null,
        customerPhone: params.customerPhone || null,
        subject: params.subject,
        description: params.description,
        priority: params.priority || 'normal',
        status: 'open',
        assignee: params.assignee || null,
      })
      .returning();

    return ticket;
  }

  async updateTicketStatus(
    tenantId: string,
    externalKey: string,
    status: 'open' | 'in_progress' | 'resolved' | 'closed'
  ) {
    const [updated] = await this.db
      .update(schema.externalTickets)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(schema.externalTickets.tenantId, tenantId),
          eq(schema.externalTickets.externalKey, externalKey)
        )
      )
      .returning();
    return updated || null;
  }

  async listTickets(tenantId: string) {
    return this.db
      .select()
      .from(schema.externalTickets)
      .where(eq(schema.externalTickets.tenantId, tenantId));
  }
}
