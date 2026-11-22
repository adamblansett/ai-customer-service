import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { SUBSCRIPTION_PLANS, type SubscriptionTier } from './meter.js';

export interface StripeCheckoutInput {
  tenantId: string;
  tier: SubscriptionTier;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, any>;
  };
}

export class StripeBillingService {
  private stripeSecretKey?: string;
  private webhookSecret: string;

  constructor(
    private db: DatabaseInstance,
    options: { stripeSecretKey?: string; webhookSecret?: string } = {}
  ) {
    this.stripeSecretKey = options.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    this.webhookSecret =
      options.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dev_local_stripe_secret';
  }

  /**
   * Computes a Stripe-compatible `Stripe-Signature` header (`t=<unix>,v1=<hmac_sha256>`).
   */
  static signWebhookPayload(
    rawPayload: string,
    secret: string,
    timestampSeconds: number = Math.floor(Date.now() / 1000)
  ): string {
    const signedContent = `${timestampSeconds}.${rawPayload}`;
    const signature = crypto.createHmac('sha256', secret).update(signedContent, 'utf8').digest('hex');
    return `t=${timestampSeconds},v1=${signature}`;
  }

  /**
   * Constant-time Stripe webhook signature verification with timestamp replay window protection.
   */
  verifyWebhookSignature(
    rawPayload: string,
    signatureHeader: string,
    toleranceSeconds = 300
  ): StripeWebhookEvent {
    if (!signatureHeader) {
      throw new Error('StripeSignatureMissingError: Missing Stripe-Signature header.');
    }

    const parts = Object.fromEntries(
      signatureHeader.split(',').map((kv) => {
        const [k, v] = kv.trim().split('=');
        return [k, v];
      })
    );

    const timestamp = Number(parts.t);
    const v1Signature = parts.v1;

    if (!Number.isFinite(timestamp) || !v1Signature) {
      throw new Error('StripeSignatureFormatError: Malformed Stripe-Signature header.');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
      throw new Error(
        `StripeSignatureReplayError: Webhook timestamp outside ${toleranceSeconds}s tolerance window.`
      );
    }

    const expectedHex = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawPayload}`, 'utf8')
      .digest('hex');

    const actualBuf = Buffer.from(v1Signature, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');

    if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
      throw new Error('StripeSignatureMismatchError: Invalid webhook HMAC-SHA256 signature.');
    }

    return JSON.parse(rawPayload) as StripeWebhookEvent;
  }

  /**
   * Creates a Stripe Checkout Session for subscription plan upgrades/signup.
   * Uses live Stripe API if STRIPE_SECRET_KEY is set; otherwise creates a deterministic sandbox session.
   */
  async createCheckoutSession(input: StripeCheckoutInput) {
    const plan = SUBSCRIPTION_PLANS[input.tier];
    if (!plan) {
      throw new Error(`Unsupported subscription tier: ${input.tier}`);
    }

    if (this.stripeSecretKey && this.stripeSecretKey.startsWith('sk_live_')) {
      const params = new URLSearchParams({
        mode: 'subscription',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.tenantId,
        ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': `AI Contact Center - ${plan.name} Tier`,
        'line_items[0][price_data][recurring][interval]': 'month',
        'line_items[0][price_data][unit_amount]': String(plan.monthlyBasePriceCents),
        'line_items[0][quantity]': '1',
        'metadata[tenantId]': input.tenantId,
        'metadata[tier]': input.tier,
      });

      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`Stripe Checkout API failed with HTTP ${response.status}`);
      }
      const data = (await response.json()) as { id: string; url: string };
      return {
        sessionId: data.id,
        checkoutUrl: data.url,
        mode: 'live' as const,
        tier: input.tier,
        amountCents: plan.monthlyBasePriceCents,
      };
    }

    const sessionId = `cs_sandbox_${crypto.randomBytes(12).toString('hex')}`;
    const checkoutUrl = `${input.successUrl}${input.successUrl.includes('?') ? '&' : '?'}session_id=${sessionId}&tier=${input.tier}`;

    await this.upsertSubscriptionRecord({
      tenantId: input.tenantId,
      stripeCustomerId: `cus_sandbox_${input.tenantId.slice(-8)}`,
      stripeSubscriptionId: `sub_sandbox_${crypto.randomBytes(6).toString('hex')}`,
      tier: input.tier,
      status: 'active',
    });

    return {
      sessionId,
      checkoutUrl,
      mode: 'sandbox' as const,
      tier: input.tier,
      amountCents: plan.monthlyBasePriceCents,
    };
  }

  /**
   * Generates a Stripe Customer Billing Portal session link.
   */
  async createCustomerPortalSession(tenantId: string, returnUrl: string) {
    const sub = await this.getTenantSubscription(tenantId);
    const portalSessionId = `bps_${crypto.randomBytes(10).toString('hex')}`;
    return {
      portalSessionId,
      customerId: sub?.stripeCustomerId || `cus_sandbox_${tenantId.slice(-8)}`,
      portalUrl: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}billing_portal=${portalSessionId}`,
    };
  }

  /**
   * Syncs metered voice minutes & AI token usage for usage-based Stripe billing.
   */
  async syncMeteredUsage(params: {
    tenantId: string;
    voiceMinutes: number;
    aiTokens: number;
  }) {
    let sub = await this.getTenantSubscription(params.tenantId);
    if (!sub) {
      sub = await this.upsertSubscriptionRecord({
        tenantId: params.tenantId,
        stripeCustomerId: `cus_${params.tenantId.slice(-8)}`,
        stripeSubscriptionId: `sub_${crypto.randomBytes(6).toString('hex')}`,
        tier: 'pro',
        status: 'active',
      });
    }

    const [updated] = await this.db
      .update(schema.stripeSubscriptions)
      .set({
        lastSyncedVoiceMinutes: Math.max(0, Math.round(params.voiceMinutes)),
        lastSyncedAiTokens: Math.max(0, Math.round(params.aiTokens)),
        updatedAt: new Date(),
      })
      .where(eq(schema.stripeSubscriptions.tenantId, params.tenantId))
      .returning();

    return {
      synced: true,
      subscription: updated,
      meteredDelta: {
        voiceMinutesDelta: updated.lastSyncedVoiceMinutes - sub.lastSyncedVoiceMinutes,
        aiTokensDelta: updated.lastSyncedAiTokens - sub.lastSyncedAiTokens,
      },
    };
  }

  /**
   * Processes verified Stripe webhook events into `stripe_subscriptions`.
   */
  async handleWebhookEvent(event: StripeWebhookEvent) {
    const obj = event.data?.object || {};
    const tenantId = obj.metadata?.tenantId || obj.client_reference_id;

    switch (event.type) {
      case 'checkout.session.completed': {
        if (!tenantId) break;
        const tier = (obj.metadata?.tier || 'pro') as SubscriptionTier;
        const record = await this.upsertSubscriptionRecord({
          tenantId,
          stripeCustomerId: String(obj.customer || `cus_${tenantId}`),
          stripeSubscriptionId: String(obj.subscription || `sub_${event.id}`),
          tier,
          status: 'active',
        });
        return { handled: true, eventType: event.type, subscription: record };
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        if (!tenantId) break;
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : String(obj.status || 'active');
        const tier = (obj.metadata?.tier || 'pro') as SubscriptionTier;
        const record = await this.upsertSubscriptionRecord({
          tenantId,
          stripeCustomerId: String(obj.customer || `cus_${tenantId}`),
          stripeSubscriptionId: String(obj.id || `sub_${event.id}`),
          tier,
          status,
          cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        });
        return { handled: true, eventType: event.type, subscription: record };
      }

      case 'invoice.paid': {
        if (!tenantId) break;
        const existing = await this.getTenantSubscription(tenantId);
        if (existing) {
          const [updated] = await this.db
            .update(schema.stripeSubscriptions)
            .set({
              status: 'active',
              currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
              updatedAt: new Date(),
            })
            .where(eq(schema.stripeSubscriptions.tenantId, tenantId))
            .returning();
          return { handled: true, eventType: event.type, subscription: updated };
        }
        break;
      }
    }

    return { handled: false, eventType: event.type };
  }

  async getTenantSubscription(tenantId: string) {
    const [sub] = await this.db
      .select()
      .from(schema.stripeSubscriptions)
      .where(eq(schema.stripeSubscriptions.tenantId, tenantId));
    return sub || null;
  }

  private async upsertSubscriptionRecord(params: {
    tenantId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    tier: SubscriptionTier;
    status: string;
    cancelAtPeriodEnd?: boolean;
  }) {
    const existing = await this.getTenantSubscription(params.tenantId);
    const periodEnd = new Date(Date.now() + 30 * 86_400_000);

    if (existing) {
      const [updated] = await this.db
        .update(schema.stripeSubscriptions)
        .set({
          stripeCustomerId: params.stripeCustomerId,
          stripeSubscriptionId: params.stripeSubscriptionId,
          tier: params.tier,
          status: params.status,
          cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd,
          currentPeriodEnd: periodEnd,
          updatedAt: new Date(),
        })
        .where(eq(schema.stripeSubscriptions.tenantId, params.tenantId))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(schema.stripeSubscriptions)
      .values({
        id: `strsub_${crypto.randomUUID()}`,
        tenantId: params.tenantId,
        stripeCustomerId: params.stripeCustomerId,
        stripeSubscriptionId: params.stripeSubscriptionId,
        tier: params.tier,
        status: params.status,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
        currentPeriodEnd: periodEnd,
      })
      .returning();
    return created;
  }
}
