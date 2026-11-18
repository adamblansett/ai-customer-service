import { Request, Response, NextFunction } from 'express';
import { WebhookSignatureVerifier } from '@customer-service/core';

interface MetricCounter {
  method: string;
  route: string;
  status: number;
  count: number;
}

const httpCounters = new Map<string, MetricCounter>();
let totalDurationMs = 0;
let totalRequestsCount = 0;

/**
 * Records HTTP request metrics for Prometheus /metrics exposition.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    totalDurationMs += duration;
    totalRequestsCount += 1;

    const normalizedPath = (req.baseUrl + (req.route?.path || req.path || '/'))
      .replace(/\/$/, '') || '/';
    const key = `${req.method}:${normalizedPath}:${res.statusCode}`;
    const existing = httpCounters.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      httpCounters.set(key, {
        method: req.method,
        route: normalizedPath,
        status: res.statusCode,
        count: 1,
      });
    }
  });
  next();
}

/**
 * Renders Prometheus text format (version 0.0.4).
 */
export function renderPrometheusMetrics(): string {
  const lines: string[] = [
    '# HELP ai_cs_http_requests_total Total number of HTTP requests processed',
    '# TYPE ai_cs_http_requests_total counter',
  ];

  for (const item of httpCounters.values()) {
    lines.push(
      `ai_cs_http_requests_total{method="${item.method}",route="${item.route}",status="${item.status}"} ${item.count}`
    );
  }

  lines.push(
    '# HELP ai_cs_http_request_duration_ms_sum Total HTTP request duration in milliseconds',
    '# TYPE ai_cs_http_request_duration_ms_sum counter',
    `ai_cs_http_request_duration_ms_sum ${totalDurationMs}`,
    '# HELP ai_cs_http_request_duration_ms_count Total HTTP request count',
    '# TYPE ai_cs_http_request_duration_ms_count counter',
    `ai_cs_http_request_duration_ms_count ${totalRequestsCount}`,
    '# HELP ai_cs_builtin_open_weights_info Built-In Open-Weights AI and Speech engine status',
    '# TYPE ai_cs_builtin_open_weights_info gauge',
    `ai_cs_builtin_open_weights_info{default_llm="${process.env.BUILT_IN_AI_MODEL || 'qwen2.5:7b-instruct'}",default_stt="${process.env.BUILT_IN_STT_MODEL || 'whisper-large-v3-turbo'}",default_tts="${process.env.BUILT_IN_TTS_MODEL || 'kokoro-82m'}"} 1`
  );

  return lines.join('\n') + '\n';
}

/**
 * Sliding-window rate limiter middleware.
 */
export function createRateLimiter(options?: { windowMs?: number; maxRequests?: number }) {
  const windowMs = options?.windowMs || 60_000;
  const maxRequests = options?.maxRequests || 120;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientKey =
      (req.headers['x-forwarded-for'] as string) || req.ip || 'local_client';
    const now = Date.now();
    let entry = buckets.get(clientKey);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(clientKey, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, maxRequests - entry.count);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (entry.count > maxRequests) {
      res.status(429).json({
        error: 'RateLimitExceeded: Too many requests, please retry shortly.',
      });
      return;
    }

    next();
  };
}

/**
 * Carrier Webhook Signature Verification Middleware.
 * Validates X-Twilio-Signature, X-Plivo-Signature-V2, or X-Hub-Signature-256 when provided
 * or when WEBHOOK_SIGNATURE_SECRET is enforced.
 */
export function webhookSignatureMiddleware(req: Request, res: Response, next: NextFunction): void {
  const twilioSig = req.headers['x-twilio-signature'] as string | undefined;
  const plivoSig = req.headers['x-plivo-signature-v2'] as string | undefined;
  const whatsappSig = req.headers['x-hub-signature-256'] as string | undefined;
  const secret =
    (req.headers['x-webhook-secret'] as string | undefined) ||
    process.env.WEBHOOK_SIGNATURE_SECRET ||
    'default-webhook-signing-secret';

  if (twilioSig) {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const valid = WebhookSignatureVerifier.verifyTwilioSignature(
      secret,
      fullUrl,
      req.body || {},
      twilioSig
    );
    if (!valid) {
      res.status(401).json({ error: 'Invalid X-Twilio-Signature webhook signature.' });
      return;
    }
  }

  if (plivoSig) {
    const payload = JSON.stringify(req.body || {});
    const valid = WebhookSignatureVerifier.verifyHmacSha256Base64(secret, payload, plivoSig);
    if (!valid) {
      res.status(401).json({ error: 'Invalid X-Plivo-Signature-V2 webhook signature.' });
      return;
    }
  }

  if (whatsappSig) {
    const payload = JSON.stringify(req.body || {});
    const valid = WebhookSignatureVerifier.verifyWhatsAppSignature(secret, payload, whatsappSig);
    if (!valid) {
      res.status(401).json({ error: 'Invalid X-Hub-Signature-256 webhook signature.' });
      return;
    }
  }

  next();
}
