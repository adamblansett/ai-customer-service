import crypto from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { chunkDocument } from './chunker.js';
import { OllamaEmbeddingProvider } from './embeddings.js';

export class KnowledgeGovernance {
  private embedder = new OllamaEmbeddingProvider();

  constructor(private db: DatabaseInstance) {}

  /**
   * Creates an immutable revision snapshot for a knowledge base document.
   */
  public async createVersionSnapshot(params: {
    tenantId: string;
    documentId: string;
    title: string;
    rawContent: string;
    changeNote?: string;
    createdBy?: string;
  }) {
    const existing = await this.listVersions(params.tenantId, params.documentId);
    const nextVersionNumber = existing.length > 0 ? existing[0].versionNumber + 1 : 1;

    const [created] = await this.db
      .insert(schema.knowledgeDocumentVersions)
      .values({
        id: `kbver_${crypto.randomUUID()}`,
        tenantId: params.tenantId,
        documentId: params.documentId,
        versionNumber: nextVersionNumber,
        title: params.title,
        rawContent: params.rawContent,
        changeNote: params.changeNote || `Revision v${nextVersionNumber}`,
        createdBy: params.createdBy || 'admin@acme-hvac.example.com',
      })
      .returning();

    return created;
  }

  /**
   * Lists all revision snapshots for a document ordered newest first.
   */
  public async listVersions(tenantId: string, documentId: string) {
    return await this.db
      .select()
      .from(schema.knowledgeDocumentVersions)
      .where(
        and(
          eq(schema.knowledgeDocumentVersions.tenantId, tenantId),
          eq(schema.knowledgeDocumentVersions.documentId, documentId)
        )
      )
      .orderBy(desc(schema.knowledgeDocumentVersions.versionNumber));
  }

  /**
   * Rolls back a knowledge document to a target versionNumber, re-chunks, and re-embeds all chunks.
   */
  public async rollbackToVersion(
    tenantId: string,
    documentId: string,
    versionNumber: number
  ) {
    const versions = await this.listVersions(tenantId, documentId);
    const target = versions.find((v) => v.versionNumber === versionNumber);
    if (!target) {
      throw new Error(`Version ${versionNumber} not found for document ${documentId}.`);
    }

    const chunks = chunkDocument(target.rawContent);

    // 1. Update document content
    const [updatedDoc] = await this.db
      .update(schema.knowledgeDocuments)
      .set({
        title: target.title,
        rawContent: target.rawContent,
        chunkCount: chunks.length,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.knowledgeDocuments.id, documentId),
          eq(schema.knowledgeDocuments.tenantId, tenantId)
        )
      )
      .returning();

    // 2. Replace chunks with re-embedded chunks from the restored version
    await this.db
      .delete(schema.knowledgeChunks)
      .where(
        and(
          eq(schema.knowledgeChunks.documentId, documentId),
          eq(schema.knowledgeChunks.tenantId, tenantId)
        )
      );

    if (chunks.length > 0) {
      const chunkRows = await Promise.all(
        chunks.map(async (c) => {
          const vec = await this.embedder.embedText(`${target.title}\n${c.content}`);
          return {
            id: `chunk_${crypto.randomUUID()}`,
            tenantId,
            documentId,
            chunkIndex: c.chunkIndex,
            content: c.content,
            keywords: c.keywords,
            embeddingJson: JSON.stringify(vec),
            tokenCount: c.tokenCount,
          };
        })
      );
      await this.db.insert(schema.knowledgeChunks).values(chunkRows);
    }

    // 3. Record rollback snapshot
    const rollbackSnapshot = await this.createVersionSnapshot({
      tenantId,
      documentId,
      title: target.title,
      rawContent: target.rawContent,
      changeNote: `Rolled back to v${versionNumber}`,
    });

    return {
      document: updatedDoc,
      restoredVersion: target.versionNumber,
      newVersionNumber: rollbackSnapshot.versionNumber,
      reindexedChunks: chunks.length,
    };
  }
}
