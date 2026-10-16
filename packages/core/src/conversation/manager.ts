import { eq, and, asc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { ConversationStatus, ChannelType, SenderType } from './types.js';
import { validateStateTransition } from './state-machine.js';
import { assertTenantAccess, TenantContext } from '../security/tenant.js';
import crypto from 'node:crypto';

export class ConversationManager {
  constructor(private db: DatabaseInstance) {}

  /**
   * Starts a new tenant-scoped conversation across any supported channel.
   */
  async createConversation(params: {
    tenantId: string;
    channel: ChannelType;
    customerId?: string;
    initialStatus?: ConversationStatus;
    metadata?: Record<string, any>;
  }) {
    const id = `conv_${crypto.randomUUID()}`;
    const status = params.initialStatus || 'active';

    const [created] = await this.db
      .insert(schema.conversations)
      .values({
        id,
        tenantId: params.tenantId,
        customerId: params.customerId || null,
        channel: params.channel,
        status,
        escalationState: 'none',
        metadata: params.metadata || {},
      })
      .returning();

    return created;
  }

  /**
   * Appends an ordered message to the conversation.
   * Enforces tenant boundary matching.
   */
  async addMessage(params: {
    conversationId: string;
    tenantId: string;
    senderType: SenderType;
    content: string;
    senderId?: string;
    toolCalls?: any[];
    toolResults?: any[];
    metadata?: Record<string, any>;
  }) {
    // 1. Verify conversation exists and belongs to this tenant
    const [conv] = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, params.conversationId),
          eq(schema.conversations.tenantId, params.tenantId)
        )
      );

    if (!conv) {
      throw new Error(`ConversationNotFound: Conversation '${params.conversationId}' not found for tenant '${params.tenantId}'.`);
    }

    const messageId = `msg_${crypto.randomUUID()}`;

    const [createdMessage] = await this.db
      .insert(schema.messages)
      .values({
        id: messageId,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        senderType: params.senderType,
        senderId: params.senderId || null,
        content: params.content,
        toolCalls: params.toolCalls || [],
        toolResults: params.toolResults || [],
        metadata: params.metadata || {},
      })
      .returning();

    // Update conversation updatedAt timestamp
    await this.db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, params.conversationId));

    return createdMessage;
  }

  /**
   * Transitions conversation status adhering to the explicit state machine.
   */
  async updateStatus(params: {
    conversationId: string;
    tenantId: string;
    newStatus: ConversationStatus;
    reason?: string;
  }) {
    const [conv] = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, params.conversationId),
          eq(schema.conversations.tenantId, params.tenantId)
        )
      );

    if (!conv) {
      throw new Error(`ConversationNotFound: Conversation '${params.conversationId}' not found for tenant '${params.tenantId}'.`);
    }

    const currentStatus = conv.status as ConversationStatus;
    const validatedStatus = validateStateTransition(currentStatus, params.newStatus);

    const updatePayload: Record<string, any> = {
      status: validatedStatus,
      updatedAt: new Date(),
    };

    if (validatedStatus === 'closed') {
      updatePayload.closedAt = new Date();
    }

    const [updated] = await this.db
      .update(schema.conversations)
      .set(updatePayload)
      .where(eq(schema.conversations.id, params.conversationId))
      .returning();

    return updated;
  }

  /**
   * Assigns a human agent to the conversation and marks it active if previously waiting.
   */
  async assignAgent(params: {
    conversationId: string;
    tenantId: string;
    agentUserId: string;
  }) {
    const [conv] = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, params.conversationId),
          eq(schema.conversations.tenantId, params.tenantId)
        )
      );

    if (!conv) {
      throw new Error(`ConversationNotFound: Conversation '${params.conversationId}' not found.`);
    }

    const [updated] = await this.db
      .update(schema.conversations)
      .set({
        assignedAgentId: params.agentUserId,
        status: conv.status === 'waiting_agent' ? 'active' : conv.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.conversations.id, params.conversationId))
      .returning();

    return updated;
  }

  /**
   * Escalates the conversation to human assistance.
   */
  async requestEscalation(params: {
    conversationId: string;
    tenantId: string;
    reason: string;
  }) {
    const [conv] = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, params.conversationId),
          eq(schema.conversations.tenantId, params.tenantId)
        )
      );

    if (!conv) {
      throw new Error(`ConversationNotFound: Conversation '${params.conversationId}' not found.`);
    }

    // Validate transition to waiting_agent
    const currentStatus = conv.status as ConversationStatus;
    const nextStatus = validateStateTransition(currentStatus, 'waiting_agent');

    const [updated] = await this.db
      .update(schema.conversations)
      .set({
        status: nextStatus,
        escalationState: 'requested',
        escalationReason: params.reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.conversations.id, params.conversationId))
      .returning();

    return updated;
  }

  /**
   * Retrieves conversation details and chronological message thread.
   */
  async getConversationWithMessages(params: {
    conversationId: string;
    tenantId: string;
  }) {
    const [conv] = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, params.conversationId),
          eq(schema.conversations.tenantId, params.tenantId)
        )
      );

    if (!conv) {
      return null;
    }

    const messageList = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, params.conversationId),
          eq(schema.messages.tenantId, params.tenantId)
        )
      )
      .orderBy(asc(schema.messages.createdAt));

    return {
      conversation: conv,
      messages: messageList,
    };
  }
}
