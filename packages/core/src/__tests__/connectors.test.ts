import { describe, it, expect } from 'vitest';
import {
  WebCrawlerConnector,
  DocumentParserConnector,
  ZendeskHelpCenterConnector,
} from '../knowledge/index.js';

describe('Automated Knowledge Ingestion Pipeline Connectors', () => {
  describe('WebCrawlerConnector', () => {
    it('crawls and cleans HTML web page into structured text', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Acme HVAC Pricing &amp; Diagnostic Rates</title>
            <script>console.log("tracking pixel");</script>
            <style>body { font-size: 14px; }</style>
          </head>
          <body>
            <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
            <main>
              <h1>Residential Service Rates</h1>
              <p>Our standard diagnostic fee is <strong>$89</strong> during business hours.</p>
              <h2>Emergency Calls</h2>
              <p>After-hours and weekend emergency heating repairs carry a flat $149 dispatch fee.</p>
              <ul>
                <li>Certified technicians</li>
                <li>Fully stocked trucks</li>
                <li>Same-day dispatch</li>
              </ul>
            </main>
            <footer><p>&copy; 2026 Acme HVAC Inc. All rights reserved.</p></footer>
          </body>
        </html>
      `;

      const crawler = new WebCrawlerConnector();
      const result = await crawler.crawlUrl('https://acme-hvac.example.com/pricing', mockHtml);

      expect(result.title).toBe('Acme HVAC Pricing & Diagnostic Rates');
      expect(result.uri).toBe('https://acme-hvac.example.com/pricing');
      expect(result.content).toContain('# Residential Service Rates');
      expect(result.content).toContain('diagnostic fee is $89');
      expect(result.content).toContain('## Emergency Calls');
      expect(result.content).toContain('- Certified technicians');
      expect(result.content).not.toContain('tracking pixel');
      expect(result.content).not.toContain('Home');
      expect(result.wordCount).toBeGreaterThan(15);
    });
  });

  describe('DocumentParserConnector', () => {
    it('converts tabular CSV data into clean Markdown tables', () => {
      const csv = `Service Tier,Base Fee,Response Time,Warranty
Standard Tune-Up,$89,Next Day,30 Days
Emergency Furnace Repair,$149,Under 2 Hours,1 Year
Comprehensive Heat Pump Overhaul,$350,Scheduled,5 Years`;

      const mdTable = DocumentParserConnector.parseCsvToMarkdownTable(csv);

      expect(mdTable).toContain('| Service Tier | Base Fee | Response Time | Warranty |');
      expect(mdTable).toContain('| --- | --- | --- | --- |');
      expect(mdTable).toContain('| Standard Tune-Up | $89 | Next Day | 30 Days |');
    });

    it('extracts multi-section documents and page markers', () => {
      const docText = `--- Page 1 ---
# Warranty Terms & Coverage
All residential heating components are protected under our 5-year parts warranty.

--- Page 2 ---
# Exclusions and Limitations
Cosmetic damage, routine air filter replacement, and unauthorized third-party repairs are excluded from warranty coverage.`;

      const parsed = DocumentParserConnector.parseStructuredDocument('Operations Manual', docText);

      expect(parsed.documentTitle).toBe('Operations Manual');
      expect(parsed.sections).toHaveLength(2);
      expect(parsed.sections[0].title).toBe('Warranty Terms & Coverage');
      expect(parsed.sections[0].pageNumber).toBe(1);
      expect(parsed.sections[1].title).toBe('Exclusions and Limitations');
      expect(parsed.sections[1].pageNumber).toBe(2);
    });
  });

  describe('ZendeskHelpCenterConnector', () => {
    it('imports Zendesk Help Center articles and filters drafts', () => {
      const articles = [
        {
          id: 440912,
          title: 'How to Reset Your Digital Thermostat',
          body: '<p>If your thermostat display is blank, follow these steps:</p><ul><li>Replace the AA batteries</li><li>Check the circuit breaker panel</li></ul>',
          html_url: 'https://support.acme-hvac.example.com/hc/en-us/articles/440912',
          draft: false,
        },
        {
          id: 440913,
          title: 'Draft Policy on Commercial Chiller Maintenance',
          body: '<p>Internal draft content only.</p>',
          draft: true,
        },
      ];

      const imported = ZendeskHelpCenterConnector.importArticles(articles, { includeDrafts: false });

      expect(imported).toHaveLength(1);
      expect(imported[0].documentTitle).toBe('How to Reset Your Digital Thermostat');
      expect(imported[0].content).toContain('# How to Reset Your Digital Thermostat');
      expect(imported[0].content).toContain('- Replace the AA batteries');
      expect(imported[0].uri).toContain('articles/440912');
      expect(imported[0].externalId).toBe('440912');
    });
  });
});
