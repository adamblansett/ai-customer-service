import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { KnowledgeRetriever } from '../knowledge/retriever.js';
import { DeterministicSemanticEmbeddingProvider } from '../knowledge/embeddings.js';
import type { SubscriptionTier } from '../billing/meter.js';

export type IndustryTemplateId =
  | 'hvac'
  | 'dental'
  | 'ecommerce'
  | 'property_management'
  | 'saas_support';

export interface IndustryTemplate {
  id: IndustryTemplateId;
  name: string;
  tagline: string;
  defaultGreeting: string;
  builtInAiProfile: string;
  builtInVoice: string;
  documents: Array<{ title: string; content: string }>;
  starterFlowName: string;
}

export const INDUSTRY_TEMPLATES: Record<IndustryTemplateId, IndustryTemplate> = {
  hvac: {
    id: 'hvac',
    name: 'HVAC, Plumbing & Field Dispatch',
    tagline: '24/7 emergency triage, technician 2-hour appointment booking, and diagnostic pricing.',
    defaultGreeting:
      'Thank you for calling! I am your automated field-service assistant. Are you calling for emergency repair, routine maintenance, or an existing appointment?',
    builtInAiProfile: 'qwen2.5:7b-instruct',
    builtInVoice: 'af_heart',
    starterFlowName: 'HVAC Emergency & Dispatch Triage',
    documents: [
      {
        title: 'Pricing, Emergency Dispatch & Diagnostic Fees',
        content: `# Service Rates & Dispatch Policy\n- Standard Diagnostic Visit: $89 (waived if repair is approved).\n- After-Hours Emergency Dispatch: $149 flat dispatch fee.\n- Annual Seasonal Tune-Up: $119 per unit.\n- Technicians arrive in 2-hour scheduled windows Monday through Saturday 8:00 AM to 6:00 PM.`,
      },
    ],
  },
  dental: {
    id: 'dental',
    name: 'Dental & Medical Clinic Reception',
    tagline: 'Patient scheduling, insurance FAQ verification, urgent toothache triage, and reminders.',
    defaultGreeting:
      'Hello and thank you for calling our clinic! I am the automated patient coordinator. How may I assist you with scheduling or clinic questions today?',
    builtInAiProfile: 'qwen2.5:7b-instruct',
    builtInVoice: 'af_bella',
    starterFlowName: 'Patient Intake & Urgent Triage Flow',
    documents: [
      {
        title: 'Clinic Insurance, New Patient Exams & Urgent Care',
        content: `# Patient Care & Insurance FAQ\n- New Patient Comprehensive Exam & X-Rays: $135 without insurance.\n- Accepted PPO Plans: Delta Dental, Cigna, MetLife, Aetna.\n- Same-day emergency slots are held daily at 11:00 AM and 3:00 PM for acute dental pain or broken crowns.`,
      },
    ],
  },
  ecommerce: {
    id: 'ecommerce',
    name: 'E-Commerce & Retail Order Support',
    tagline: 'Instant Shopify/WooCommerce order tracking, return window checks, and VIP escalation.',
    defaultGreeting:
      'Hi there! Welcome to customer support. I am an AI assistant and can check your order status, tracking link, or return eligibility right away.',
    builtInAiProfile: 'llama3.1:8b',
    builtInVoice: 'af_heart',
    starterFlowName: 'Order Status & Returns IVR',
    documents: [
      {
        title: 'Shipping Speeds, Order Tracking & 30-Day Returns',
        content: `# Shipping & Return Policy\n- Standard Ground Shipping: Free on orders over $50 (3-5 business days).\n- Express 2-Day Air: $14.95 flat rate.\n- Unworn/unopened items may be returned within 30 days of delivery for an exchange or store credit. Refunds require human agent review.`,
      },
    ],
  },
  property_management: {
    id: 'property_management',
    name: 'Property Management & Leasing Desk',
    tagline: 'Tenant maintenance work orders, water-leak emergency escalation, and tour booking.',
    defaultGreeting:
      'Thank you for calling Property Services! I am an automated leasing and maintenance assistant. Are you a current resident reporting maintenance or a prospective renter?',
    builtInAiProfile: 'qwen2.5:7b-instruct',
    builtInVoice: 'af_heart',
    starterFlowName: 'Resident Maintenance & Leasing Flow',
    documents: [
      {
        title: 'Resident Maintenance SLA & Leasing Tour Policy',
        content: `# Maintenance & Leasing Guidelines\n- Active water leaks, gas odors, or total heat loss in winter are Priority-1 emergencies routed immediately to on-call maintenance.\n- Routine appliance repairs are scheduled within 48 business hours.\n- Self-guided and agent-led apartment tours are available daily from 9:00 AM to 5:30 PM.`,
      },
    ],
  },
  saas_support: {
    id: 'saas_support',
    name: 'B2B SaaS Technical Support & Helpdesk',
    tagline: 'Tier-1 troubleshooting, API docs RAG, Jira/Zendesk ticket creation, and SLA routing.',
    defaultGreeting:
      'Hello! You have reached Technical Support. I am an AI support engineer—tell me what issue you are seeing or ask me to open a priority support ticket.',
    builtInAiProfile: 'mistral-small:24b',
    builtInVoice: 'af_bella',
    starterFlowName: 'B2B Tier-1 Triage & Ticket Escalation',
    documents: [
      {
        title: 'SLA Response Times, SSO Setup & Incident Escalation',
        content: `# Enterprise Support SLA\n- Severity-1 Production Outage: 15-minute response SLA with immediate human engineer transfer.\n- Severity-2 Degraded Feature: 2-hour response SLA.\n- SAML 2.0 & SCIM 2.0 provisioning are included on Enterprise plans via the Security & Trust Console.`,
      },
    ],
  },
};

