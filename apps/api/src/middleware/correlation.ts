import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-request-id'] as string) || `req_${crypto.randomUUID()}`;
  req.correlationId = correlationId;
  res.setHeader('X-Request-Id', correlationId);
  next();
}
