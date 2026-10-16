import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { KnowledgeRetriever } from '../knowledge/retriever.js';
import {
  ToolCategory,
  ToolExecutionContext,
  ToolExecutionResult,
  ProhibitedToolError,
  ToolAuthorizationError,
} from './types.js';
import { AiToolDefinition } from '../ai/types.js';
import crypto from 'node:crypto';

export class ToolRegistry {
  private retriever: KnowledgeRetriever;

  constructor(private db: DatabaseInstance) {
    this.retriever = new KnowledgeRetriever(db);
  }

  /**
   * Returns tool definitions formatted for AI model consumption.
   * Only exposes permitted tools (never prohibited tools).
   */
  getPermittedToolDefinitions(): AiToolDefinition[] {
    return [
      {
        name: 'lookup_knowledge',
        description: 'Searches approved business knowledge base for FAQs, pricing, service policies, and guidelines.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query or question to lookup in approved documents.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'check_business_hours',
        description: 'Checks business operating hours, timezone, and open/closed status.',
        parameters: {
          type: 'object',
          properties: {
            dayOfWeek: {
              type: 'string',
              description: 'Optional day of the week (e.g. "monday", "today").',
            },
          },
        },
      },
      {
        name: 'lookup_customer',
        description: 'Looks up the authorized customer record for the current caller.',
        parameters: {
          type: 'object',
          properties: {
            phoneNumber: {
              type: 'string',
              description: 'The phone number of the customer.',
            },
          },
        },
      },
      {
        name: 'create_callback_request',
        description: 'Schedules a callback request when a human representative is unavailable or when the caller requests a callback.',
        parameters: {
          type: 'object',
          properties: {
            phoneNumber: {
              type: 'string',
              description: 'E.164 phone number to call back.',
            },
            reason: {
              type: 'string',
              description: 'Detailed reason for the callback request.',
            },
          },
          required: ['phoneNumber', 'reason'],
        },
      },
      {
        name: 'request_transfer_to_human',
        description: 'Initiates a transfer to a human representative when requested or when issue requires human judgment.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'The reason why a human transfer is needed.',
            },
          },
          required: ['reason'],
        },
      },
    ];
  }

  /**
   * Deterministically executes a tool call with strict boundary validation.
   */
  async executeTool(
    toolName: string,
    args: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    // 1. Prohibited Actions Guard (Hardcoded absolute block)
    const PROHIBITED_TOOLS = new Set([
      'issue_refund',
      'modify_policy',
      'execute_shell_command',
      'change_user_role',
      'delete_customer',
      'initiate_outbound_call',
    ]);

    if (PROHIBITED_TOOLS.has(toolName)) {
      await this.logAuditEvent(context, 'tool.prohibited_attempt', {
        toolName,
        args,
        blocked: true,
      });
      throw new ProhibitedToolError(
        toolName,
        `SecurityViolation: Tool '${toolName}' is prohibited. AI agents are not authorized to perform consequential financial or administrative actions.`
      );
    }

    try {
      let result: ToolExecutionResult;

      switch (toolName) {
        case 'lookup_knowledge': {
          const schemaValidator = z.object({ query: z.string().min(1) });
          const parsed = schemaValidator.parse(args);
          const results = await this.retriever.search(context.tenantId, parsed.query);
          result = {
            success: true,
            data: {
              results: results.map(r => ({
                title: r.documentTitle,
                content: r.content,
                confidence: r.confidence,
                score: r.score,
                sourceUri: r.sourceUri,
              })),
            },
          };
          break;
        }

        case 'check_business_hours': {
          const [settings] = await this.db
            .select()
            .from(schema.businessSettings)
            .where(eq(schema.businessSettings.tenantId, context.tenantId));

          result = {
            success: true,
            data: {
              businessName: settings?.businessName || 'Business',
              timezone: settings?.timezone || 'America/New_York',
              businessHours: settings?.businessHours || {},
              afterHoursBehavior: settings?.afterHoursBehavior || 'callback',
            },
          };
          break;
        }

        case 'lookup_customer': {
          // Cross-customer security enforcement:
          // If callerPhone is established, reject any request attempting to scan another phone number!
          const targetPhone = args.phoneNumber || context.callerPhone;
          if (context.callerPhone && args.phoneNumber && args.phoneNumber !== context.callerPhone) {
            throw new ToolAuthorizationError(
              `CallerAuthorizationError: Caller with phone '${context.callerPhone}' is not authorized to query customer record for '${args.phoneNumber}'.`
            );
          }

          if (!targetPhone) {
            result = { success: false, error: 'No phone number provided or identified.' };
            break;
          }

          const [customer] = await this.db
            .select()
            .from(schema.customers)
            .where(
              and(
                eq(schema.customers.tenantId, context.tenantId),
                eq(schema.customers.phoneNumber, targetPhone)
              )
            );

          result = {
            success: true,
            data: customer
              ? { id: customer.id, name: customer.name, phone: customer.phoneNumber }
              : null,
          };
          break;
        }

        case 'create_callback_request': {
          const validator = z.object({
            phoneNumber: z.string().min(7),
            reason: z.string().min(3),
          });
          const parsed = validator.parse(args);

          const callbackId = `cb_${crypto.randomUUID()}`;
          const [created] = await this.db
            .insert(schema.callbackRequests)
            .values({
              id: callbackId,
              tenantId: context.tenantId,
              conversationId: context.conversationId,
              customerId: context.customerId || null,
              phoneNumber: parsed.phoneNumber,
              reason: parsed.reason,
              status: 'pending',
            })
            .returning();

          result = {
            success: true,
            data: {
              callbackId: created.id,
              status: created.status,
              phoneNumber: created.phoneNumber,
              message: 'Callback request has been logged successfully.',
            },
          };
          break;
        }

        case 'request_transfer_to_human': {
          const validator = z.object({ reason: z.string().min(1) });
          const parsed = validator.parse(args);

          const [settings] = await this.db
            .select()
            .from(schema.businessSettings)
            .where(eq(schema.businessSettings.tenantId, context.tenantId));

          result = {
            success: true,
            data: {
              transferInitiated: true,
              destinationPhone: settings?.fallbackPhone || null,
              timeoutSeconds: settings?.transferTimeoutSeconds || 30,
              reason: parsed.reason,
            },
          };
          break;
        }

        default:
          result = {
            success: false,
            error: `UnknownTool: Tool '${toolName}' is not registered.`,
          };
      }

      await this.logAuditEvent(context, `tool.executed.${toolName}`, {
        success: result.success,
        error: result.error,
      });

      return result;
    } catch (err: any) {
      await this.logAuditEvent(context, `tool.failed.${toolName}`, {
        error: err.message,
      });
      throw err;
    }
  }

  private async logAuditEvent(
    context: ToolExecutionContext,
    action: string,
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      await this.db.insert(schema.auditEvents).values({
        id: `audit_${crypto.randomUUID()}`,
        tenantId: context.tenantId,
        userId: context.userId || null,
        action,
        resourceType: 'tool_call',
        resourceId: context.conversationId,
        metadata,
      });
    } catch {
      // Non-fatal audit log failure
    }
  }
}
