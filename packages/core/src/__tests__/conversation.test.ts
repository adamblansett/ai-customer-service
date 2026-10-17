import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase, closeDatabase } from '@customer-service/db';
import { seedDatabase } from '@customer-service/db';
import { ConversationManager } from '../conversation/manager.js';
import { validateStateTransition } from '../conversation/state-machine.js';
import { InvalidStateTransitionError } from '../conversation/types.js';
import { IdempotencyManager } from '../conversation/idempotency.js';

describe('Conversation Engine Subsystem', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let manager: ConversationManager;
  let tenant1Id: string;
  let tenant2Id: string;
  let agentUserId: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenant1Id = seed.tenant1Id;
    tenant2Id = seed.tenant2Id;
    agentUserId = seed.agentUserId;
    manager = new ConversationManager(db);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('State Machine & Transitions', () => {
    it('permits valid state transitions', () => {
      expect(validateStateTransition('active', 'waiting_agent')).toBe('waiting_agent');
      expect(validateStateTransition('waiting_agent', 'transferred')).toBe('transferred');
      expect(validateStateTransition('transferred', 'closed')).toBe('closed');
      expect(validateStateTransition('active', 'interrupted')).toBe('interrupted');
      expect(validateStateTransition('interrupted', 'active')).toBe('active');
    });

    it('rejects invalid state transitions from terminal states', () => {
      expect(() => validateStateTransition('closed', 'active')).toThrow(InvalidStateTransitionError);
      expect(() => validateStateTransition('closed', 'transferred')).toThrow(InvalidStateTransitionError);
      expect(() => validateStateTransition('failed', 'active')).toThrow(InvalidStateTransitionError);
    });

    it('rejects invalid transitions across non-adjacent states', () => {
      expect(() => validateStateTransition('transferred', 'active')).toThrow(InvalidStateTransitionError);
    });
  });

  describe('Conversation Lifecycle & Message Ordering', () => {
    it('creates conversation, appends ordered messages, and retrieves history', async () => {
      const conv = await manager.createConversation({
        tenantId: tenant1Id,
        channel: 'voice',
        customerId: 'cust_john_doe_001',
      });

      expect(conv.id).toBeDefined();
      expect(conv.status).toBe('active');

      // Append customer greeting
      const msg1 = await manager.addMessage({
        conversationId: conv.id,
        tenantId: tenant1Id,
        senderType: 'customer',
        content: 'Hi, my furnace is blowing cold air.',
      });

      // Append AI response with tool call metadata
      const msg2 = await manager.addMessage({
        conversationId: conv.id,
        tenantId: tenant1Id,
        senderType: 'ai_agent',
        content: 'I understand. Let me check our emergency heating policy.',
        toolCalls: [{ name: 'check_emergency_policy', args: { temp: 'freezing' } }],
      });

      const history = await manager.getConversationWithMessages({
        conversationId: conv.id,
        tenantId: tenant1Id,
      });

      expect(history).not.toBeNull();
      expect(history!.messages).toHaveLength(2);
      expect(history!.messages[0].id).toBe(msg1.id);
      expect(history!.messages[1].id).toBe(msg2.id);
      expect(history!.messages[1].toolCalls).toHaveLength(1);
    });

    it('handles human agent escalation and assignment', async () => {
      const conv = await manager.createConversation({
        tenantId: tenant1Id,
        channel: 'chat',
      });

      // Escalate
      const escalated = await manager.requestEscalation({
        conversationId: conv.id,
        tenantId: tenant1Id,
        reason: 'Customer requested human technician',
      });

      expect(escalated.status).toBe('waiting_agent');
      expect(escalated.escalationState).toBe('requested');
      expect(escalated.escalationReason).toBe('Customer requested human technician');

      // Assign agent
      const assigned = await manager.assignAgent({
        conversationId: conv.id,
        tenantId: tenant1Id,
        agentUserId,
      });

      expect(assigned.assignedAgentId).toBe(agentUserId);
      expect(assigned.status).toBe('active'); // Agent joined, active again

      // Close conversation safely
      const closed = await manager.updateStatus({
        conversationId: conv.id,
        tenantId: tenant1Id,
        newStatus: 'closed',
      });

      expect(closed.status).toBe('closed');
      expect(closed.closedAt).toBeDefined();
    });

    it('enforces tenant boundary on conversations and messages', async () => {
      const convA = await manager.createConversation({
        tenantId: tenant1Id,
        channel: 'voice',
      });

      // Tenant 2 attempts to add message to Tenant 1's conversation
      await expect(
        manager.addMessage({
          conversationId: convA.id,
          tenantId: tenant2Id, // Cross-tenant spoof attempt
          senderType: 'customer',
          content: 'Malicious cross-tenant inject',
        })
      ).rejects.toThrow(/ConversationNotFound/);

      // Tenant 2 attempts to fetch Tenant 1's conversation
      const crossTenantFetch = await manager.getConversationWithMessages({
        conversationId: convA.id,
        tenantId: tenant2Id,
      });

      expect(crossTenantFetch).toBeNull();
    });
  });

  describe('Idempotency Management', () => {
    it('detects duplicate events and caches results in memory', () => {
      const idempotency = new IdempotencyManager(60000);
      const key = idempotency.makeKey(tenant1Id, 'twilio', 'CallSid_CA12345_seq1');

      expect(idempotency.has(key)).toBe(false);

      idempotency.record(key, { twimlAction: 'gather' });

      expect(idempotency.has(key)).toBe(true);
      const record = idempotency.get(key);
      expect(record?.resultPayload).toEqual({ twimlAction: 'gather' });
    });

    it('supports asynchronous operations with distributed Redis adapter', async () => {
      const redisStore = new Map<string, string>();
      const mockRedis = {
        get: async (k: string) => redisStore.get(k) || null,
        set: async (k: string, v: string) => {
          redisStore.set(k, v);
          return 'OK';
        },
        exists: async (k: string) => (redisStore.has(k) ? 1 : 0),
        del: async (k: string) => {
          const had = redisStore.has(k);
          redisStore.delete(k);
          return had ? 1 : 0;
        },
      };

      const { RedisIdempotencyStorage } = await import('../conversation/idempotency.js');
      const redisStorage = new RedisIdempotencyStorage(mockRedis, { keyPrefix: 'test_idemp:' });
      const idempotency = new IdempotencyManager({ storage: redisStorage });

      const eventKey = idempotency.makeKey('tenant_xyz', 'twilio', 'evt_9999');

      expect(await idempotency.hasAsync(eventKey)).toBe(false);

      await idempotency.recordAsync(eventKey, { status: 'dispatched' });

      expect(await idempotency.hasAsync(eventKey)).toBe(true);
      const record = await idempotency.getAsync(eventKey);
      expect(record?.eventKey).toBe(eventKey);
      expect(record?.resultPayload).toEqual({ status: 'dispatched' });

      // Check key was saved in mockRedis with prefix
      expect(redisStore.has('test_idemp:' + eventKey)).toBe(true);
    });
  });
});

