import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';

export interface CreateExperimentInput {
  tenantId: string;
  name: string;
  variantAModel?: string;
  variantAVoice?: string;
  variantAPrompt: string;
  variantBModel?: string;
  variantBVoice?: string;
  variantBPrompt: string;
}

export class ExperimentEngine {
  constructor(private db: DatabaseInstance) {}

  public async createExperiment(input: CreateExperimentInput) {
    const [created] = await this.db
      .insert(schema.abExperiments)
      .values({
        id: `exp_${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        name: input.name,
        variantAModel: input.variantAModel || 'qwen2.5:7b-instruct',
        variantAVoice: input.variantAVoice || 'af_heart',
        variantAPrompt: input.variantAPrompt,
        variantBModel: input.variantBModel || 'llama3.1:8b',
        variantBVoice: input.variantBVoice || 'af_bella',
        variantBPrompt: input.variantBPrompt,
        status: 'running',
      })
      .returning();

    return this.enrichMetrics(created);
  }

  /**
   * Deterministically assigns a call or session to Variant A or Variant B (50/50 split).
   */
  public assignVariant(experimentId: string, callOrSessionId: string): 'A' | 'B' {
    const digest = crypto
      .createHash('sha256')
      .update(`${experimentId}:${callOrSessionId}`)
      .digest();
    return digest[0] % 2 === 0 ? 'A' : 'B';
  }

  public async recordOutcome(
    tenantId: string,
    experimentId: string,
    variant: 'A' | 'B',
    outcome: { csatScore: number; resolved: boolean }
  ) {
    const [exp] = await this.db
      .select()
      .from(schema.abExperiments)
      .where(
        and(
          eq(schema.abExperiments.id, experimentId),
          eq(schema.abExperiments.tenantId, tenantId)
        )
      );

    if (!exp) {
      throw new Error(`Experiment ${experimentId} not found.`);
    }

    const updateValues =
      variant === 'A'
        ? {
            variantACalls: exp.variantACalls + 1,
            variantACsatSum: exp.variantACsatSum + outcome.csatScore,
            variantAResolved: exp.variantAResolved + (outcome.resolved ? 1 : 0),
          }
        : {
            variantBCalls: exp.variantBCalls + 1,
            variantBCsatSum: exp.variantBCsatSum + outcome.csatScore,
            variantBResolved: exp.variantBResolved + (outcome.resolved ? 1 : 0),
          };

    const [updated] = await this.db
      .update(schema.abExperiments)
      .set(updateValues)
      .where(eq(schema.abExperiments.id, experimentId))
      .returning();

    return this.enrichMetrics(updated);
  }

  public async listExperiments(tenantId: string) {
    const rows = await this.db
      .select()
      .from(schema.abExperiments)
      .where(eq(schema.abExperiments.tenantId, tenantId));

    return rows.map((r) => this.enrichMetrics(r));
  }

  private enrichMetrics(exp: typeof schema.abExperiments.$inferSelect) {
    const aAvgCsat =
      exp.variantACalls > 0
        ? Math.round((exp.variantACsatSum / exp.variantACalls) * 100) / 100
        : 0;
    const bAvgCsat =
      exp.variantBCalls > 0
        ? Math.round((exp.variantBCsatSum / exp.variantBCalls) * 100) / 100
        : 0;
    const aResolutionRate =
      exp.variantACalls > 0 ? Math.round((exp.variantAResolved / exp.variantACalls) * 100) : 0;
    const bResolutionRate =
      exp.variantBCalls > 0 ? Math.round((exp.variantBResolved / exp.variantBCalls) * 100) : 0;

    let winningVariant: 'A' | 'B' | 'tie' = 'tie';
    if (aAvgCsat > bAvgCsat) winningVariant = 'A';
    else if (bAvgCsat > aAvgCsat) winningVariant = 'B';

    return {
      ...exp,
      metrics: {
        variantACsatAvg: aAvgCsat,
        variantBCsatAvg: bAvgCsat,
        variantAResolutionPercent: aResolutionRate,
        variantBResolutionPercent: bResolutionRate,
        winningVariant,
      },
    };
  }
}
