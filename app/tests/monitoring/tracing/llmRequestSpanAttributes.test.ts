/**
 * D5 硬切换（2026-10-30）：LLM 请求 span 的**语义属性契约**。
 *
 * 背景：`.trae/specs/otel-genai-semconv-alignment.md` D5 —— 旧命名（span `Liri.llm_request` +
 * 属性 `llm_request.*`）按用户裁定在 v0.6.0 **硬切换**退场。本用例锁定切换后的形状：
 *
 * - span 名 = `{gen_ai.operation.name} {gen_ai.request.model}` ⇒ `chat <model>`；
 * - 语义属性**只**写 OTel `gen_ai.*`（tokens / model / operation）；
 * - 非 semconv 属性统一归应用命名空间 `liri.*`（context / speed / query_source / ttft_ms）；
 * - 成功/失败由 **span status** 表达（不再写 `success` 属性）；
 * - 旧 `llm_request.*` 属性**一个都不应再出现**（回归保护）。
 *
 * 用**假 tracer/span** 注入（不启用 exporter、不依赖外部后端），断言写入面而非导出面。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { SessionTracing } from '../../../src/monitoring/tracing/SessionTracing';
import { getOTelTracing } from '../../../src/monitoring/otel/OTelTracing';

interface CapturedSpan {
  name: string;
  attributes: Record<string, unknown>;
  status?: { code: number; message?: string };
  ended: boolean;
}

/** 最小 Span 替身：只实现 SessionTracing 用到的写入面 */
class FakeSpan {
  readonly attributes: Record<string, unknown> = {};
  status?: { code: number; message?: string };
  ended = false;
  private readonly captured: CapturedSpan;

  constructor(captured: CapturedSpan) {
    this.captured = captured;
  }

  spanContext(): { traceId: string; spanId: string } {
    return { traceId: 'trace-test', spanId: 'span-test' };
  }

  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    this.captured.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v);
    return this;
  }

  setStatus(status: { code: number; message?: string }): this {
    this.status = status;
    this.captured.status = status;
    return this;
  }

  end(): void {
    this.ended = true;
    this.captured.ended = true;
  }
}

/** 装配：把单例 OTelTracing 的 tracer 换成本地捕获器（用例结束还原） */
function withFakeTracer(): {
  spans: CapturedSpan[];
  tracing: SessionTracing;
  restore: () => void;
} {
  const spans: CapturedSpan[] = [];
  const otel = getOTelTracing();
  const original = otel.getTracer.bind(otel);
  otel.getTracer = (() => ({
    startSpan: (
      name: string,
      options?: { attributes?: Record<string, unknown> }
    ) => {
      const captured: CapturedSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        ended: false,
      };
      spans.push(captured);
      const span = new FakeSpan(captured);
      // startSpan 的入参属性也要落进 captured（FakeSpan 只记录后续写入）
      for (const [k, v] of Object.entries(options?.attributes ?? {})) {
        span.attributes[k] = v;
      }
      return span;
    },
  })) as unknown as typeof otel.getTracer;
  return {
    spans,
    tracing: new SessionTracing(),
    restore: () => {
      otel.getTracer = original as unknown as typeof otel.getTracer;
    },
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('D5 硬切换：LLM 请求 span 的语义属性契约', () => {
  it('span 名 = `chat <model>`（semconv：{operation} {model}）', () => {
    const ctx = withFakeTracer();
    restore = ctx.restore;
    ctx.tracing.startLLMRequestSpan('test-model');
    expect(ctx.spans).toHaveLength(1);
    expect(ctx.spans[0]!.name).toBe('chat test-model');
  });

  it('语义属性只写 gen_ai.*；非 semconv 归 liri.*；旧 llm_request.* 零写入', () => {
    const ctx = withFakeTracer();
    restore = ctx.restore;
    ctx.tracing.startLLMRequestSpan('test-model', {
      querySource: 'chat',
      fastMode: true,
    });
    const attrs = ctx.spans[0]!.attributes;

    expect(attrs['gen_ai.operation.name']).toBe('chat');
    expect(attrs['gen_ai.request.model']).toBe('test-model');
    // 非 semconv ⇒ 应用命名空间
    expect(attrs['liri.llm_request.context']).toBe('standalone');
    expect(attrs['liri.speed']).toBe('fast');
    expect(attrs['liri.query_source']).toBe('chat');
    // 回归保护：旧命名一个都不能再出现
    expect(
      Object.keys(attrs).filter((k) => k.startsWith('llm_request.'))
    ).toEqual([]);
  });

  it('结束：tokens 走 gen_ai.usage.*、ttft 走 liri.ttft_ms、失败用 span status 表达', () => {
    const ctx = withFakeTracer();
    restore = ctx.restore;
    const span = ctx.tracing.startLLMRequestSpan('test-model') as never;
    ctx.tracing.endLLMRequestSpan(span, {
      inputTokens: 11,
      outputTokens: 7,
      success: false,
      ttftMs: 42,
    });
    const captured = ctx.spans[0]!;

    expect(captured.attributes['gen_ai.usage.input_tokens']).toBe(11);
    expect(captured.attributes['gen_ai.usage.output_tokens']).toBe(7);
    expect(captured.attributes['liri.ttft_ms']).toBe(42);
    // success=false 且无错误串 ⇒ 仍标记 ERROR（信息不丢）
    expect(captured.status?.code).toBe(2);
    expect(captured.ended).toBe(true);
    expect(
      Object.keys(captured.attributes).filter((k) =>
        k.startsWith('llm_request.')
      )
    ).toEqual([]);
  });

  it('有错误串 ⇒ span status message 取错误串（优先于通用兜底）', () => {
    const ctx = withFakeTracer();
    restore = ctx.restore;
    const span = ctx.tracing.startLLMRequestSpan('test-model') as never;
    ctx.tracing.endLLMRequestSpan(span, {
      success: false,
      error: 'provider 429',
    });
    expect(ctx.spans[0]!.status).toEqual({ code: 2, message: 'provider 429' });
  });
});
