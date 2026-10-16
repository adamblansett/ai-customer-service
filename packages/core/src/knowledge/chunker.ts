export interface ChunkOutput {
  chunkIndex: number;
  content: string;
  keywords: string;
  tokenCount: number;
}

const COMMON_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'i', 'we', 'you', 'they',
  'this', 'my', 'our', 'your', 'can', 'do', 'does', 'did', 'have',
]);

/**
 * Normalizes text to extract searchable keywords (lower-case, alphanumeric, stop-word filtered).
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !COMMON_STOP_WORDS.has(w));

  return Array.from(new Set(words));
}

/**
 * Splits Markdown or plain text into semantic chunks by headers, paragraphs, and token size limits.
 */
export function chunkDocument(rawContent: string, maxChunkLengthChars = 600): ChunkOutput[] {
  if (!rawContent || !rawContent.trim()) {
    return [];
  }

  // Split on Markdown headers or double newlines
  const sections = rawContent.split(/\n(?=#{1,3}\s)|\n\n+/);
  const chunks: ChunkOutput[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (trimmed.length <= maxChunkLengthChars) {
      const keywords = extractKeywords(trimmed).join(' ');
      chunks.push({
        chunkIndex: chunkIndex++,
        content: trimmed,
        keywords,
        tokenCount: Math.ceil(trimmed.length / 4), // ~4 chars per token estimate
      });
    } else {
      // Split large sections by sentences or paragraph lines
      const lines = trimmed.split(/\n+/);
      let currentBuffer = '';

      for (const line of lines) {
        if (currentBuffer.length + line.length > maxChunkLengthChars && currentBuffer.length > 0) {
          const keywords = extractKeywords(currentBuffer).join(' ');
          chunks.push({
            chunkIndex: chunkIndex++,
            content: currentBuffer.trim(),
            keywords,
            tokenCount: Math.ceil(currentBuffer.length / 4),
          });
          currentBuffer = '';
        }
        currentBuffer += (currentBuffer ? '\n' : '') + line;
      }

      if (currentBuffer.trim()) {
        const keywords = extractKeywords(currentBuffer).join(' ');
        chunks.push({
          chunkIndex: chunkIndex++,
          content: currentBuffer.trim(),
          keywords,
          tokenCount: Math.ceil(currentBuffer.length / 4),
        });
      }
    }
  }

  return chunks;
}
