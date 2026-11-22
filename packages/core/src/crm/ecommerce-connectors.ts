import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { ToolAuthorizationError } from '../safety/types.js';
import type { AiToolDefinition } from '../ai/types.js';

export const ECOMMERCE_AI_TOOLS: AiToolDefinition[] = [
  {
    name: 'check_order_status',
    description:
      'Looks up an e-commerce order (Shopify or WooCommerce) by order number to check shipping status, carrier tracking link, and return window eligibility.',
    parameters: {
      type: 'object',
      properties: {
        orderNumber: {
          type: 'string',
          description: 'The order number (e.g. "ORD-10042" or "#10042").',
        },
      },
      required: ['orderNumber'],
    },
  },
];

export interface UpsertOrderInput {
  tenantId: string;
  provider?: 'shopify' | 'woocommerce';
  orderNumber: string;
  customerEmail?: string;
  customerPhone?: string;
  fulfillmentStatus: 'unfulfilled' | 'in_transit' | 'delivered' | 'returned';
  financialStatus?: 'paid' | 'refunded' | 'pending';
  totalCents: number;
  currency?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  returnEligible?: boolean;
  items?: Array<{ sku: string; name: string; quantity: number }>;
}

export class EcommerceConnectorService {
  constructor(private db: DatabaseInstance) {}

  static normalizeOrderNumber(raw: string): string {
    return raw.trim().replace(/^#/, '').toUpperCase();
  }

  async upsertOrder(input: UpsertOrderInput) {
    const normalizedOrder = EcommerceConnectorService.normalizeOrderNumber(input.orderNumber);
    const [existing] = await this.db
      .select()
      .from(schema.externalOrders)
      .where(
        and(
          eq(schema.externalOrders.tenantId, input.tenantId),
          eq(schema.externalOrders.orderNumber, normalizedOrder)
        )
      );

    if (existing) {
      const [updated] = await this.db
        .update(schema.externalOrders)
        .set({
          fulfillmentStatus: input.fulfillmentStatus,
          financialStatus: input.financialStatus || existing.financialStatus,
          trackingNumber: input.trackingNumber ?? existing.trackingNumber,
          trackingUrl: input.trackingUrl ?? existing.trackingUrl,
          returnEligible: input.returnEligible ?? existing.returnEligible,
          items: input.items ?? existing.items,
        })
        .where(eq(schema.externalOrders.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(schema.externalOrders)
      .values({
        id: `ord_${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        provider: input.provider || 'shopify',
        orderNumber: normalizedOrder,
        customerEmail: input.customerEmail || null,
        customerPhone: input.customerPhone || null,
        fulfillmentStatus: input.fulfillmentStatus,
        financialStatus: input.financialStatus || 'paid',
        totalCents: input.totalCents,
        currency: input.currency || 'USD',
        trackingNumber: input.trackingNumber || null,
        trackingUrl: input.trackingUrl || null,
        returnEligible: input.returnEligible ?? true,
        items: input.items || [],
      })
      .returning();
    return created;
  }

  /**
   * Looks up an order for AI or agent triage while enforcing caller phone ownership if established.
   */
  async lookupOrder(params: {
    tenantId: string;
    orderNumber: string;
    callerPhone?: string;
  }) {
    const normalized = EcommerceConnectorService.normalizeOrderNumber(params.orderNumber);
    const [order] = await this.db
      .select()
      .from(schema.externalOrders)
      .where(
        and(
          eq(schema.externalOrders.tenantId, params.tenantId),
          eq(schema.externalOrders.orderNumber, normalized)
        )
      );

    if (!order) {
      return null;
    }

    if (params.callerPhone && order.customerPhone && order.customerPhone !== params.callerPhone) {
      throw new ToolAuthorizationError(
        `OrderAuthorizationError: Caller '${params.callerPhone}' is not authorized to inspect order '${normalized}'.`
      );
    }

    return order;
  }

  async listOrders(tenantId: string) {
    return this.db
      .select()
      .from(schema.externalOrders)
      .where(eq(schema.externalOrders.tenantId, tenantId));
  }

  /**
   * Ingests a Shopify `orders/updated` or WooCommerce `order.updated` webhook payload.
   */
  async ingestWebhookOrder(
    tenantId: string,
    provider: 'shopify' | 'woocommerce',
    payload: Record<string, any>
  ) {
    if (provider === 'shopify') {
      const fulfillments = Array.isArray(payload.fulfillments) ? payload.fulfillments : [];
      const firstFulfillment = fulfillments[0] || {};
      return this.upsertOrder({
        tenantId,
        provider: 'shopify',
        orderNumber: String(payload.name || payload.order_number || 'ORD-UNKNOWN'),
        customerEmail: payload.email || payload.customer?.email,
        customerPhone: payload.phone || payload.customer?.phone,
        fulfillmentStatus: payload.fulfillment_status === 'fulfilled' ? 'in_transit' : 'unfulfilled',
        financialStatus: payload.financial_status || 'paid',
        totalCents: Math.round(Number(payload.total_price || 0) * 100),
        currency: payload.currency || 'USD',
        trackingNumber: firstFulfillment.tracking_number,
        trackingUrl: firstFulfillment.tracking_url,
        items: (payload.line_items || []).map((li: any) => ({
          sku: li.sku || 'SKU',
          name: li.title || li.name || 'Item',
          quantity: Number(li.quantity || 1),
        })),
      });
    }

    return this.upsertOrder({
      tenantId,
      provider: 'woocommerce',
      orderNumber: `WC-${payload.number || payload.id}`,
      customerEmail: payload.billing?.email,
      customerPhone: payload.billing?.phone,
      fulfillmentStatus: payload.status === 'completed' ? 'delivered' : 'in_transit',
      financialStatus: payload.date_paid ? 'paid' : 'pending',
      totalCents: Math.round(Number(payload.total || 0) * 100),
      currency: payload.currency || 'USD',
      items: (payload.line_items || []).map((li: any) => ({
        sku: li.sku || 'WC-SKU',
        name: li.name || 'Item',
        quantity: Number(li.quantity || 1),
      })),
    });
  }
}
