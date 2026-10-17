export type SubscriptionTier = 'starter' | 'pro' | 'enterprise';

export interface TierPlanConfig {
  tier: SubscriptionTier;
  name: string;
  monthlyBasePriceCents: number;
  maxSeats: number;
  includedVoiceMinutes: number;
  includedAiTokens: number;
  overageMinuteCents: number;
  overagePer1kTokensCents: number;
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionTier, TierPlanConfig> = {
  starter: {
    tier: 'starter',
    name: 'Starter Plan',
    monthlyBasePriceCents: 4900, // $49/mo
    maxSeats: 2,
    includedVoiceMinutes: 500,
    includedAiTokens: 500000,
    overageMinuteCents: 8, // $0.08/min
    overagePer1kTokensCents: 2, // $0.02 / 1k tokens
  },
  pro: {
    tier: 'pro',
    name: 'Professional Plan',
    monthlyBasePriceCents: 19900, // $199/mo
    maxSeats: 10,
    includedVoiceMinutes: 2500,
    includedAiTokens: 3000000,
    overageMinuteCents: 6, // $0.06/min
    overagePer1kTokensCents: 1.5,
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise Plan',
    monthlyBasePriceCents: 79900, // $799/mo
    maxSeats: 50,
    includedVoiceMinutes: 12000,
    includedAiTokens: 20000000,
    overageMinuteCents: 4, // $0.04/min
    overagePer1kTokensCents: 1.0,
  },
};

export interface TenantUsageSummary {
  tenantId: string;
  tier: SubscriptionTier;
  activeSeats: number;
  voiceSecondsTotal: number;
  voiceMinutesTotal: number;
  aiPromptTokensTotal: number;
  aiCompletionTokensTotal: number;
  aiTokensTotal: number;
}

export interface MonthlyInvoiceEstimate {
  tenantId: string;
  tier: SubscriptionTier;
  baseSubscriptionCents: number;
  includedVoiceMinutes: number;
  usedVoiceMinutes: number;
  billableOverageMinutes: number;
  voiceOverageCostCents: number;
  includedAiTokens: number;
  usedAiTokens: number;
  billableOverageTokens: number;
  aiOverageCostCents: number;
  totalBillableCents: number;
}

export class UsageMeter {
  private tenantTiers: Map<string, SubscriptionTier> = new Map();
  private tenantSeats: Map<string, number> = new Map();
  private voiceUsageSeconds: Map<string, number> = new Map();
  private aiTokensUsage: Map<string, { prompt: number; completion: number }> = new Map();

  public setTenantPlan(tenantId: string, tier: SubscriptionTier, seats: number = 1): void {
    this.tenantTiers.set(tenantId, tier);
    this.tenantSeats.set(tenantId, seats);
  }

  public recordVoiceSeconds(tenantId: string, seconds: number): void {
    const current = this.voiceUsageSeconds.get(tenantId) || 0;
    this.voiceUsageSeconds.set(tenantId, current + seconds);
  }

  public recordAiTokens(tenantId: string, promptTokens: number, completionTokens: number): void {
    const current = this.aiTokensUsage.get(tenantId) || { prompt: 0, completion: 0 };
    this.aiTokensUsage.set(tenantId, {
      prompt: current.prompt + promptTokens,
      completion: current.completion + completionTokens,
    });
  }

  public getUsageSummary(tenantId: string): TenantUsageSummary {
    const tier = this.tenantTiers.get(tenantId) || 'starter';
    const seats = this.tenantSeats.get(tenantId) || 1;
    const voiceSec = this.voiceUsageSeconds.get(tenantId) || 0;
    const ai = this.aiTokensUsage.get(tenantId) || { prompt: 0, completion: 0 };

    return {
      tenantId,
      tier,
      activeSeats: seats,
      voiceSecondsTotal: voiceSec,
      voiceMinutesTotal: Math.ceil(voiceSec / 60),
      aiPromptTokensTotal: ai.prompt,
      aiCompletionTokensTotal: ai.completion,
      aiTokensTotal: ai.prompt + ai.completion,
    };
  }

  public checkQuota(
    tenantId: string,
    metric: 'voice' | 'ai'
  ): { allowed: boolean; remaining: number; isOverage: boolean } {
    const summary = this.getUsageSummary(tenantId);
    const plan = SUBSCRIPTION_PLANS[summary.tier];

    if (metric === 'voice') {
      const remaining = plan.includedVoiceMinutes - summary.voiceMinutesTotal;
      return {
        allowed: true, // Soft-capped with overage billing
        remaining: Math.max(0, remaining),
        isOverage: remaining < 0,
      };
    } else {
      const remaining = plan.includedAiTokens - summary.aiTokensTotal;
      return {
        allowed: true,
        remaining: Math.max(0, remaining),
        isOverage: remaining < 0,
      };
    }
  }

  public calculateMonthlyInvoice(tenantId: string): MonthlyInvoiceEstimate {
    const summary = this.getUsageSummary(tenantId);
    const plan = SUBSCRIPTION_PLANS[summary.tier];

    // Voice calculation
    const usedMinutes = summary.voiceMinutesTotal;
    const billableOverageMinutes = Math.max(0, usedMinutes - plan.includedVoiceMinutes);
    const voiceOverageCostCents = Math.round(billableOverageMinutes * plan.overageMinuteCents);

    // AI tokens calculation
    const usedTokens = summary.aiTokensTotal;
    const billableOverageTokens = Math.max(0, usedTokens - plan.includedAiTokens);
    const aiOverageCostCents = Math.round(
      (billableOverageTokens / 1000) * plan.overagePer1kTokensCents
    );

    const totalBillableCents =
      plan.monthlyBasePriceCents + voiceOverageCostCents + aiOverageCostCents;

    return {
      tenantId,
      tier: summary.tier,
      baseSubscriptionCents: plan.monthlyBasePriceCents,
      includedVoiceMinutes: plan.includedVoiceMinutes,
      usedVoiceMinutes: usedMinutes,
      billableOverageMinutes,
      voiceOverageCostCents,
      includedAiTokens: plan.includedAiTokens,
      usedAiTokens: usedTokens,
      billableOverageTokens,
      aiOverageCostCents,
      totalBillableCents,
    };
  }
}
