export interface ZendeskArticle {
  id: number | string;
  title: string;
  body: string;
  html_url?: string;
  draft?: boolean;
  section_id?: number | string;
  updated_at?: string;
}

export interface ImportedHelpArticle {
  documentTitle: string;
  uri: string;
  content: string;
  externalId: string;
}

export class ZendeskHelpCenterConnector {
  /**
   * Converts Zendesk Help Center article objects into platform knowledge documents.
   */
  public static importArticles(
    articles: ZendeskArticle[],
    options: { includeDrafts?: boolean } = {}
  ): ImportedHelpArticle[] {
    const results: ImportedHelpArticle[] = [];

    for (const article of articles) {
      if (article.draft && !options.includeDrafts) {
        continue;
      }

      // Convert HTML body to clean markdown text
      const cleanBody = article.body
        .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
        .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
        .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
        .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1')
        .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n\n$1\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n\n');

      results.push({
        documentTitle: article.title.trim(),
        uri: article.html_url || `zendesk://articles/${article.id}`,
        content: `# ${article.title.trim()}\n\n${cleanBody}`,
        externalId: String(article.id),
      });
    }

    return results;
  }
}
