import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import type { DatabaseInstance } from '@customer-service/db';
import { correlationMiddleware } from './middleware/correlation.js';
import { errorHandler } from './middleware/error-handler.js';
import { createAuthRouter } from './routes/auth.js';
import { createTenantsRouter } from './routes/tenants.js';
import { createCredentialsRouter } from './routes/credentials.js';
import { createKnowledgeRouter } from './routes/knowledge.js';
import { createConversationsRouter } from './routes/conversations.js';
import { createCallsRouter } from './routes/calls.js';
import { createTelephonyRouter } from './routes/telephony.js';
import { createSimulatorRouter } from './routes/simulator.js';
import { createChatRouter } from './routes/chat.js';
import { createAuditRouter } from './routes/audit.js';

export function createApp(db: DatabaseInstance): Express {
  const app = express();

  // Basic security and parsing
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || true,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(correlationMiddleware);

  // Health checks
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health/ready', async (_req, res) => {
    try {
      // Simple ping to ensure database is responsive
      await db.execute('SELECT 1');
      res.json({ status: 'ready', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'error', database: 'disconnected' });
    }
  });

  // Mount API v1 Routers
  app.use('/api/v1/auth', createAuthRouter(db));
  app.use('/api/v1/tenants', createTenantsRouter(db));
  app.use('/api/v1/tenants', createCredentialsRouter(db));
  app.use('/api/v1/tenants', createKnowledgeRouter(db));
  app.use('/api/v1/tenants', createConversationsRouter(db));
  app.use('/api/v1/tenants', createCallsRouter(db));
  app.use('/api/v1/tenants', createSimulatorRouter(db));
  app.use('/api/v1/tenants', createAuditRouter(db));
  app.use('/api/v1/voice', createTelephonyRouter(db));
  app.use('/api/v1/chat', createChatRouter(db));

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
