import crypto from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';

export type TraceStage = 'stt' | 'rag' | 'llm' | 'tool' | 'dlp' | 'tts' | 'http';

export interface W3cTraceContext {
  traceId: string;
  parentSpanId?: string;
  sampled: boolean;
}

export interface RecordedSpanInput {
  tenantId: string;
  conversationId?: string;
  traceId: string;
  parentSpanId?: string;
  operationName: string;
  stage: TraceStage;
  durationMs: number;
  status?: 'ok' | 'error';
  attributes?: Record<string, any>;
}

export class DistributedTracer {
  private otlpEndpoint?: string;

  constructor(
    private db: DatabaseInstance,
    options: { otlpEndpoint?: string } = {}
  ) {
    this.otlpEndpoint = options.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  }

  static generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  static generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Parses W3C Trace Context `traceparent` header (`00-<32-hex-traceId>-<16-hex-spanId>-<2-hex-flags>`).
   */
  static parseTraceparent(header?: string): W3cTraceContext {
    if (header) {
      const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(header.trim());
      if (match && match[1] !== '00000000000000000000000000000000') {
        return {
          traceId: match[1].toLowerCase(),
          parentSpanId: match[2].toLowerCase(),
          sampled: (parseInt(match[3], 16) & 0x01) === 1,
        };
      }
    }
    return {
      traceId: DistributedTracer.generateTraceId(),
      sampled: true,
    };
  }

  static formatTraceparent(traceId: string, spanId: string, sampled = true): string {
    return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
  }

  async recordSpan(input: RecordedSpanInput) {
    const spanId = DistributedTracer.generateSpanId();
    const [stored] = await this.db
      .insert(schema.traceSpans)
      .values({
        id: `spn_${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        conversationId: input.conversationId || null,
        traceId: input.traceId,
        spanId,
        parentSpanId: input.parentSpanId || null,
        operationName: input.operationName,
        stage: input.stage,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        status: input.status || 'ok',
        attributes: input.attributes || {},
      })
      .returning();

    if (this.otlpEndpoint) {
      const payload = this.buildOtlpPayload([stored]);
      fetch(`${this.otlpEndpoint.replace(/\/$/, '')}/v1/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Non-blocking telemetry export
      });
    }

    return stored;
  }

  /**
   * Records a full voice/chat turn waterfall (`STT` -> `Hybrid RAG` -> `LLM` -> `Tool` -> `DLP` -> `TTS`).
   */
  async recordVoiceTurnWaterfall(params: {
    tenantId: string;
    conversationId?: string;
    traceId?: string;
    sttMs: number;
    ragMs: number;
    llmMs: number;
    toolMs?: number;
    dlpMs?: number;
    ttsMs: number;
    model?: string;
  }) {
    const traceId = params.traceId || DistributedTracer.generateTraceId();
    const rootSpan = await this.recordSpan({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      traceId,
      operationName: 'voice.turn.pipeline',
      stage: 'http',
      durationMs:
        params.sttMs +
        params.ragMs +
        params.llmMs +
        (params.toolMs || 0) +
        (params.dlpMs || 1) +
        params.ttsMs,
      attributes: { model: params.model || 'qwen2.5:7b-instruct' },
    });

    const stages: Array<{ stage: TraceStage; name: string; ms: number }> = [
      { stage: 'stt', name: 'stt.faster_whisper.transcribe', ms: params.sttMs },
      { stage: 'rag', name: 'rag.hybrid_bm25_vector.retrieve', ms: params.ragMs },
      { stage: 'llm', name: 'llm.inference.generate', ms: params.llmMs },
      ...(params.toolMs ? [{ stage: 'tool' as const, name: 'tool.registry.execute', ms: params.toolMs }] : []),
      { stage: 'dlp', name: 'security.output_dlp.scrub', ms: params.dlpMs ?? 1 },
      { stage: 'tts', name: 'tts.kokoro_82m.synthesize', ms: params.ttsMs },
    ];

    const children = [];
    for (const st of stages) {
      const child = await this.recordSpan({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        traceId,
        parentSpanId: rootSpan.spanId,
        operationName: st.name,
        stage: st.stage,
        durationMs: st.ms,
        attributes: { model: params.model || 'qwen2.5:7b-instruct' },
      });
      children.push(child);
    }

    return {
      traceId,
      rootSpanId: rootSpan.spanId,
      totalDurationMs: rootSpan.durationMs,
      spanCount: children.length + 1,
    };
  }

  /**
   * Groups persisted spans into chronological distributed traces for the `/experiments` Trace Waterfall UI.
   */
  async listRecentTraces(tenantId: string, limit = 15) {
    const rows = await this.db
      .select()
      .from(schema.traceSpans)
      .where(eq(schema.traceSpans.tenantId, tenantId))
      .orderBy(desc(schema.traceSpans.startedAt));

    const grouped = new Map<
      string,
      {
        traceId: string;
        conversationId: string | null;
        totalDurationMs: number;
        startedAt: Date;
        spans: typeof rows;
      }
    >();

    for (const row of rows) {
      const existing = grouped.get(row.traceId);
      if (!existing) {
        grouped.set(row.traceId, {
          traceId: row.traceId,
          conversationId: row.conversationId,
          totalDurationMs: row.parentSpanId ? 0 : row.durationMs,
          startedAt: row.startedAt,
          spans: [row],
        });
      } else {
        existing.spans.push(row);
        if (!row.parentSpanId) {
          existing.totalDurationMs = row.durationMs;
        }
      }
    }

    return Array.from(grouped.values())
      .slice(0, limit)
      .map((t) => ({
        ...t,
        totalDurationMs:
          t.totalDurationMs ||
          t.spans.reduce((acc, s) => acc + (s.parentSpanId ? s.durationMs : 0), 0),
        spans: [...t.spans].reverse(),
      }));
  }

  buildOtlpPayload(spans: Array<typeof schema.traceSpans.$inferSelect>) {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'ai-customer-service-api' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: '@customer-service/core-tracer', version: '0.1.0' },
              spans: spans.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId || undefined,
                name: s.operationName,
                durationMs: s.durationMs,
                status: { code: s.status === 'ok' ? 1 : 2 },
              })),
            },
          ],
        },
      ],
    };
  }
}
