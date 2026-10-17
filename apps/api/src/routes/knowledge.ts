import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import { KnowledgeRetriever, WebCrawlerConnector, DocumentParserConnector, ZendeskHelpCenterConnector } from '@customer-service/core';

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

  // POST /api/v1/tenants/:tenantId/knowledge/crawl - Ingest from Web URL
  router.post(
    '/:tenantId/knowledge/crawl',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { url, mockHtml } = req.body;

      if (!url) {
        res.status(400).json({ error: 'URL is required for web crawling.' });
        return;
      }

      try {
        const crawler = new WebCrawlerConnector();
        const crawlResult = await crawler.crawlUrl(url, mockHtml);

        const doc = await retriever.ingestDocument({
          tenantId,
          title: crawlResult.title,
          rawContent: crawlResult.content,
          sourceUri: crawlResult.uri,
          contentType: 'text/html-crawl',
        });

        res.status(201).json({ document: doc, crawlResult });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Web crawl failed' });
      }
    }
  );

  // POST /api/v1/tenants/:tenantId/knowledge/import - Ingest from structured format
  router.post(
    '/:tenantId/knowledge/import',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { format, data, options } = req.body;

      if (!format || !data) {
        res.status(400).json({ error: 'Format and data are required for import.' });
        return;
      }

      try {
        if (format === 'zendesk') {
          const articles = Array.isArray(data) ? data : data.articles || [];
          const importedArticles = ZendeskHelpCenterConnector.importArticles(articles, options);
          const docs = [];

          for (const item of importedArticles) {
            const doc = await retriever.ingestDocument({
              tenantId,
              title: item.documentTitle,
              rawContent: item.content,
              sourceUri: item.uri,
              contentType: 'zendesk-article',
            });
            docs.push(doc);
          }

          res.status(201).json({ importedCount: docs.length, documents: docs });
          return;
        }

        if (format === 'csv') {
          const csvContent = typeof data === 'string' ? data : data.csvContent;
          const title = data.title || 'Tabular Knowledge Import';
          const mdTable = DocumentParserConnector.parseCsvToMarkdownTable(csvContent, options?.delimiter);

          const doc = await retriever.ingestDocument({
            tenantId,
            title,
            rawContent: mdTable,
            contentType: 'text/markdown-table',
          });

          res.status(201).json({ document: doc });
          return;
        }

        if (format === 'structured') {
          const docText = typeof data === 'string' ? data : data.content;
          const title = data.title || 'Structured Knowledge Import';
          const parsed = DocumentParserConnector.parseStructuredDocument(title, docText);

          const doc = await retriever.ingestDocument({
            tenantId,
            title: parsed.documentTitle,
            rawContent: parsed.content,
            contentType: 'structured-document',
          });

          res.status(201).json({ document: doc, parsedInfo: parsed });
          return;
        }

        res.status(400).json({ error: `Unsupported import format: ${format}` });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Import failed' });
      }
    }
  );

  return router;
}