export interface SelfServeSignupInput {
  companyName: string;
  slug?: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  industry?: IndustryTemplateId;
  tier?: SubscriptionTier;
  timezone?: string;
  fallbackPhone?: string;
}

export class OnboardingService {
  private retriever: KnowledgeRetriever;

  constructor(private db: DatabaseInstance) {
    this.retriever = new KnowledgeRetriever(db, new DeterministicSemanticEmbeddingProvider());
  }

  static slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  /**
   * Registers a brand-new multi-tenant workspace, owner account, 14-day SaaS trial,
   * and seeds the selected industry starter pack in under 1 second.
   */
  async registerWorkspace(input: SelfServeSignupInput) {
    const normalizedEmail = input.ownerEmail.toLowerCase().trim();
    if (!normalizedEmail.includes('@')) {
      throw new Error('ValidationError: A valid owner email address is required.');
    }
    if (!input.password || input.password.length < 8) {
      throw new Error('ValidationError: Password must be at least 8 characters.');
    }

    const baseSlug = OnboardingService.slugify(input.slug || input.companyName);
    if (!baseSlug) {
      throw new Error('ValidationError: Company name or workspace slug is required.');
    }

    const [existingUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizedEmail));
    if (existingUser) {
      throw new Error('ConflictError: An account with this email already exists.');
    }

