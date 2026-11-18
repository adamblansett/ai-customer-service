import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';

export interface ErlangCInput {
  callsPerHour: number;
  averageHandleTimeSeconds: number;
  targetAnswerSeconds?: number; // default 20s
  targetSlaPercent?: number; // default 80%
}

export interface ErlangCForecast {
  callsPerHour: number;
  averageHandleTimeSeconds: number;
  trafficErlangs: number;
  recommendedAgents: number;
  expectedSlaPercent: number;
  occupancyPercent: number;
  averageSpeedOfAnswerSeconds: number;
}

export interface CreateShiftInput {
  tenantId: string;
  agentId: string;
  agentName: string;
  shiftDate: string; // YYYY-MM-DD
  startHour: number;
  endHour: number;
  roleSkill?: string;
}

export class WorkforceManager {
  constructor(private db: DatabaseInstance) {}

  /**
   * Computes Erlang-C contact center staffing requirements to achieve target SLA (e.g. 80% answered within 20s).
   */
  public calculateErlangCStaffing(input: ErlangCInput): ErlangCForecast {
    const callsPerHour = Math.max(1, input.callsPerHour);
    const aht = Math.max(10, input.averageHandleTimeSeconds);
    const targetSec = input.targetAnswerSeconds ?? 20;
    const targetSla = (input.targetSlaPercent ?? 80) / 100;

    // Traffic intensity in Erlangs (A)
    const A = (callsPerHour * aht) / 3600;
    let N = Math.floor(A) + 1;
    let sla = 0;
    let pWait = 1;

    for (let candidate = N; candidate <= Math.ceil(A) + 50; candidate++) {
      pWait = this.computeErlangCProbability(candidate, A);
      sla = 1 - pWait * Math.exp(-(candidate - A) * (targetSec / aht));
      if (sla >= targetSla) {
        N = candidate;
        break;
      }
    }

    const occupancy = Math.min(0.99, A / N);
    const asa = (pWait * aht) / Math.max(0.1, N - A);

    return {
      callsPerHour,
      averageHandleTimeSeconds: aht,
      trafficErlangs: Math.round(A * 100) / 100,
      recommendedAgents: N,
      expectedSlaPercent: Math.min(100, Math.round(sla * 1000) / 10),
      occupancyPercent: Math.round(occupancy * 1000) / 10,
      averageSpeedOfAnswerSeconds: Math.max(1, Math.round(asa * 10) / 10),
    };
  }

  private computeErlangCProbability(N: number, A: number): number {
    if (A <= 0) return 0;
    if (N <= A) return 1;

    // Compute Erlang-B iteratively to avoid factorial overflow
    let invB = 1.0;
    for (let k = 1; k <= N; k++) {
      invB = 1.0 + (k / A) * invB;
    }
    const erlangB = 1.0 / invB;
    const erlangC = (N * erlangB) / (N - A * (1 - erlangB));
    return Math.max(0, Math.min(1, erlangC));
  }

  public async createShift(input: CreateShiftInput) {
    const [created] = await this.db
      .insert(schema.agentShifts)
      .values({
        id: `shift_${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        agentId: input.agentId,
        agentName: input.agentName,
        shiftDate: input.shiftDate,
        startHour: input.startHour,
        endHour: input.endHour,
        roleSkill: input.roleSkill || 'general-inquiry',
        status: 'scheduled',
      })
      .returning();

    return created;
  }

  public async listShifts(tenantId: string, shiftDate?: string) {
    const rows = await this.db
      .select()
      .from(schema.agentShifts)
      .where(
        shiftDate
          ? and(
              eq(schema.agentShifts.tenantId, tenantId),
              eq(schema.agentShifts.shiftDate, shiftDate)
            )
          : eq(schema.agentShifts.tenantId, tenantId)
      );

    return rows.sort((a, b) => a.startHour - b.startHour);
  }
}
