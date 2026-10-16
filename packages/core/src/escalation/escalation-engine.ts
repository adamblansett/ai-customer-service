import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { evaluateOperatingHours, BusinessHoursMap } from './hours-evaluator.js';
import crypto from 'node:crypto';

export interface EscalationDecision {
  type: 'transfer_call' | 'schedule_callback' | 'voicemail' | 'ai_continue';
  destinationPhone?: string;
  timeoutSeconds: number;
  reason: string;
  announcement: string;
  callbackId?: string;
  summaryForAgent?: string;
}

const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export class EscalationEngine {
  constructor(private db: DatabaseInstance) {}

  /**
   * Evaluates an escalation request against business settings, operating hours, and authorized destinations.
   */
  async processEscalation(params: {
    tenantId: string;
    conversationId: string;
    callerPhone: string;
    reason: string;
    evaluationTime?: Date;
  }): Promise<EscalationDecision> {
    // 1. Fetch business settings
    const [settings] = await this.db
      .select()
      .from(schema.businessSettings)
      .where(eq(schema.businessSettings.tenantId, params.tenantId));

    if (!settings) {
      throw new Error(`BusinessSettingsNotFound: No business settings configured for tenant '${params.tenantId}'.`);
    }

    const hoursEvaluation = evaluateOperatingHours(
      (settings.businessHours || {}) as BusinessHoursMap,
      settings.timezone || 'America/New_York',
      params.evaluationTime || new Date()
    );

    // 2. If business is OPEN and valid fallbackPhone is configured:
    if (hoursEvaluation.isOpen && settings.fallbackPhone) {
      // Security check: Destination must be a valid E.164 phone
      if (!E164_PHONE_REGEX.test(settings.fallbackPhone)) {
        throw new Error(
          `InvalidDestinationError: Configured transfer phone '${settings.fallbackPhone}' is not a valid E.164 number.`
        );
      }

      // Generate handover summary
      const summary = await this.generateHandoffSummary(params.tenantId, params.conversationId, params.reason);

      // Update conversation state to waiting_agent
      await this.db
        .update(schema.conversations)
        .set({
          status: 'waiting_agent',
          escalationState: 'requested',
          escalationReason: params.reason,
          summary,
          updatedAt: new Date(),
        })
        .where(eq(schema.conversations.id, params.conversationId));

      return {
        type: 'transfer_call',
        destinationPhone: settings.fallbackPhone,
        timeoutSeconds: settings.transferTimeoutSeconds || 30,
        reason: params.reason,
        announcement: 'Please hold while I transfer you to the next available representative.',
        summaryForAgent: summary,
      };
    }

    // 3. If business is CLOSED (After-Hours):
    const behavior = settings.afterHoursBehavior || 'callback';

    if (behavior === 'callback') {
      const callbackId = `cb_${crypto.randomUUID()}`;
      await this.db.insert(schema.callbackRequests).values({
        id: callbackId,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        phoneNumber: params.callerPhone,
        reason: `[After-Hours] ${params.reason}`,
        status: 'pending',
      });

      return {
        type: 'schedule_callback',
        timeoutSeconds: 0,
        reason: params.reason,
        announcement: 'Our office is currently closed. I have scheduled a callback request for our team to contact you as soon as we open.',
        callbackId,
      };
    }

    if (behavior === 'voicemail') {
      return {
        type: 'voicemail',
        timeoutSeconds: 60,
        reason: params.reason,
        announcement: 'Our office is currently closed. Please leave a detailed message after the tone.',
      };
    }

    return {
      type: 'ai_continue',
      timeoutSeconds: 0,
      reason: params.reason,
      announcement: 'Our office is closed, but I can help answer questions with approved business information.',
    };
  }

  /**
   * Handles a failed transfer (e.g. agent busy, no answer, or provider timeout)
   * by automatically capturing a callback ticket so the caller is never abandoned.
   */
  async handleFailedTransfer(params: {
    tenantId: string;
    conversationId: string;
    callerPhone: string;
    failureReason: 'timeout' | 'busy' | 'no-answer' | 'error';
  }): Promise<{ callbackId: string; message: string }> {
    const callbackId = `cb_${crypto.randomUUID()}`;

    await this.db.insert(schema.callbackRequests).values({
      id: callbackId,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      phoneNumber: params.callerPhone,
      reason: `Failed transfer (${params.failureReason}): Caller was not connected to an agent.`,
      status: 'pending',
    });

    // Update conversation escalation state
    await this.db
      .update(schema.conversations)
      .set({
        escalationState: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(schema.conversations.id, params.conversationId));

    return {
      callbackId,
      message: 'All representatives are currently assisting other callers. We have logged your callback request and will call you back shortly.',
    };
  }

  /**
   * Creates a concise summary of the conversation for the human representative.
   */
  private async generateHandoffSummary(
    tenantId: string,
    conversationId: string,
    reason: string
  ): Promise<string> {
    const messages = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.tenantId, tenantId)
        )
      );

    const messageCount = messages.length;
    const lastCustomerMessage = [...messages].reverse().find(m => m.senderType === 'customer')?.content || 'None';

    return `Escalation Reason: ${reason} | Total Messages: ${messageCount} | Last Customer Inquiry: "${lastCustomerMessage}"`;
  }
}
