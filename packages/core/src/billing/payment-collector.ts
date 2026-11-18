import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import type { AiToolDefinition } from '../ai/types.js';

export interface CreatePaymentLinkInput {
  tenantId: string;
  customerId?: string;
  conversationId?: string;
  customerPhone: string;
  description: string;
  amountCents: number;
  currency?: string;
}

export interface DtmfMaskedPaymentInput {
  tenantId: string;
  customerId?: string;
  conversationId?: string;
  customerPhone: string;
  description: string;
  amountCents: number;
  dtmfCardDigits: string;
  dtmfExpiryDigits?: string;
  dtmfCvvDigits?: string;
}

export const PAYMENT_AI_TOOLS: AiToolDefinition[] = [
  {
    name: 'send_payment_link',
    description:
      'Generates and sends a PCI-DSS compliant checkout payment link for a diagnostic fee or service invoice.',
    parameters: {
      type: 'object',
      properties: {
        customerPhone: { type: 'string', description: 'Customer phone number' },
        description: { type: 'string', description: 'Invoice or service description' },
        amountCents: {
          type: 'number',
          description: 'Amount in cents (e.g. 8900 for $89.00 diagnostic fee)',
        },
      },
      required: ['customerPhone', 'description', 'amountCents'],
    },
  },
];

export class PaymentCollector {
  constructor(private db: DatabaseInstance) {}

  /**
   * Lists all payment transactions for a tenant.
   */
  public async listPayments(tenantId: string) {
    const rows = await this.db
      .select()
      .from(schema.paymentTransactions)
      .where(eq(schema.paymentTransactions.tenantId, tenantId));

    return rows.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Creates a PCI-DSS out-of-band checkout payment link for SMS/Chat/Voice delivery.
   */
  public async createPaymentLink(input: CreatePaymentLinkInput) {
    if (input.amountCents <= 0) {
      throw new Error('Payment amountCents must be greater than zero.');
    }

    const paymentId = `pay_${crypto.randomUUID()}`;
    const token = crypto
      .createHmac('sha256', process.env.ENCRYPTION_MASTER_KEY || 'pci-checkout-key')
      .update(`${paymentId}:${input.tenantId}:${input.amountCents}`)
      .digest('hex')
      .slice(0, 16);

    const checkoutUrl = `https://pay.acme-hvac.example.com/checkout/${paymentId}?sig=${token}`;

    const [created] = await this.db
      .insert(schema.paymentTransactions)
      .values({
        id: paymentId,
        tenantId: input.tenantId,
        customerId: input.customerId || null,
        conversationId: input.conversationId || null,
        customerPhone: input.customerPhone,
        description: input.description,
        amountCents: input.amountCents,
        currency: input.currency || 'USD',
        paymentMethod: 'payment_link',
        checkoutUrl,
        status: 'pending',
      })
      .returning();

    return created;
  }

  /**
   * Processes an in-call DTMF keypad payment, immediately discarding raw PAN digits
   * so only the PCI-compliant last 4 digits (`****-****-****-1234`) touch storage or logs.
   */
  public async processDtmfMaskedPayment(input: DtmfMaskedPaymentInput) {
    const digitsOnly = (input.dtmfCardDigits || '').replace(/\D/g, '');
    if (digitsOnly.length < 13 || digitsOnly.length > 19) {
      throw new Error('PCIValidationError: Invalid DTMF card number length.');
    }

    const last4 = digitsOnly.slice(-4);
    const maskedCardLast4 = `****-****-****-${last4}`;

    const [paid] = await this.db
      .insert(schema.paymentTransactions)
      .values({
        id: `pay_${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        customerId: input.customerId || null,
        conversationId: input.conversationId || null,
        customerPhone: input.customerPhone,
        description: input.description,
        amountCents: input.amountCents,
        currency: 'USD',
        paymentMethod: 'dtmf_masked',
        maskedCardLast4,
        status: 'paid',
        paidAt: new Date(),
      })
      .returning();

    return paid;
  }
}
