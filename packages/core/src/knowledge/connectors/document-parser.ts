export interface ParsedDocumentSection {
  title: string;
  content: string;
  pageNumber?: number;
}

export interface DocumentParseResult {
  documentTitle: string;
  content: string;
  sections: ParsedDocumentSection[];
  totalWordCount: number;
}

export class DocumentParserConnector {
  /**
   * Parses CSV or TSV tabular data (e.g. price lists, technician service areas) into a Markdown table.
   */
  public static parseCsvToMarkdownTable(csvContent: string, delimiter: string = ','): string {
    const lines = csvContent
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return '';

    const rows = lines.map((line) => line.split(delimiter).map((c) => c.trim()));
    const headerRow = rows[0];
    const separatorRow = headerRow.map(() => '---');

    const mdRows = [
      `| ${headerRow.join(' | ')} |`,
      `| ${separatorRow.join(' | ')} |`,
      ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`),
    ];

    return mdRows.join('\n');
  }

  /**
   * Parses multi-page or structured document text (PDF/DOCX extracts) with section headings.
   */
  public static parseStructuredDocument(
    documentTitle: string,
    rawText: string
  ): DocumentParseResult {
    const lines = rawText.split('\n');
    const sections: ParsedDocumentSection[] = [];

    let currentSectionTitle = 'General Information';
    let currentLines: string[] = [];
    let currentPage = 1;
    let sectionStartPage = 1;

    for (const line of lines) {
      const pageMatch = line.match(/^---+\s*Page\s+(\d+)\s*---+/i);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1], 10);
        if (currentLines.length === 0) {
          sectionStartPage = currentPage;
        }
        continue;
      }

      const headerMatch = line.match(/^(?:#+\s*|SECTION\s+\d+:\s*)(.+)$/i);
      if (headerMatch) {
        if (currentLines.length > 0) {
          sections.push({
            title: currentSectionTitle,
            content: currentLines.join('\n').trim(),
            pageNumber: sectionStartPage,
          });
          currentLines = [];
        }
        currentSectionTitle = headerMatch[1].trim();
        sectionStartPage = currentPage;
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        title: currentSectionTitle,
        content: currentLines.join('\n').trim(),
        pageNumber: sectionStartPage,
      });
    }

    const fullContent = sections
      .map((s) => `## ${s.title}\n${s.content}`)
      .join('\n\n');

    const totalWordCount = fullContent.split(/\s+/).filter(Boolean).length;

    return {
      documentTitle,
      content: fullContent,
      sections,
      totalWordCount,
    };
  }
}