    const [existingSlug] = await this.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, baseSlug));
    const finalSlug = existingSlug
      ? `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`
      : baseSlug;

    const tenantId = `tenant_${crypto.randomUUID()}`;
    const userId = `user_${crypto.randomUUID()}`;
    const industryId: IndustryTemplateId = input.industry || 'hvac';
    const template = INDUSTRY_TEMPLATES[industryId] || INDUSTRY_TEMPLATES.hvac;
    const tier: SubscriptionTier = input.tier || 'pro';

    const passwordHash = await bcrypt.hash(input.password, 10);

    const [tenant] = await this.db
      .insert(schema.tenants)
      .values({
        id: tenantId,
        name: input.companyName.trim(),
        slug: finalSlug,
        status: 'active',
      })
      .returning();

    const [user] = await this.db
      .insert(schema.users)
      .values({
        id: userId,
        email: normalizedEmail,
        passwordHash,
        name: input.ownerName.trim(),
        systemRole: 'user',
        isActive: true,
      })
      .returning();

    await this.db.insert(schema.tenantMemberships).values({
      id: `mem_${crypto.randomUUID()}`,
      tenantId,
      userId,
      role: 'owner',
    });

    await this.db.insert(schema.businessSettings).values({
      id: `bs_${crypto.randomUUID()}`,
      tenantId,
      businessName: input.companyName.trim(),
      timezone: input.timezone || 'America/New_York',
      fallbackPhone: input.fallbackPhone || '+15550109999',
      aiGreeting: template.defaultGreeting,
      builtInAiProfile: template.builtInAiProfile,
      builtInVoice: template.builtInVoice,
      businessHours: {
        monday: { open: '08:00', close: '18:00', closed: false },
        tuesday: { open: '08:00', close: '18:00', closed: false },
        wednesday: { open: '08:00', close: '18:00', closed: false },
        thursday: { open: '08:00', close: '18:00', closed: false },
        friday: { open: '08:00', close: '18:00', closed: false },
        saturday: { open: '09:00', close: '14:00', closed: false },
        sunday: { open: '00:00', close: '00:00', closed: true },
      },
    });

    await this.db.insert(schema.stripeSubscriptions).values({
      id: `strsub_${crypto.randomUUID()}`,
      tenantId,
      stripeCustomerId: `cus_trial_${tenantId.slice(-8)}`,
      stripeSubscriptionId: `sub_trial_${crypto.randomBytes(6).toString('hex')}`,
      tier,
      status: 'trialing',
      currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000),
    });

    const seeded = await this.applyIndustryTemplate(tenantId, industryId);

    return {
      tenant,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        systemRole: user.systemRole,
      },
      membershipRole: 'owner' as const,
      industry: industryId,
      tier,
      seeded,
    };
  }

  /**
   * Seeds starter Knowledge Base documents, IVR Call Flow DAG, and sample domain records.
   */
  async applyIndustryTemplate(tenantId: string, industryId: IndustryTemplateId) {
    const template = INDUSTRY_TEMPLATES[industryId];
    if (!template) {
      throw new Error(`Unknown industry template: ${industryId}`);
    }

    const ingestedDocs: string[] = [];
    for (const doc of template.documents) {
      const created = await this.retriever.ingestDocument({
        tenantId,
        title: doc.title,
        rawContent: doc.content,
        contentType: 'text/markdown',
      });
      ingestedDocs.push(created.id);
    }

    const flowId = `flow_${crypto.randomUUID()}`;
    await this.db.insert(schema.callFlows).values({
      id: flowId,
      tenantId,
      name: template.starterFlowName,
      description: `Auto-provisioned starter flow for ${template.name}`,
      startNodeId: 'welcome_greeting',
      nodes: [
        {
          id: 'welcome_greeting',
          type: 'greeting',
          prompt: template.defaultGreeting,
          nextNodeId: 'ai_concierge',
        },
        {
          id: 'ai_concierge',
          type: 'ai_agent',
          department: 'general_triage',
          fallbackNodeId: 'live_transfer',
        },
        {
          id: 'live_transfer',
          type: 'agent_transfer',
          queueSkill: 'general-inquiry',
        },
      ],
      version: 1,
      published: true,
    });

    if (industryId === 'ecommerce') {
      await this.db
        .insert(schema.externalOrders)
        .values({
          id: `ord_${crypto.randomUUID()}`,
          tenantId,
          provider: 'shopify',
          orderNumber: 'ORD-10042',
          customerEmail: 'customer@example.com',
          customerPhone: '+15550192834',
          fulfillmentStatus: 'in_transit',
          financialStatus: 'paid',
          totalCents: 12900,
          currency: 'USD',
          trackingNumber: '1Z999AA10123456784',
          trackingUrl: 'https://track.example.com/1Z999AA10123456784',
          returnEligible: true,
          items: [{ sku: 'PRO-THERM-X1', name: 'Smart Thermostat X1', quantity: 1 }],
        })
        .onConflictDoNothing();
    }

    return {
      industry: template.id,
      documentsSeeded: ingestedDocs.length,
      starterFlowId: flowId,
    };
  }
}
