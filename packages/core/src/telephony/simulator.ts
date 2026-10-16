import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { TwimlAdapter } from './twiml-adapter.js';
import { ConversationManager } from '../conversation/manager.js';
import { EscalationEngine } from '../escalation/escalation-engine.js';
import { AiProvider } from '../ai/provider.interface.js';
import { ToolRegistry } from '../safety/tool-registry.js';
import crypto from 'node:crypto';

export interface SimulationResult {
  callSid: string;
  conversationId: string;
  callStatus: string;
  aiResponseText: string;
  twiml: string;
  transferInitiated: boolean;
  callbackCreated: boolean;
}

export class VoiceCallSimulator {
  private convManager: ConversationManager;
  private escalationEngine: EscalationEngine;
  private toolRegistry: ToolRegistry;

  constructor(
    private db: DatabaseInstance,
    private aiProvider: AiProvider
  ) {
    this.convManager = new ConversationManager(db);
    this.escalationEngine = new EscalationEngine(db);
    this.toolRegistry = new ToolRegistry(db);
  }

  /**
   * Simulates an incoming phone call from a customer.
   */
  async simulateCallStart(params: {
    tenantId: string;
    fromNumber: string;
    toNumber: string;
  }): Promise<SimulationResult> {
    const callSid = `sim_call_${crypto.randomUUID()}`;

    // 1. Fetch business settings for greeting & consent
    const [settings] = await this.db
      .select()
      .from(schema.businessSettings)
      .where(eq(schema.businessSettings.tenantId, params.tenantId));

    const greeting = settings?.aiGreeting || 'Hello, thank you for calling. How can I help you today?';
    const consent = settings?.recordingConsentRequired ? settings.recordingConsentText : null;

    // 2. Create conversation
    const conv = await this.convManager.createConversation({
      tenantId: params.tenantId,
      channel: 'voice',
      metadata: { callSid, from: params.fromNumber, to: params.toNumber },
    });

    // 3. Create call session record
    await this.db.insert(schema.callSessions).values({
      id: `session_${crypto.randomUUID()}`,
      tenantId: params.tenantId,
      conversationId: conv.id,
      callSid,
      provider: 'simulator',
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      direction: 'inbound',
      callStatus: 'in-progress',
    });

    // 4. Record initial AI greeting message
    await this.convManager.addMessage({
      conversationId: conv.id,
      tenantId: params.tenantId,
      senderType: 'ai_agent',
      content: greeting,
    });

    const twiml = TwimlAdapter.renderGreeting({
      greeting,
      recordingConsent: consent,
      actionUrl: `/api/v1/voice/events?callSid=${callSid}`,
    });

    return {
      callSid,
      conversationId: conv.id,
      callStatus: 'in-progress',
      aiResponseText: greeting,
      twiml,
      transferInitiated: false,
      callbackCreated: false,
    };
  }

