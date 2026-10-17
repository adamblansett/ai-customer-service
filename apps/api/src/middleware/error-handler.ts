import { Request, Response, NextFunction } from 'express';
import { redactSensitiveData } from '@customer-service/core';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = req.correlationId || 'unknown';
  const statusCode = err.statusCode || err.status || 500;
  const safeMessage = redactSensitiveData(err.message || 'An unexpected internal error occurred.');

  // Structured logging
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      correlationId,
      path: req.path,
      method: req.method,
      statusCode,
      errorName: err.name,
      message: safeMessage,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    })
  );

  res.status(statusCode).json({
    error: safeMessage,
    correlationId,
  });
}
