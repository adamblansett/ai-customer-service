import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { chunkDocument, extractKeywords } from './chunker.js';
import { KnowledgeSearchResult, SearchOptions } from './types.js';
import crypto from 'node:crypto';

export class KnowledgeRetriever {
  constructor(private db: DatabaseInstance) {}

  /**
   * Ingests, chunks, and indexes a text or Markdown document for a specific tenant.
   */
  async ingestDocument(params: {
    tenantId: string;
    title: string;
    rawContent: string;
    sourceUri?: string;
    contentType?: 'text/markdown' | 'text/plain';
  }) {
    const documentId = `doc_${crypto.randomUUID()}`;
    const chunks = chunkDocument(params.rawContent);

    // 1. Insert document record
    const [doc] = await this.db
      .insert(schema.knowledgeDocuments)
      .values({
        id: documentId,
        tenantId: params.tenantId,
        title: params.title,
        sourceUri: params.sourceUri || null,
        contentType: params.contentType || 'text/markdown',
        rawContent: params.rawContent,
        chunkCount: chunks.length,
        status: 'indexed',
      })
      .returning();

    // 2. Insert chunk records
    if (chunks.length > 0) {
      const chunkRows = chunks.map(c => ({
        id: `chunk_${crypto.randomUUID()}`,
        tenantId: params.tenantId,
        documentId: doc.id,
        chunkIndex: c.chunkIndex,
        content: c.content,
        keywords: c.keywords,
        tokenCount: c.tokenCount,
      }));

      await this.db.insert(schema.knowledgeChunks).values(chunkRows);
    }

    return doc;
  }

  /**
   * Deletes a knowledge document and its associated chunks for a tenant.
   */
  async deleteDocument(tenantId: string, documentId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.knowledgeDocuments)
      .where(
        and(
          eq(schema.knowledgeDocuments.id, documentId),
          eq(schema.knowledgeDocuments.tenantId, tenantId)
        )
      )
      .returning();

    return deleted.length > 0;
  }

  /**
   * Searches knowledge chunks for approved business information.
   * Strictly isolated to the caller's tenant.
   */
  async search(
    tenantId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<KnowledgeSearchResult[]> {
    const minThreshold = options.minScoreThreshold ?? 0.25;
    const limit = options.limit ?? 5;

    const queryKeywords = extractKeywords(query);
    if (queryKeywords.length === 0) {
      return [];
    }

    // Fetch tenant's chunks joined with document titles
    const results = await this.db
      .select({
        chunkId: schema.knowledgeChunks.id,
        documentId: schema.knowledgeChunks.documentId,
        documentTitle: schema.knowledgeDocuments.title,
        sourceUri: schema.knowledgeDocuments.sourceUri,
        content: schema.knowledgeChunks.content,
        keywords: schema.knowledgeChunks.keywords,
      })
      .from(schema.knowledgeChunks)
      .innerJoin(
        schema.knowledgeDocuments,
        eq(schema.knowledgeChunks.documentId, schema.knowledgeDocuments.id)
      )
      .where(
        and(
          eq(schema.knowledgeChunks.tenantId, tenantId),
          eq(schema.knowledgeDocuments.status, 'indexed')
        )
      );

    const scored: KnowledgeSearchResult[] = [];

    const lowerQuery = query.toLowerCase();

    for (const row of results) {
      let matchCount = 0;
      const rowKeywords = new Set(row.keywords.split(' '));

      for (const qk of queryKeywords) {
        if (rowKeywords.has(qk)) {
          matchCount += 1;
        } else if (row.content.toLowerCase().includes(qk)) {
          matchCount += 0.8;
        }
      }

      // Exact substring boost
      let phraseBoost = 0;
      if (row.content.toLowerCase().includes(lowerQuery)) {
        phraseBoost = 0.4;
      }

      // Title keyword boost
      let titleBoost = 0;
      const lowerTitle = row.documentTitle.toLowerCase();
      for (const qk of queryKeywords) {
        if (lowerTitle.includes(qk)) {
          titleBoost += 0.15;
        }
      }

      const rawScore = (matchCount / queryKeywords.length) * 0.7 + phraseBoost + titleBoost;
      const normalizedScore = Math.min(1.0, Math.round(rawScore * 100) / 100);

      if (normalizedScore >= minThreshold) {
        let confidence: KnowledgeSearchResult['confidence'] = 'low';
        if (normalizedScore >= 0.7) confidence = 'high';
        else if (normalizedScore >= 0.45) confidence = 'medium';

        scored.push({
          chunkId: row.chunkId,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          sourceUri: row.sourceUri,
          content: row.content,
          score: normalizedScore,
          confidence,
        });
      }
    }

    // Sort descending by relevance score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }
}
