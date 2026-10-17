import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import { KnowledgeRetriever } from '@customer-service/core';

export function createKnowledgeRouter(db: DatabaseInstance): Router {
  const router = Router();
  const retriever = new KnowledgeRetriever(db);

  // GET /api/v1/tenants/:tenantId/knowledge - List documents
  router.get(
    '/:tenantId/knowledge',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const docs = await db
        .select()
        .from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.tenantId, tenantId))
        .orderBy(desc(schema.knowledgeDocuments.createdAt));

      res.json({ documents: docs });
    }
  );

  // POST /api/v1/tenants/:tenantId/knowledge - Ingest new document
  router.post(
    '/:tenantId/knowledge',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { title, rawContent, sourceUri, contentType } = req.body;

      if (!title || !rawContent) {
        res.status(400).json({ error: 'Title and content are required.' });
        return;
      }

      const doc = await retriever.ingestDocument({
        tenantId,
        title,
        rawContent,
        sourceUri,
        contentType: contentType || 'text/markdown',
      });

      res.status(201).json({ document: doc });
    }
  );

  // DELETE /api/v1/tenants/:tenantId/knowledge/:docId
  router.delete(
    '/:tenantId/knowledge/:docId',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, docId } = req.params;

      const success = await retriever.deleteDocument(tenantId, docId);
      if (!success) {
        res.status(404).json({ error: 'Document not found or already deleted.' });
        return;
      }

      res.json({ success: true, message: 'Document and indexed chunks deleted successfully.' });
    }
  );

  // POST /api/v1/tenants/:tenantId/knowledge/test-search - Live search tester
  router.post(
    '/:tenantId/knowledge/test-search',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { query } = req.body;

      if (!query) {
        res.status(400).json({ error: 'Query is required for search.' });
        return;
      }

      const results = await retriever.search(tenantId, query, { limit: 5 });
      res.json({ query, results });
    }
  );

  return router;
}
