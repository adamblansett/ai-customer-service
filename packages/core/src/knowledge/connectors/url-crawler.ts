export interface CrawlResult {
  title: string;
  uri: string;
  content: string;
  wordCount: number;
}

export class WebCrawlerConnector {
  /**
   * Scrapes and converts public HTML pages or documentation into clean text for indexing.
   */
  public async crawlUrl(url: string, mockHtml?: string): Promise<CrawlResult> {
    let rawHtml = mockHtml;

    if (!rawHtml) {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'CustomerServiceBot/1.0 (+https://github.com/adamblansett/ai-customer-service)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to crawl URL ${url}: HTTP status ${res.status}`);
      }
      rawHtml = await res.text();
    }

    // 1. Extract Page Title
    const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    const rawTitle = titleMatch ? titleMatch[1].trim() : new URL(url).pathname.split('/').pop() || 'Web Document';
    const title = rawTitle
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // 2. Remove script, style, nav, header, footer, noscript tags
    let cleaned = rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

    // 3. Convert headers & structural elements to markdown-like lines
    cleaned = cleaned
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n\n# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n\n## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n### $1\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n\n$1\n')
      .replace(/<br\s*\/?>/gi, '\n');

    // 4. Strip remaining HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');

    // 5. Decode common HTML entities
    cleaned = cleaned
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // 6. Normalize whitespace
    cleaned = cleaned
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n\n');

    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;

    return {
      title,
      uri: url,
      content: cleaned,
      wordCount,
    };
  }
}
