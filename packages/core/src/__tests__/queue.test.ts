import { describe, it, expect } from 'vitest';
import { CallQueueManager } from '../escalation/queue.js';

describe('Contact Center Queues & Automatic Call Distribution (ACD)', () => {
  it('manages call queuing with priority ordering', () => {
    const queue = new CallQueueManager();
    const tenantId = 'tenant_acme';

    // Enqueue normal priority call
    const call1 = queue.enqueueCall({
      tenantId,
      callSid: 'CA_normal_1',
      callerPhone: '+15551112222',
      priority: 1,
    });

    // Enqueue emergency/VIP priority call
    const call2 = queue.enqueueCall({
      tenantId,
      callSid: 'CA_vip_2',
      callerPhone: '+15553334444',
      priority: 5,
    });

    const stats = queue.getQueueStats(tenantId);
    expect(stats.waitingCount).toBe(2);

    // Register an agent and verify VIP call is assigned first!
    queue.registerAgent({
      agentId: 'agent_sarah',
      tenantId,
      name: 'Sarah Agent',
      status: 'idle',
      skills: ['general'],
    });

    const assignment = queue.tryAssignNextCall(tenantId);
    expect(assignment).not.toBeNull();
    expect(assignment?.call.callSid).toBe('CA_vip_2'); // High priority was assigned first!
    expect(assignment?.agent.agentId).toBe('agent_sarah');
    expect(assignment?.agent.status).toBe('busy');
  });

  it('routes calls using longest-idle strategy', () => {
    const queue = new CallQueueManager();
    const tenantId = 'tenant_acme';

    // Agent 1 was assigned 10 minutes ago
    queue.registerAgent({
      agentId: 'agent_1',
      tenantId,
      name: 'Agent One',
      status: 'idle',
      skills: ['general'],
      lastAssignedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    // Agent 2 was assigned 2 minutes ago
    queue.registerAgent({
      agentId: 'agent_2',
      tenantId,
      name: 'Agent Two',
      status: 'idle',
      skills: ['general'],
      lastAssignedAt: new Date(Date.now() - 2 * 60 * 1000),
    });

    queue.enqueueCall({
      tenantId,
      callSid: 'CA_test_longest_idle',
      callerPhone: '+15550001111',
    });

    const assignment = queue.tryAssignNextCall(tenantId, 'longest-idle');
    expect(assignment?.agent.agentId).toBe('agent_1'); // Longest idle agent assigned
  });

  it('enforces skills-based routing constraints', () => {
    const queue = new CallQueueManager();
    const tenantId = 'tenant_acme';

    // General support agent
    queue.registerAgent({
      agentId: 'agent_billing',
      tenantId,
      name: 'Billing Agent',
      status: 'idle',
      skills: ['billing'],
    });

    // HVAC certified technician
    queue.registerAgent({
      agentId: 'agent_tech',
      tenantId,
      name: 'Tech Specialist',
      status: 'idle',
      skills: ['hvac_emergency'],
    });

    // Enqueue emergency heating repair call
    queue.enqueueCall({
      tenantId,
      callSid: 'CA_emergency_furnace',
      callerPhone: '+15559998888',
      requiredSkills: ['hvac_emergency'],
    });

    const assignment = queue.tryAssignNextCall(tenantId, 'skills-based');
    expect(assignment?.agent.agentId).toBe('agent_tech'); // Assigned to skilled technician, not billing agent!
  });

  it('handles caller abandonment with dequeueCall', () => {
    const queue = new CallQueueManager();
    const tenantId = 'tenant_acme';

    queue.enqueueCall({
      tenantId,
      callSid: 'CA_caller_hung_up',
      callerPhone: '+15557778888',
    });

    expect(queue.getQueueStats(tenantId).waitingCount).toBe(1);

    const dequeued = queue.dequeueCall(tenantId, 'CA_caller_hung_up');
    expect(dequeued).toBe(true);
    expect(queue.getQueueStats(tenantId).waitingCount).toBe(0);
  });
});
