import { randomUUID } from 'node:crypto';
import type { ConversationManager } from '../conversation/manager.js';

export interface DncEntry {
  phoneNumber: string;
  reason: string;
  source: string;
  addedAt: Date;
}

export class DncRegistry {
  private static store: Map<string, Map<string, DncEntry>> = new Map();

  private static normalizePhone(phone: string): string {
    const cleaned = phone.replace(/[^0-9+]/g, '');
    if (!cleaned.startsWith('+') && cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    return cleaned;
  }

  public static addNumber(
    tenantId: string,
    phoneNumber: string,
    reason: string = 'User requested opt-out',
    source: string = 'system'
  ): DncEntry {
    if (!this.store.has(tenantId)) {
      this.store.set(tenantId, new Map());
    }

    const normalized = this.normalizePhone(phoneNumber);
    const entry: DncEntry = {
      phoneNumber: normalized,
      reason,
      source,
      addedAt: new Date(),
    };

    this.store.get(tenantId)!.set(normalized, entry);
    return entry;
  }

  public static removeNumber(tenantId: string, phoneNumber: string): boolean {
    const tenantMap = this.store.get(tenantId);
    if (!tenantMap) return false;
    return tenantMap.delete(this.normalizePhone(phoneNumber));
  }

  public static isListed(tenantId: string, phoneNumber: string): boolean {
    const tenantMap = this.store.get(tenantId);
    if (!tenantMap) return false;
    return tenantMap.has(this.normalizePhone(phoneNumber));
  }

  public static listNumbers(tenantId: string): DncEntry[] {
    const tenantMap = this.store.get(tenantId);
    if (!tenantMap) return [];
    return Array.from(tenantMap.values());
  }

  public static checkOptOutKeywords(text: string): boolean {
    const trimmed = text.trim();
    // 1. Single word exact matches (case-insensitive)
    const exactSingleWords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    if (exactSingleWords.includes(trimmed.toUpperCase())) {
      return true;
    }

    // 2. Specific multi-word opt-out intent phrases
    const intentPhrases = [
      /do\s+not\s+call/i,
      /stop\s+calling/i,
      /stop\s+texting/i,
      /stop\s+messages/i,
      /opt\s*out/i,
      /remove\s+me/i,
      /unsubscribe\s+me/i,
      /cancel\s+my\s+subscription/i,
      /take\s+me\s+off/i,
    ];

    return intentPhrases.some((regex) => regex.test(trimmed));
  }

  public static clearForTesting(): void {
    this.store.clear();
  }
}

export class CallingHoursGuard {
  /**
   * TCPA compliance check: Outbound contact permitted between 08:00 and 21:00 recipient local time.
   */
  public static isWithinPermittedHours(
    timezone: string = 'America/New_York',
    date: Date = new Date()
  ): { allowed: boolean; currentHour: number; timezone: string; reason?: string } {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hourCycle: 'h23',
      });

      const parts = formatter.formatToParts(date);
      const hourPart = parts.find((p) => p.type === 'hour');
      const hour = hourPart ? parseInt(hourPart.value, 10) : date.getUTCHours();

      // Permitted between 08:00 (8 AM) and 21:00 (9 PM)
      const allowed = hour >= 8 && hour < 21;

      return {
        allowed,
        currentHour: hour,
        timezone,
        reason: allowed
          ? undefined
          : `Current local time in ${timezone} is ${hour}:00, outside TCPA permitted calling window (08:00 - 21:00).`,
      };
    } catch {
      // Fallback if invalid timezone specified
      const hour = date.getUTCHours();
      const allowed = hour >= 12 && hour < 25; // Approximate UTC window
      return { allowed, currentHour: hour, timezone: 'UTC' };
    }
  }
}

export interface CampaignRecipient {
  recipientPhone: string;
  recipientName?: string;
  recipientTimezone?: string;
  customVariables?: Record<string, string>;
}

