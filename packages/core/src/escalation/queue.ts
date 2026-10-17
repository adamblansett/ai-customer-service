import { EventEmitter } from 'node:events';

export type AgentStatus = 'idle' | 'busy' | 'offline';
export type QueueRoutingStrategy = 'longest-idle' | 'round-robin' | 'skills-based';

export interface AgentRecord {
  agentId: string;
  tenantId: string;
  name: string;
  status: AgentStatus;
  skills: string[];
  lastAssignedAt?: Date;
  activeCallSid?: string;
}

export interface QueuedCall {
  queueId: string;
  tenantId: string;
  callSid: string;
  callerPhone: string;
  priority: number; // Higher number = higher priority
  requiredSkills?: string[];
  enqueuedAt: Date;
  estimatedWaitSeconds: number;
}

export interface QueueStats {
  tenantId: string;
  waitingCount: number;
  availableAgentsCount: number;
  longestWaitSeconds: number;
  averageWaitSeconds: number;
}

export class CallQueueManager extends EventEmitter {
  private queues: Map<string, QueuedCall[]> = new Map(); // tenantId -> calls
  private agents: Map<string, AgentRecord> = new Map(); // agentId -> agent
  private roundRobinIndexes: Map<string, number> = new Map(); // tenantId -> index

  /**
   * Registers or updates an agent's presence and skills.
   */
  public registerAgent(agent: AgentRecord): void {
    this.agents.set(agent.agentId, { ...agent });
  }

  public setAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      if (status === 'idle') {
        agent.activeCallSid = undefined;
      }
    }
  }

  /**
   * Enqueues an inbound call waiting for a human agent.
   */
  public enqueueCall(params: {
    tenantId: string;
    callSid: string;
    callerPhone: string;
    priority?: number;
    requiredSkills?: string[];
    autoAssign?: boolean;
  }): QueuedCall {
    const {
      tenantId,
      callSid,
      callerPhone,
      priority = 1,
      requiredSkills = [],
      autoAssign = false,
    } = params;

    let tenantQueue = this.queues.get(tenantId);
    if (!tenantQueue) {
      tenantQueue = [];
      this.queues.set(tenantId, tenantQueue);
    }

    const availableAgents = this.getAvailableAgents(tenantId, requiredSkills);
    const estimatedWait = availableAgents.length > 0 ? 15 : (tenantQueue.length + 1) * 60;

    const queuedCall: QueuedCall = {
      queueId: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      tenantId,
      callSid,
      callerPhone,
      priority,
      requiredSkills,
      enqueuedAt: new Date(),
      estimatedWaitSeconds: estimatedWait,
    };

    // Insert sorted by priority descending, then enqueuedAt ascending
    tenantQueue.push(queuedCall);
    tenantQueue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.enqueuedAt.getTime() - b.enqueuedAt.getTime();
    });

    this.emit('callEnqueued', queuedCall);

    if (autoAssign) {
      this.tryAssignNextCall(tenantId);
    }

    return queuedCall;
  }


  /**
   * Attempts to match the top queued call with an available human agent.
   */
  public tryAssignNextCall(
    tenantId: string,
    strategy: QueueRoutingStrategy = 'longest-idle'
  ): { call: QueuedCall; agent: AgentRecord } | null {
    const tenantQueue = this.queues.get(tenantId);
    if (!tenantQueue || tenantQueue.length === 0) {
      return null;
    }

    for (let i = 0; i < tenantQueue.length; i++) {
      const call = tenantQueue[i];
      const eligibleAgents = this.getAvailableAgents(tenantId, call.requiredSkills);

      if (eligibleAgents.length > 0) {
        let selectedAgent: AgentRecord;

        if (strategy === 'round-robin') {
          const currentIndex = this.roundRobinIndexes.get(tenantId) || 0;
          selectedAgent = eligibleAgents[currentIndex % eligibleAgents.length];
          this.roundRobinIndexes.set(tenantId, currentIndex + 1);
        } else {
          // 'longest-idle' is the default
          selectedAgent = eligibleAgents.reduce((oldest, current) => {
            const oldestTime = oldest.lastAssignedAt?.getTime() || 0;
            const currentTime = current.lastAssignedAt?.getTime() || 0;
            return currentTime < oldestTime ? current : oldest;
          });
        }

        // Assign call
        tenantQueue.splice(i, 1);
        selectedAgent.status = 'busy';
        selectedAgent.activeCallSid = call.callSid;
        selectedAgent.lastAssignedAt = new Date();

        const assignment = { call, agent: selectedAgent };
        this.emit('callAssigned', assignment);
        return assignment;
      }
    }

    return null;
  }

  public getAvailableAgents(tenantId: string, requiredSkills: string[] = []): AgentRecord[] {
    return Array.from(this.agents.values()).filter((agent) => {
      if (agent.tenantId !== tenantId || agent.status !== 'idle') {
        return false;
      }
      if (requiredSkills.length > 0) {
        return requiredSkills.every((skill) => agent.skills.includes(skill));
      }
      return true;
    });
  }

  public getQueueStats(tenantId: string): QueueStats {
    const tenantQueue = this.queues.get(tenantId) || [];
    const availableAgents = this.getAvailableAgents(tenantId);
    const now = Date.now();

    let longestWait = 0;
    let totalWait = 0;

    for (const call of tenantQueue) {
      const wait = Math.floor((now - call.enqueuedAt.getTime()) / 1000);
      if (wait > longestWait) longestWait = wait;
      totalWait += wait;
    }

    const averageWait =
      tenantQueue.length > 0 ? Math.floor(totalWait / tenantQueue.length) : 0;

    return {
      tenantId,
      waitingCount: tenantQueue.length,
      availableAgentsCount: availableAgents.length,
      longestWaitSeconds: longestWait,
      averageWaitSeconds: averageWait,
    };
  }

  public dequeueCall(tenantId: string, callSid: string): boolean {
    const tenantQueue = this.queues.get(tenantId);
    if (!tenantQueue) return false;

    const idx = tenantQueue.findIndex((c) => c.callSid === callSid);
    if (idx !== -1) {
      tenantQueue.splice(idx, 1);
      return true;
    }
    return false;
  }
}
