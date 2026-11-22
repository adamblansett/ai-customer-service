import crypto from 'node:crypto';
import type { DatabaseInstance } from '@customer-service/db';
import { ConversationManager } from '../conversation/manager.js';
import { KnowledgeRetriever } from '../knowledge/retriever.js';
import { OutputDlpGuard } from '../security/output-dlp.js';

export type SocialChannelKind =
  | 'apple_business'
  | 'instagram_dm'
  | 'facebook_messenger'
  | 'slack_connect';

export interface NormalizedSocialMessage {
  channel: SocialChannelKind;
  senderHandle: string;
  text: string;
  threadId?: string;
}

export class SocialChannelGateway {
  private conversations: ConversationManager;
  private retriever: KnowledgeRetriever;

  constructor(private db: DatabaseInstance) {
    this.conversations = new ConversationManager(db);
    this.retriever = new KnowledgeRetriever(db);
  }

  /**
   * Verifies Slack `X-Slack-Signature` (`v0=<hmac_sha256_of_v0:ts:rawBody>`).
   */
  static verifySlackSignature(
    rawBody: string,
    timestampHeader: string,
    signatureHeader: string,
    signingSecret: string,
    toleranceSeconds = 300
  ): boolean {
    const ts = Number(timestampHeader);
    if (!Number.isFinite(ts) || !signatureHeader?.startsWith('v0=')) {
      return false;
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSeconds) {
      return false;
    }
    const baseString = `v0:${ts}:${rawBody}`;
    const expected = `v0=${crypto
      .createHmac('sha256', signingSecret)
      .update(baseString, 'utf8')
      .digest('hex')}`;
    const a = Buffer.from(signatureHeader, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Verifies Meta Instagram DM / Facebook Messenger `X-Hub-Signature-256` (`sha256=<hex>`).
   */
  static verifyMetaHubSignature(
    rawBody: string,
    signatureHeader: string,
    appSecret: string
  ): boolean {
    if (!signatureHeader?.startsWith('sha256=')) {
      return false;
    }
    const expected = `sha256=${crypto
      .createHmac('sha256', appSecret)
      .update(rawBody, 'utf8')
      .digest('hex')}`;
    const a = Buffer.from(signatureHeader, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Parses inbound payloads from Apple Messages for Business, Instagram DM, Messenger, or Slack Connect.
   */
  parseInboundWebhook(
    channel: SocialChannelKind,
    payload: Record<string, any>
  ): NormalizedSocialMessage | null {
    if (channel === 'apple_business') {
      const text = payload.body || payload.interactiveData?.data?.replyMessage?.title;
      if (!text) return null;
      return {
        channel: 'apple_business',
        senderHandle: String(payload.sourceId || payload.opaqueId || 'apple_user'),
        text: String(text),
        threadId: payload.id,
      };
    }

    if (channel === 'instagram_dm' || channel === 'facebook_messenger') {
      const messaging = payload.entry?.[0]?.messaging?.[0];
      const text = messaging?.message?.text;
      if (!text) return null;
      return {
        channel,
        senderHandle: String(messaging.sender?.id || 'meta_user'),
        text: String(text),
        threadId: messaging.message?.mid,
      };
    }

    if (channel === 'slack_connect') {
      const event = payload.event;
      if (!event || event.bot_id || !event.text) return null;
      return {
        channel: 'slack_connect',
        senderHandle: String(event.user || 'slack_customer'),
        text: String(event.text),
        threadId: String(event.thread_ts || event.ts || ''),
      };
    }

    return null;
  }

  /**
   * Routes inbound social message through the unified Conversation Engine + Hybrid RAG + Outbound DLP,
   * returning channel-native rich response payloads.
   */
  async handleInboundSocialMessage(tenantId: string, message: NormalizedSocialMessage) {
    const conv = await this.conversations.createConversation({
      tenantId,
      channel: message.channel,
      metadata: {
        senderHandle: message.senderHandle,
        threadId: message.threadId,
      },
    });

    await this.conversations.addMessage({
      conversationId: conv.id,
      tenantId,
      senderType: 'customer',
      senderId: message.senderHandle,
      content: message.text,
    });

    const docs = await this.retriever.search(tenantId, message.text, { limit: 2 });
    const rawReply =
      docs.length > 0
        ? `Based on our ${docs[0].documentTitle}: ${docs[0].content.slice(0, 260)}`
        : 'Thank you for reaching out! How can I assist you further, or would you like me to connect a live specialist?';

    const { sanitizedText } = OutputDlpGuard.sanitizeAiOutput(rawReply);

    await this.conversations.addMessage({
      conversationId: conv.id,
      tenantId,
      senderType: 'ai_agent',
      senderId: 'ai',
      content: sanitizedText,
    });

    return {
      conversationId: conv.id,
      channel: message.channel,
      replyText: sanitizedText,
      providerPayload: this.buildNativeReplyPayload(message, sanitizedText),
    };
  }

  private buildNativeReplyPayload(message: NormalizedSocialMessage, replyText: string) {
    if (message.channel === 'apple_business') {
      return {
        destinationId: message.senderHandle,
        type: 'text',
        body: replyText,
        quickReplies: ['Book Appointment', 'Check Order', 'Speak to Agent'],
      };
    }

    if (message.channel === 'instagram_dm' || message.channel === 'facebook_messenger') {
      return {
        recipient: { id: message.senderHandle },
        messaging_type: 'RESPONSE',
        message: {
          text: replyText,
          quick_replies: [
            { content_type: 'text', title: 'Book Service', payload: 'BOOK_SERVICE' },
            { content_type: 'text', title: 'Human Agent', payload: 'ESCALATE_AGENT' },
          ],
        },
      };
    }

    return {
      channel: message.senderHandle,
      thread_ts: message.threadId,
      text: replyText,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: replyText },
        },
      ],
    };
  }
}
