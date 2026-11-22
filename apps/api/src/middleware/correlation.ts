import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { DistributedTracer } from '@customer-service/core';

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-request-id'] as string) || `req_${crypto.randomUUID()}`;
  const traceCtx = DistributedTracer.parseTraceparent(req.headers['traceparent'] as string | undefined);
  const spanId = DistributedTracer.generateSpanId();

  req.correlationId = correlationId;
  (req as any).traceId = traceCtx.traceId;
  (req as any).spanId = spanId;

  res.setHeader('X-Request-Id', correlationId);
  res.setHeader(
    'traceparent',
    DistributedTracer.formatTraceparent(traceCtx.traceId, spanId, traceCtx.sampled)
  );
  next();
}