export interface CampaignDispatchOptions {
  tenantId: string;
  campaignName: string;
  channel: 'sms' | 'voice';
  messageTemplate: string;
  recipients: CampaignRecipient[];
  bypassCallingHours?: boolean;
}

export interface CampaignDispatchResult {
  campaignName: string;
  totalRecipients: number;
  dispatchedCount: number;
  blockedDncCount: number;
  blockedHoursCount: number;
  failedCount: number;
  recipientOutcomes: Array<{
    recipientPhone: string;
    status: 'sent' | 'skipped_dnc' | 'skipped_calling_hours' | 'failed';
    reason?: string;
    conversationId?: string;
    renderedMessage?: string;
  }>;
}

export class OutboundCampaignManager {
  private conversationManager?: ConversationManager;

  constructor(conversationManager?: ConversationManager) {
    this.conversationManager = conversationManager;
  }

  public renderTemplate(template: string, recipient: CampaignRecipient): string {
    let rendered = template;
    const vars: Record<string, string> = {
      name: recipient.recipientName || 'Valued Customer',
      recipientName: recipient.recipientName || 'Valued Customer',
      phone: recipient.recipientPhone,
      ...(recipient.customVariables || {}),
    };

    for (const [key, val] of Object.entries(vars)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
      rendered = rendered.replace(regex, val);
    }

    return rendered;
  }

  public async dispatchCampaign(
    options: CampaignDispatchOptions,
    currentTime: Date = new Date()
  ): Promise<CampaignDispatchResult> {
    const result: CampaignDispatchResult = {
      campaignName: options.campaignName,
      totalRecipients: options.recipients.length,
      dispatchedCount: 0,
      blockedDncCount: 0,
      blockedHoursCount: 0,
      failedCount: 0,
      recipientOutcomes: [],
    };

    for (const recipient of options.recipients) {
      // 1. DNC check
      if (DncRegistry.isListed(options.tenantId, recipient.recipientPhone)) {
        result.blockedDncCount++;
        result.recipientOutcomes.push({
          recipientPhone: recipient.recipientPhone,
          status: 'skipped_dnc',
          reason: 'Number is registered on tenant Do-Not-Call (DNC) list.',
        });
        continue;
      }

      // 2. Calling hours check (TCPA)
      if (!options.bypassCallingHours) {
        const tz = recipient.recipientTimezone || 'America/New_York';
        const hoursCheck = CallingHoursGuard.isWithinPermittedHours(tz, currentTime);
        if (!hoursCheck.allowed) {
          result.blockedHoursCount++;
          result.recipientOutcomes.push({
            recipientPhone: recipient.recipientPhone,
            status: 'skipped_calling_hours',
            reason: hoursCheck.reason,
          });
          continue;
        }
      }

      // 3. Render template
      const renderedMessage = this.renderTemplate(options.messageTemplate, recipient);
      let convId: string = randomUUID();

      try {
        if (this.conversationManager) {
          const conv = await this.conversationManager.createConversation({
            tenantId: options.tenantId,
            channel: options.channel,
            metadata: {
              campaignName: options.campaignName,
              recipientPhone: recipient.recipientPhone,
              direction: 'outbound',
            },
          });
          convId = conv.id;

          await this.conversationManager.addMessage({
            conversationId: conv.id,
            tenantId: options.tenantId,
            senderType: 'ai_agent',
            content: renderedMessage,
            metadata: {
              outboundCampaign: options.campaignName,
              channel: options.channel,
            },
          });
        }

        result.dispatchedCount++;
        result.recipientOutcomes.push({
          recipientPhone: recipient.recipientPhone,
          status: 'sent',
          conversationId: convId,
          renderedMessage,
        });
      } catch (err: any) {
        result.failedCount++;
        result.recipientOutcomes.push({
          recipientPhone: recipient.recipientPhone,
          status: 'failed',
          reason: err.message || 'Dispatch delivery error',
        });
      }
    }

    return result;
  }
}
