export interface KnowledgeSearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceUri?: string | null;
  content: string;
  score: number; // Relevance score between 0 and 1
  confidence: 'high' | 'medium' | 'low' | 'unverified';
}

export interface SearchOptions {
  limit?: number;
  minScoreThreshold?: number; // Minimum relevance threshold (default: 0.25)
}