  /**
   * Simulates speech utterance from the caller.
   */
  async simulateCallerUtterance(params: {
    tenantId: string;
    callSid: string;
    utterance: string;
    evaluationTime?: Date;
  }): Promise<SimulationResult> {
    // 1. Find call session and conversation
    const [callSession] = await this.db
      .select()
      .from(schema.callSessions)
      .where(
        and(
          eq(schema.callSessions.callSid, params.callSid),
          eq(schema.callSessions.tenantId, params.tenantId)
        )
      );

    if (!callSession) {
      throw new Error(`CallSessionNotFound: No call session found for SID '${params.callSid}'.`);
    }

    const conversationId = callSession.conversationId;

    // 2. Record caller message
    await this.convManager.addMessage({
      conversationId,
      tenantId: params.tenantId,
      senderType: 'customer',
      senderId: callSession.fromNumber,
      content: params.utterance,
    });

    // 3. Check for immediate explicit transfer keywords
    const lowerUtterance = params.utterance.toLowerCase();
    const needsTransfer =
      lowerUtterance.includes('transfer') ||
      lowerUtterance.includes('human') ||
      lowerUtterance.includes('representative') ||
      lowerUtterance.includes('person') ||
      lowerUtterance.includes('speak to someone');

    if (needsTransfer) {
      const decision = await this.escalationEngine.processEscalation({
        tenantId: params.tenantId,
        conversationId,
        callerPhone: callSession.fromNumber,
        reason: 'Caller requested human representative',
        evaluationTime: params.evaluationTime,
      });

      if (decision.type === 'transfer_call') {
        const twiml = TwimlAdapter.renderTransfer({
          destinationNumber: decision.destinationPhone!,
          actionUrl: `/api/v1/voice/transfer-status?callSid=${params.callSid}`,
          announcement: decision.announcement,
          timeoutSeconds: decision.timeoutSeconds,
        });

        await this.db
          .update(schema.callSessions)
          .set({
            transferDestination: decision.destinationPhone,
            transferStatus: 'initiated',
            updatedAt: new Date(),
          })
          .where(eq(schema.callSessions.callSid, params.callSid));

        return {
          callSid: params.callSid,
          conversationId,
          callStatus: 'transferring',
          aiResponseText: decision.announcement,
          twiml,
          transferInitiated: true,
          callbackCreated: false,
        };
      }

      if (decision.type === 'schedule_callback') {
        const twiml = TwimlAdapter.renderHangup({
          message: decision.announcement,
        });

        return {
          callSid: params.callSid,
          conversationId,
          callStatus: 'completed',
          aiResponseText: decision.announcement,
          twiml,
          transferInitiated: false,
          callbackCreated: true,
        };
      }
    }

    // 4. Generate AI response using Provider and permitted tools
    const history = await this.convManager.getConversationWithMessages({
      conversationId,
      tenantId: params.tenantId,
    });

    const aiMessages = (history?.messages || []).map(m => ({
      role: (m.senderType === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }));

    const aiResponse = await this.aiProvider.generate({
      messages: aiMessages,
      tools: this.toolRegistry.getPermittedToolDefinitions(),
    });

    let finalContent = aiResponse.content;

    // If AI triggered a tool call (e.g. knowledge lookup)
    if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
      for (const tc of aiResponse.toolCalls) {
        const toolResult = await this.toolRegistry.executeTool(tc.name, tc.arguments, {
          tenantId: params.tenantId,
          conversationId,
          callerPhone: callSession.fromNumber,
        });

        if (tc.name === 'lookup_knowledge' && toolResult.success && toolResult.data?.results?.length > 0) {
          finalContent = toolResult.data.results[0].content;
        } else if (tc.name === 'request_transfer_to_human') {
          const decision = await this.escalationEngine.processEscalation({
            tenantId: params.tenantId,
            conversationId,
            callerPhone: callSession.fromNumber,
            reason: tc.arguments.reason || 'AI requested transfer',
            evaluationTime: params.evaluationTime,
          });

          if (decision.type === 'transfer_call') {
            const twiml = TwimlAdapter.renderTransfer({
              destinationNumber: decision.destinationPhone!,
              actionUrl: `/api/v1/voice/transfer-status?callSid=${params.callSid}`,
              announcement: decision.announcement,
              timeoutSeconds: decision.timeoutSeconds,
            });

            return {
              callSid: params.callSid,
              conversationId,
              callStatus: 'transferring',
              aiResponseText: decision.announcement,
              twiml,
              transferInitiated: true,
              callbackCreated: false,
            };
          }
        }
      }
    }

    if (!finalContent) {
      finalContent = "I'm sorry, I don't have that information. Would you like me to transfer you to a human representative?";
    }

    // Record AI response
    await this.convManager.addMessage({
      conversationId,
      tenantId: params.tenantId,
      senderType: 'ai_agent',
      content: finalContent,
    });

    const twiml = TwimlAdapter.renderSpeechResponse({
      responseText: finalContent,
      actionUrl: `/api/v1/voice/events?callSid=${params.callSid}`,
    });

    return {
      callSid: params.callSid,
      conversationId,
      callStatus: 'in-progress',
      aiResponseText: finalContent,
      twiml,
      transferInitiated: false,
      callbackCreated: false,
    };
  }

  /**
   * Simulates transfer failure (e.g. agent busy or no answer)
   * Fallback captures a callback ticket.
   */
  async simulateTransferFailure(params: {
    tenantId: string;
    callSid: string;
    failureReason: 'timeout' | 'busy' | 'no-answer';
  }): Promise<{ twiml: string; callbackId: string; message: string }> {
    const [callSession] = await this.db
      .select()
      .from(schema.callSessions)
      .where(
        and(
          eq(schema.callSessions.callSid, params.callSid),
          eq(schema.callSessions.tenantId, params.tenantId)
        )
      );

    if (!callSession) {
      throw new Error(`CallSessionNotFound: SID '${params.callSid}'`);
    }

    const fallback = await this.escalationEngine.handleFailedTransfer({
      tenantId: params.tenantId,
      conversationId: callSession.conversationId,
      callerPhone: callSession.fromNumber,
      failureReason: params.failureReason,
    });

    await this.db
      .update(schema.callSessions)
      .set({
        transferStatus: 'failed',
        callStatus: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(schema.callSessions.callSid, params.callSid));

    const twiml = TwimlAdapter.renderHangup({
      message: fallback.message,
    });

    return {
      twiml,
      callbackId: fallback.callbackId,
      message: fallback.message,
    };
  }

  /**
   * Simulates caller hanging up.
   */
  async simulateCallEnd(params: {
    tenantId: string;
    callSid: string;
    durationSeconds: number;
  }) {
    const [callSession] = await this.db
      .select()
      .from(schema.callSessions)
      .where(
        and(
          eq(schema.callSessions.callSid, params.callSid),
          eq(schema.callSessions.tenantId, params.tenantId)
        )
      );

    if (!callSession) return;

    await this.db
      .update(schema.callSessions)
      .set({
        callStatus: 'completed',
        durationSeconds: params.durationSeconds,
        updatedAt: new Date(),
      })
      .where(eq(schema.callSessions.callSid, params.callSid));

    await this.convManager.updateStatus({
      conversationId: callSession.conversationId,
      tenantId: params.tenantId,
      newStatus: 'closed',
    });
  }
}
