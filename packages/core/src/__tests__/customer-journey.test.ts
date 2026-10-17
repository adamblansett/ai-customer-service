import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import { CustomerJourneyManager } from '../customer/index.js';

describe('Omnichannel Customer 360 & Journey Timeline Suite', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let tenantId: string;
  let journeyManager: CustomerJourneyManager;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenantId = seed.tenant1Id;
    journeyManager = new CustomerJourneyManager(db);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('aggregates unified customer 360 profile with multi-channel journey events and CSAT', async () => {
    const customerId = randomUUID();
    await db.insert(schema.customers).values({
      id: customerId,
      tenantId,
      name: 'Eleanor Vance',
      phoneNumber: '+15554329876',
      email: 'eleanor.vance@example.com',
    });

    // 1. Inbound Voice Call
    await db.insert(schema.conversations).values({
      id: randomUUID(),
      tenantId,
      customerId,
      channel: 'voice',
      status: 'closed',
      summary: 'Emergency heater failure reported. Troubleshooting advised.',
      metadata: {
        direction: 'inbound',
        csatScore: 5,
        sentiment: 'positive',
        durationSeconds: 245,
      },
    });

    // 2. Outbound SMS notification
    await db.insert(schema.conversations).values({
      id: randomUUID(),
      tenantId,
      customerId,
      channel: 'sms',
      status: 'closed',
      summary: 'Technician dispatch arrival confirmation SMS sent.',
      metadata: {
        direction: 'outbound',
        sentiment: 'neutral',
      },
    });

    // 3. Web Chat conversation
    await db.insert(schema.conversations).values({
      id: randomUUID(),
      tenantId,
      customerId,
      channel: 'chat',
      status: 'closed',
      summary: 'Customer checked invoice status after technician service.',
      metadata: {
        direction: 'inbound',
        csatScore: 4,
        sentiment: 'positive',
      },
    });

    const profile = await journeyManager.buildCustomer360(tenantId, customerId);

    expect(profile).not.toBeNull();
    expect(profile?.name).toBe('Eleanor Vance');
    expect(profile?.phoneNumbers).toContain('+15554329876');
    expect(profile?.emails).toContain('eleanor.vance@example.com');
    expect(profile?.totalConversations).toBe(3);
    expect(profile?.averageCsat).toBe(4.5); // (5 + 4) / 2
    expect(profile?.lifetimeSentiment).toBe('positive');
    expect(profile?.journeyEvents).toHaveLength(3);
    expect(profile?.journeyEvents.some((e) => e.channel === 'voice')).toBe(true);
    expect(profile?.journeyEvents.some((e) => e.channel === 'sms')).toBe(true);
    expect(profile?.journeyEvents.some((e) => e.channel === 'chat')).toBe(true);
  });

  it('merges secondary customer record into primary record and unifies conversations', async () => {
    const primaryId = randomUUID();
    const secondaryId = randomUUID();

    await db.insert(schema.customers).values([
      {
        id: primaryId,
        tenantId,
        name: 'Thomas Wayne',
        phoneNumber: '+15551113333',
        email: 'thomas@wayne.example.com',
      },
      {
        id: secondaryId,
        tenantId,
        name: 'T. Wayne',
        phoneNumber: '+15551113333',
      },
    ]);

    // Conversation attached to secondary
    await db.insert(schema.conversations).values({
      id: randomUUID(),
      tenantId,
      customerId: secondaryId,
      channel: 'voice',
      status: 'closed',
      summary: 'Old call from secondary identity record.',
      metadata: { csatScore: 5, sentiment: 'positive' },
    });

    const merged = await journeyManager.mergeCustomers(tenantId, primaryId, secondaryId);

    expect(merged.id).toBe(primaryId);
    expect(merged.totalConversations).toBe(1);

    // Verify secondary record deleted
    const [deletedRecord] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, secondaryId));
    expect(deletedRecord).toBeUndefined();
  });
});
