import crypto from 'node:crypto';

export type CrmProviderType = 'hubspot' | 'salesforce' | 'zendesk' | 'generic';

export interface CallbackWebhookPayload {
  callbackId: string;
  tenantId: string;
  callerPhone: string;
  requestedAt: string;
  preferredTime?: string | null;
  reason: string;
  status: string;
  conversationId?: string | null;
  metadata?: Record<string, any>;
}

export interface CrmDispatcherConfig {
  provider: CrmProviderType;
  endpointUrl: string;
  signingSecret?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface CrmDispatchResult {
  success: boolean;
  statusCode?: number;
  provider: CrmProviderType;
  responseBody?: string;
  error?: string;
  dispatchedAt: string;
}

export class CrmDispatcher {
  /**
   * Generates HMAC-SHA256 signature for outgoing webhook payload verification.
   */
  public static generateSignature(payloadString: string, secret: string): string {
    return `sha256=${crypto.createHmac('sha256', secret).update(payloadString).digest('hex')}`;
  }

  /**
   * Formats the callback payload into a provider-specific CRM structure.
   */
  public static formatPayload(
    callback: CallbackWebhookPayload,
    provider: CrmProviderType
  ): Record<string, any> {
    switch (provider) {
      case 'hubspot':
        return {
          properties: {
            hs_pipeline: '0',
            hs_pipeline_stage: '1',
            hs_ticket_priority: 'HIGH',
            subject: `Callback Request: ${callback.callerPhone}`,
            content: `Caller: ${callback.callerPhone}\nReason: ${callback.reason}\nPreferred: ${callback.preferredTime || 'ASAP'}\nConversation: ${callback.conversationId || 'N/A'}`,
            customer_phone: callback.callerPhone,
          },
        };

      case 'zendesk':
        return {
          ticket: {
            subject: `Inbound Call Callback Request (${callback.callerPhone})`,
            comment: {
              body: `Callback requested by ${callback.callerPhone}.\nReason: ${callback.reason}\nTime requested: ${callback.requestedAt}`,
            },
            priority: 'urgent',
            type: 'task',
          },
        };

      case 'salesforce':
        return {
          Subject: `AI Voice Callback: ${callback.callerPhone}`,
          Description: `Reason: ${callback.reason}\nCaller: ${callback.callerPhone}\nStatus: ${callback.status}`,
          Priority: 'High',
          Status: 'New',
          Origin: 'Phone',
        };

      case 'generic':
      default:
        return {
          event: 'callback.created',
          timestamp: new Date().toISOString(),
          data: callback,
        };
    }
  }

  /**
   * Dispatches the callback ticket to an external CRM endpoint with headers and signature.
   */
  public static async dispatch(
    config: CrmDispatcherConfig,
    callback: CallbackWebhookPayload,
    customFetch: typeof fetch = fetch
  ): Promise<CrmDispatchResult> {
    const formatted = CrmDispatcher.formatPayload(callback, config.provider);
    const bodyString = JSON.stringify(formatted);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'CustomerService-CrmDispatcher/1.0',
    };

    if (config.signingSecret) {
      headers['X-Customer-Service-Signature'] = CrmDispatcher.generateSignature(
        bodyString,
        config.signingSecret
      );
    }

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 8000);

    try {
      const response = await customFetch(config.endpointUrl, {
        method: 'POST',
        headers,
        body: bodyString,
        signal: controller.signal,
      });

      const responseText = await response.text();

      return {
        success: response.ok,
        statusCode: response.status,
        provider: config.provider,
        responseBody: responseText,
        dispatchedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        success: false,
        provider: config.provider,
        error: err.message || 'Unknown network error during CRM dispatch',
        dispatchedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
