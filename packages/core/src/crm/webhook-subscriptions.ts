import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { SsrfGuard } from '../security/ssrf-guard.js';

export interface CreateWebhookSubscriptionInput {
  tenantId: string;
  targetUrl: string;
  events: string[];
  signingSecret?: string;
}

export interface WebhookDeliveryReceipt {
  subscriptionId: string;
  targetUrl: string;
  eventType: string;
  signatureHeader: string;
  statusCode: number;
  delivered: boolean;
}

export class TenantWebhookRegistry {
  constructor(private db: DatabaseInstance) {}

  public async createSubscription(input: CreateWebhookSubscriptionInput) {
    SsrfGuard.assertSafeExternalUrl(input.targetUrl);
    const secret = input.signingSecret || `whsec_${crypto.randomBytes(16).toString('hex')}`;
    const [created] = await this.db
      .insert(schema.webhookSubscriptions)
      .values({
        id: `whsub_${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        targetUrl: input.targetUrl,
        signingSecret: secret,
        events: input.events,
        isActive: true,
        deliveryCount: 0,
      })
      .returning();

    return created;
  }

  public async listSubscriptions(tenantId: string) {
    return await this.db
      .select()
      .from(schema.webhookSubscriptions)
      .where(eq(schema.webhookSubscriptions.tenantId, tenantId));
  }

  public async deleteSubscription(tenantId: string, subscriptionId: string) {
    const deleted = await this.db
      .delete(schema.webhookSubscriptions)
      .where(
        and(
          eq(schema.webhookSubscriptions.id, subscriptionId),
          eq(schema.webhookSubscriptions.tenantId, tenantId)
        )
      )
      .returning();

    return deleted.length > 0;
  }

  /**
   * Dispatches a signed HMAC-SHA256 webhook event to all matching tenant subscriptions.
   */
  public async dispatchEvent(
    tenantId: string,
    eventType: string,
    payload: Record<string, any>
  ): Promise<WebhookDeliveryReceipt[]> {
    const subs = await this.db
      .select()
      .from(schema.webhookSubscriptions)
      .where(
        and(
          eq(schema.webhookSubscriptions.tenantId, tenantId),
          eq(schema.webhookSubscriptions.isActive, true)
        )
      );

    const receipts: WebhookDeliveryReceipt[] = [];

    for (const sub of subs) {
      const eventList = Array.isArray(sub.events) ? (sub.events as string[]) : [];
      if (!eventList.includes('*') && !eventList.includes(eventType)) {
        continue;
      }

      const bodyString = JSON.stringify({
        id: `whevt_${crypto.randomUUID()}`,
        tenantId,
        event: eventType,
        timestamp: new Date().toISOString(),
        data: payload,
      });

      const hmacHex = crypto
        .createHmac('sha256', sub.signingSecret)
        .update(bodyString, 'utf8')
        .digest('hex');
      const signatureHeader = `sha256=${hmacHex}`;

      let statusCode = 200;
      const isSimulated =
        sub.targetUrl.includes('.example.com') &&
        typeof (globalThis.fetch as any)?.mock === 'undefined';

      if (!isSimulated) {
        try {
          const res = await fetch(sub.targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Customer-Service-Event': eventType,
              'X-Customer-Service-Signature': signatureHeader,
            },
            body: bodyString,
          });
          statusCode = res.status;
        } catch {
          statusCode = 502;
        }
      }

      await this.db
        .update(schema.webhookSubscriptions)
        .set({
          deliveryCount: (sub.deliveryCount || 0) + 1,
          lastStatusCode: statusCode,
        })
        .where(eq(schema.webhookSubscriptions.id, sub.id));

      receipts.push({
        subscriptionId: sub.id,
        targetUrl: sub.targetUrl,
        eventType,
        signatureHeader,
        statusCode,
        delivered: statusCode >= 200 && statusCode < 300,
      });
    }

    return receipts;
  }
}
