import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import { KnowledgeRetriever } from '../knowledge/retriever.js';
import { chunkDocument, extractKeywords } from '../knowledge/chunker.js';

describe('Business Knowledge Base Subsystem', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let retriever: KnowledgeRetriever;
  let tenant1Id: string;
  let tenant2Id: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenant1Id = seed.tenant1Id;
    tenant2Id = seed.tenant2Id;
    retriever = new KnowledgeRetriever(db);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('Document Chunker & Keyword Extraction', () => {
    it('extracts unique, non-stop words as keywords', () => {
      const text = 'The emergency furnace repair service is available 24/7 in freezing winter temperatures.';
      const keywords = extractKeywords(text);

      expect(keywords).toContain('emergency');
      expect(keywords).toContain('furnace');
      expect(keywords).toContain('repair');
      expect(keywords).toContain('freezing');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('is');
    });

    it('splits markdown content into structured chunks', () => {
      const markdown = `# Hours
Standard hours are Mon-Fri 8am-6pm.

# Pricing
Diagnostic fee is $89.
Annual AC maintenance is $129.`;

      const chunks = chunkDocument(markdown);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0].content).toContain('Hours');
      expect(chunks[1].content).toContain('Pricing');
      expect(chunks[0].keywords.length).toBeGreaterThan(0);
    });
  });

  describe('Knowledge Ingestion & Retrieval', () => {
    it('searches approved knowledge chunks with confidence scoring and source attribution', async () => {
      const results = await retriever.search(tenant1Id, 'What is the diagnostic fee for AC repair?');

      expect(results.length).toBeGreaterThan(0);
      const topMatch = results[0];

      expect(topMatch.documentTitle).toBe('Standard Service Pricing and Diagnostic Fees');
      expect(topMatch.sourceUri).toBe('kb://pricing/standard-rates.md');
      expect(topMatch.content).toContain('Diagnostic Fee: $89');
      expect(topMatch.score).toBeGreaterThan(0.4);
      expect(['medium', 'high']).toContain(topMatch.confidence);
    });

    it('returns empty results for out-of-scope / unanswerable questions', async () => {
      // Query asking about completely unrelated topic (e.g. root canal dental surgery in HVAC tenant)
      const results = await retriever.search(tenant1Id, 'How much does a root canal dental crown cost?');

      expect(results.length).toBe(0);
    });

    it('strictly isolates knowledge searches by tenant boundary', async () => {
      // Ingest dental document specifically for Tenant 2 (Summit Dental)
      const dentalDoc = await retriever.ingestDocument({
        tenantId: tenant2Id,
        title: 'Dental Cleaning and Tooth Extraction Fees',
        sourceUri: 'kb://dental/fees.md',
        rawContent: 'Standard routine teeth cleaning is $95. Wisdom tooth extraction is $250.',
      });

      expect(dentalDoc.id).toBeDefined();

      // Tenant 2 search MUST find the dental cleaning pricing
      const dentalResults = await retriever.search(tenant2Id, 'routine teeth cleaning cost');
      expect(dentalResults.length).toBeGreaterThan(0);
      expect(dentalResults[0].content).toContain('teeth cleaning is $95');

      // Tenant 1 (Acme HVAC) search for teeth cleaning MUST return ZERO results!
      const acmeCrossLeakResults = await retriever.search(tenant1Id, 'routine teeth cleaning cost');
      expect(acmeCrossLeakResults.length).toBe(0);
    });

    it('reflects document deletion immediately in search results', async () => {
      // Ingest temporary promo document
      const promoDoc = await retriever.ingestDocument({
        tenantId: tenant1Id,
        title: 'Spring Special Coupon Promo',
        sourceUri: 'kb://promos/spring.md',
        rawContent: 'Special spring promotional code SPRING20 provides a 20% discount on furnace tuneups.',
      });

      // Verify searchable
      const beforeDelete = await retriever.search(tenant1Id, 'SPRING20 discount coupon');
      expect(beforeDelete.length).toBeGreaterThan(0);

      // Delete document
      const deleted = await retriever.deleteDocument(tenant1Id, promoDoc.id);
      expect(deleted).toBe(true);

      // Verify subsequent search returns 0 results
      const afterDelete = await retriever.search(tenant1Id, 'SPRING20 discount coupon');
      expect(afterDelete.length).toBe(0);
    });
  });
});
