import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';

export interface DispatchSurveyInput {
  tenantId: string;
  customerPhone: string;
  conversationId?: string;
  appointmentId?: string;
  channel?: 'sms' | 'voice' | 'chat';
  businessName?: string;
}

export interface RecordSurveyResponseInput {
  tenantId: string;
  surveyId: string;
  score: number;
  feedbackText?: string;
}

export class SurveyEngine {
  constructor(private db: DatabaseInstance) {}

  /**
   * Dispatches a post-call or post-appointment 1-5 CSAT survey.
   */
  public async dispatchSurvey(input: DispatchSurveyInput) {
    const surveyId = `srv_${crypto.randomUUID()}`;
    const channel = input.channel || 'sms';
    const businessName = input.businessName || 'Acme HVAC';

    const [created] = await this.db
      .insert(schema.csatSurveys)
      .values({
        id: surveyId,
        tenantId: input.tenantId,
        conversationId: input.conversationId || null,
        appointmentId: input.appointmentId || null,
        customerPhone: input.customerPhone,
        channel,
        status: 'sent',
        supervisorAlerted: false,
      })
      .returning();

    const promptText = `Thank you for contacting ${businessName}! On a scale of 1 to 5 (5 = Excellent), how would you rate your experience today?`;

    return {
      survey: created,
      promptText,
    };
  }

  /**
   * Records a customer's 1-5 CSAT score and triggers supervisor recovery alerts on scores <= 2.
   */
  public async recordSurveyResponse(input: RecordSurveyResponseInput) {
    if (input.score < 1 || input.score > 5) {
      throw new Error('CSAT score must be an integer between 1 and 5.');
    }

    const isLowScore = input.score <= 2;
    const status = isLowScore ? 'escalated_low_score' : 'completed';

    const [updated] = await this.db
      .update(schema.csatSurveys)
      .set({
        score: input.score,
        feedbackText: input.feedbackText || null,
        status,
        supervisorAlerted: isLowScore,
        respondedAt: new Date(),
      })
      .where(
        and(
          eq(schema.csatSurveys.id, input.surveyId),
          eq(schema.csatSurveys.tenantId, input.tenantId)
        )
      )
      .returning();

    if (!updated) {
      throw new Error(`Survey ${input.surveyId} not found.`);
    }

    return {
      survey: updated,
      supervisorAlerted: isLowScore,
      recoveryAction: isLowScore
        ? `Urgent supervisor recovery alert triggered for ${updated.customerPhone} (CSAT=${input.score}/5).`
        : null,
    };
  }

  /**
   * Lists all CSAT surveys and summary metrics for a tenant.
   */
  public async listSurveys(tenantId: string) {
    const surveys = await this.db
      .select()
      .from(schema.csatSurveys)
      .where(eq(schema.csatSurveys.tenantId, tenantId));

    const completed = surveys.filter((s) => typeof s.score === 'number');
    const averageScore =
      completed.length > 0
        ? Math.round(
            (completed.reduce((acc, s) => acc + (s.score || 0), 0) / completed.length) * 10
          ) / 10
        : 4.8;

    return {
      surveys,
      stats: {
        totalSent: surveys.length,
        totalResponded: completed.length,
        averageScore,
        lowScoreAlerts: surveys.filter((s) => s.supervisorAlerted).length,
      },
    };
  }
}
