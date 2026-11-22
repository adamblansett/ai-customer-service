import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import type { DatabaseInstance } from '@customer-service/db';
import { generateOpenApiSpec, WidgetSdkGenerator } from '@customer-service/core';
import { correlationMiddleware } from './middleware/correlation.js';
import { errorHandler } from './middleware/error-handler.js';
import {
  metricsMiddleware,
  renderPrometheusMetrics,
  createRateLimiter,
  webhookSignatureMiddleware,
} from './middleware/observability.js';
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
import { createPrivacyRouter } from './routes/privacy.js';
import { createSmsRouter } from './routes/sms.js';
import { createEmailRouter } from './routes/email.js';
import { createWhatsAppRouter } from './routes/whatsapp.js';
import { createCampaignsRouter } from './routes/campaigns.js';
import { createSsoRouter } from './routes/sso.js';
import { createScimRouter } from './routes/scim.js';
import { createFlowsRouter } from './routes/flows.js';
import { createCustomersRouter } from './routes/customers.js';
import { createEnterpriseRouter } from './routes/enterprise.js';
import { createOperationsRouter } from './routes/operations.js';
import { createSaasConnectorsRouter } from './routes/saas-connectors.js';
import { createSocialAndWebhooksRouter } from './routes/social.js';

export function createApp(db: DatabaseInstance): Express {
  const app = express();

  // Strict OWASP Security Headers (CSP, HSTS, Frameguard, Referrer-Policy, Permissions-Policy)
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: { maxAge: 31536000, includeSubDomains: true },
    })
  );
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), geolocation=(), payment=(), usb=(), magnetometer=()'
    );
    next();
  });
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(
    express.json({
      limit: '5mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(correlationMiddleware);
  app.use(metricsMiddleware);
  app.use(createRateLimiter({ windowMs: 60_000, maxRequests: 500 }));

  // Health & Prometheus Metrics checks
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderPrometheusMetrics());
  });

  app.get('/api/v1/openapi.json', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json(generateOpenApiSpec(baseUrl));
  });

  // Standalone Embeddable Web Chat & Click-to-Call WebRTC Voice SDK
  app.get('/api/v1/widget.js', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}/api/v1`;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(
      WidgetSdkGenerator.generateBundle({
        defaultApiBaseUrl: baseUrl,
        tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
      })
    );
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
  app.use('/api/v1/auth/sso', createSsoRouter(db));
  app.use('/api/v1/scim/v2', createScimRouter(db));
  app.use('/api/v1/tenants', createTenantsRouter(db));
  app.use('/api/v1/tenants', createCredentialsRouter(db));
  app.use('/api/v1/tenants', createKnowledgeRouter(db));
  app.use('/api/v1/tenants', createConversationsRouter(db));
  app.use('/api/v1/tenants', createCallsRouter(db));
  app.use('/api/v1/tenants', createSimulatorRouter(db));
  app.use('/api/v1/tenants', createAuditRouter(db));
  app.use('/api/v1/tenants', createPrivacyRouter(db));
  app.use('/api/v1/tenants', createCampaignsRouter(db));
  app.use('/api/v1/tenants', createFlowsRouter(db));
  app.use('/api/v1/tenants', createCustomersRouter(db));
  app.use('/api/v1/tenants', createEnterpriseRouter(db));
  app.use('/api/v1/tenants', createOperationsRouter(db));
  app.use('/api/v1/tenants', createSaasConnectorsRouter(db));
  app.use('/api/v1', createSocialAndWebhooksRouter(db));
  app.use('/api/v1/voice', webhookSignatureMiddleware, createTelephonyRouter(db));
  app.use('/api/v1/chat', createChatRouter(db));
  app.use('/api/v1/sms', webhookSignatureMiddleware, createSmsRouter(db));
  app.use('/api/v1/email', createEmailRouter(db));
  app.use('/api/v1/whatsapp', webhookSignatureMiddleware, createWhatsAppRouter(db));

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
