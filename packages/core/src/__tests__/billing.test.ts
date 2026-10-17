import { describe, it, expect } from 'vitest';
import { UsageMeter } from '../billing/meter.js';

describe('Stripe Billing & Consumption Metering Engine', () => {
  it('tracks voice seconds and AI tokens accurately', () => {
    const meter = new UsageMeter();
    const tenantId = 'tenant_starter_001';

    meter.setTenantPlan(tenantId, 'starter', 2);

    // Record two calls of 90 seconds (1.5 min each = 3 minutes)
    meter.recordVoiceSeconds(tenantId, 90);
    meter.recordVoiceSeconds(tenantId, 90);

    // Record AI tokens
    meter.recordAiTokens(tenantId, 1200, 300);

    const summary = meter.getUsageSummary(tenantId);
    expect(summary.activeSeats).toBe(2);
    expect(summary.voiceSecondsTotal).toBe(180);
    expect(summary.voiceMinutesTotal).toBe(3);
    expect(summary.aiTokensTotal).toBe(1500);
  });

  it('detects overage when usage exceeds plan allowance', () => {
    const meter = new UsageMeter();
    const tenantId = 'tenant_pro_001';

    meter.setTenantPlan(tenantId, 'pro'); // 2,500 minutes included

    // Record 2,000 minutes (under quota)
    meter.recordVoiceSeconds(tenantId, 2000 * 60);
    const quota1 = meter.checkQuota(tenantId, 'voice');
    expect(quota1.isOverage).toBe(false);
    expect(quota1.remaining).toBe(500);

    // Record additional 600 minutes (over quota by 100 min)
    meter.recordVoiceSeconds(tenantId, 600 * 60);
    const quota2 = meter.checkQuota(tenantId, 'voice');
    expect(quota2.isOverage).toBe(true);
    expect(quota2.remaining).toBe(0);
  });

  it('calculates monthly invoice with base subscription and overage charges', () => {
    const meter = new UsageMeter();
    const tenantId = 'tenant_bill_test';

    // Starter plan: Base = $49.00 (4900 cents)
    // Included minutes: 500 min; Overage: $0.08/min (8 cents)
    // Included tokens: 500k; Overage: $0.02 / 1k (2 cents)
    meter.setTenantPlan(tenantId, 'starter');

    // Use 600 minutes (100 min overage -> $8.00 / 800 cents)
    meter.recordVoiceSeconds(tenantId, 600 * 60);

    // Use 600k tokens (100k overage -> $2.00 / 200 cents)
    meter.recordAiTokens(tenantId, 450000, 150000);

    const invoice = meter.calculateMonthlyInvoice(tenantId);

    expect(invoice.baseSubscriptionCents).toBe(4900);
    expect(invoice.billableOverageMinutes).toBe(100);
    expect(invoice.voiceOverageCostCents).toBe(800);
    expect(invoice.billableOverageTokens).toBe(100000);
    expect(invoice.aiOverageCostCents).toBe(200);

    // Total: 4900 + 800 + 200 = 5900 cents ($59.00)
    expect(invoice.totalBillableCents).toBe(5900);
  });
});
