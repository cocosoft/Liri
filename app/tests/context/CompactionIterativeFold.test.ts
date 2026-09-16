// MIT License
// Copyright (c) 2026 190615273@qq.com

// R1（2026-09-16）：Tier3 迭代折叠早轮 —— 批折叠拆分逻辑单测。
// 验证 extractEarliestBatch 从"最早中间轮"提取折叠批的语义：
//   1) 旧→新顺序、最早一批优先
//   2) 单条超大消息不被打散（自成一批，保证批内 tool 配对可完整折叠）
//   3) 连续调用可把整个待折叠流拆成若干批，且各批 ≤ 预算（近似）
import { describe, it, expect } from 'bun:test';
import type { ChatMessage } from '../../src/ai/models/types';
import { estimateMessagesTokens } from '../../src/ai/tokenizer/TokenEstimator.js';
import {
  CompactionOrchestrator,
  extractEarliestBatch,
} from '../../src/context/compaction/CompactionOrchestrator';
import {
  COMPACTION_USER_PROMPT,
  parseCompactionSummary,
  renderCompactionSummary,
} from '../../src/context/compaction/StructuredCompactionPrompt';
// R1（2026-09-16）：捕获 tier3_fold_batch_error 日志，断言失败分支被真实执行
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';

function user(content: string): ChatMessage {
  return { role: 'user', content };
}

const BUDGET = 12_000; // 与 FOLD_BATCH_SOURCE_TOKENS 对齐

describe('R1 Tier3 迭代折叠：extractEarliestBatch', () => {
  it('取的批是旧→新中最早的一条（单条未超预算 → 批 = 最早消息）', () => {
    const msgs = [user('第一轮'), user('第二轮'), user('第三轮')];
    const { batch, rest } = extractEarliestBatch(msgs, BUDGET);
    expect(batch.length).toBe(msgs.length); // 总量未超预算，一次取完
    expect(rest.length).toBe(0);
    expect(batch[0]).toBe(msgs[0]);
  });

  it('累积超预算：批在接近预算处封批，rest 保留剩余且顺序不变', () => {
    // 每条约 4K tokens → 8000 字符足够撑大
    const bigMsg = (i: number) => user(`第${i}轮 ${'\u4F60'.repeat(6000)}`);
    const msgs = [bigMsg(1), bigMsg(2), bigMsg(3), bigMsg(4)];
    const { batch, rest } = extractEarliestBatch(msgs, BUDGET);
    expect(batch.length).toBeGreaterThan(0);
    expect(rest.length).toBeGreaterThan(0);
    // 最早一批包含最早的原始对象
    expect(batch[0]).toBe(msgs[0]);
    // rest 首个 = 批之后的第一条，顺序保持
    expect(rest[0]).toBe(batch[batch.length - 1] ? msgs[batch.length] : msgs[0]);
  });

  it('单条超大消息不被打散（自成一批）', () => {
    const giant = user('大消息 ' + '\u52A0'.repeat(30_000));
    const small1 = user('小1');
    const { batch, rest } = extractEarliestBatch([giant, small1], BUDGET);
    // 首条（giant）未超 1 条阈值即纳入；但因 budget 按消息粒度，单条必自成一批
    expect(batch[0]).toBe(giant);
    expect(batch.length).toBeGreaterThan(0);
    // rest 包含后续所有
    expect(rest[0]).toBe(small1);
  });

  it('反复取批可将整个流拆完，且每批都不拆散大消息', () => {
    const mk = (i: number) =>
      user((i % 2 === 0 ? '\u4F60' : '\u597D').repeat(8000)); // 交替大消息
    const msgs = Array.from({ length: 8 }, (_, i) => mk(i));
    let pool = [...msgs];
    const batches: ChatMessage[][] = [];
    let guard = 0;
    while (pool.length > 0 && guard++ < 100) {
      const { batch, rest } = extractEarliestBatch(pool, BUDGET);
      batches.push(batch);
      pool = rest;
    }
    // 整个流被覆盖且顺序保持
    const flattened = batches.flat();
    expect(flattened.length).toBe(msgs.length);
    expect(flattened[0]).toBe(msgs[0]);
    expect(flattened[flattened.length - 1]).toBe(msgs[msgs.length - 1]);
    // 每批非空
    expect(batches.every((b) => b.length > 0)).toBe(true);
  });
});

// R1（2026-09-16）：runFullCompaction 折叠循环端到端。借助 CompactionOrchestrator 新增的
// 可注入 aiService 构造选项（options.aiService），mock generate 直接驱动整条折叠循环，
// 断言 afterTokens < beforeTokens——弥补此前"仅测 _foldBatchSummary"的端到端缺口。
describe('R1 Tier3 迭代折叠：runFullCompaction 折叠循环端到端', () => {
  // 经类型桥访问私有 runFullCompaction（与现有测试访问私有成员同风格）
  const runFull = (
    orch: CompactionOrchestrator
  ) =>
    (orch as unknown as {
      runFullCompaction: (
        messages: ChatMessage[],
        ctx: { model: string; sessionId?: string; configOverride?: number },
        signal?: AbortSignal
      ) => Promise<{
        messages: ChatMessage[];
        applied: boolean;
        summaryEnvelope?: { model: string; maxTokens: number; structured: boolean };
      }>;
    }).runFullCompaction.bind(orch);

  it('end-to-end：注入 mock generate + 真实 procs → 折叠后 tokens 下降且 applied:true', async () => {
    const head = { role: 'system' as const, content: '你是助手，保持中文。' };
    // 多条历史消息撑起大 context（每条约 8K tokens），使 toCompress 远超 12K 预算触发多批折叠
    const history = Array.from({ length: 6 }, (_, i) =>
      user(`第 ${i + 1} 轮 ${'你'.repeat(8000)}`)
    );
    const before = estimateMessagesTokens([head, ...history]);
    // 注入 mock：每批返回一句极短摘要 → summaryTokens << batchTokens，循环可持续推进到目标窗口
    const orch = new CompactionOrchestrator({
      aiService: { generate: async () => ({ content: '短摘要' }) },
    });
    const result = await runFull(orch)(
      [head, ...history] as ChatMessage[],
      { model: 'm', sessionId: 's' }
    );
    // 折叠真实生效
    expect(result.applied).toBe(true);
    const after = estimateMessagesTokens(result.messages);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(45_000); // 进入 FOLD_TARGET_TOKENS 窗口
  });
});

// R1（2026-09-16）：_foldBatchSummary 单批折叠 + 失败分支（tier3_fold_batch_error）。
// 说明：_foldBatchSummary 接受 aiService 作为显式参数，可在单测中注入 mock generate。
// runFullCompaction 折叠循环端到端已改由 CompactionOrchestrator.options.aiService 注入覆盖
//（见上方端到端 describe），此处聚焦单批语义与失败分支。
describe('R1 Tier3 迭代折叠：_foldBatchSummary（单批折叠）', () => {
  // 复用生产真实 procs：COMPACTION_USER_PROMPT / parse / render。
  // 成功用例中 parse 固定返回 null → 走 `[Previous conversation summary]` fallback 文本，
  // 使占位输出确定且极短，保证 `summaryTokens < batchTokens` 的降体积断言稳定成立。
  const procs = {
    COMPACTION_USER_PROMPT,
    parseCompactionSummary: (() => null) as typeof parseCompactionSummary,
    renderCompactionSummary,
  };
  const orch = new CompactionOrchestrator();
  // 私有方法经类型桥访问（与现有测试访问 loop.state 同风格，禁用 any / 非空断言）
  const fold = (
    orch as unknown as {
      _foldBatchSummary: (
        ai: { generate: Function },
        procs: {
          COMPACTION_USER_PROMPT: string;
          parseCompactionSummary: (raw: string) => Record<string, unknown> | null;
          renderCompactionSummary: typeof renderCompactionSummary;
        },
        head: ChatMessage[],
        batch: ChatMessage[],
        ctx: { model: string; sessionId?: string; configOverride?: number },
        signal?: AbortSignal
      ) => Promise<string | null>;
    }
  )._foldBatchSummary.bind(orch);

  it('单批折叠成功：注入 mock AI 摘要 → 返回占位文本，且摘要 tokens < 被折叠批 tokens', async () => {
    // 构造一个 token 较多的批（4 条 × 1500 个"你"，tokens 远大于短摘要）
    const batch = Array.from({ length: 4 }, (_, i) =>
      user(`第${i + 1}轮 ${'你'.repeat(3000)}`)
    );
    const batchTokens = estimateMessagesTokens(batch);
    // mock AI：返回一句简短摘要
    const ai = { generate: async () => ({ content: '这是压缩后的早轮摘要' }) };
    const summary = await fold(ai, procs, [], batch, {
      model: 'm',
      sessionId: 's',
    });
    // 折叠成功：非空占位文本
    expect(summary).toBeTruthy();
    // 占位走 fallback 前缀
    expect(summary).toMatch(/^\[Previous conversation summary\]/);
    // 占位替换后 tokens 下降（与 runFullCompaction 内 summaryTokens<batchTokens 校验口径一致）
    const summaryTokens = estimateMessagesTokens([
      { role: 'system', content: summary } as ChatMessage,
    ]);
    expect(summaryTokens).toBeLessThan(batchTokens);
  });

  it('单批折叠失败（AI 抛错）→ 返回 null 且记录 compaction:tier3_fold_batch_error', async () => {
    const seen: string[] = [];
    const off = addLogHandler((entry) => {
      seen.push(entry.message);
    });
    try {
      const batch = [user(`第一轮 ${'你'.repeat(800)}`)];
      const ai = {
        generate: async () => {
          throw new Error('ai service unavailable');
        },
      };
      const summary = await fold(ai, procs, [], batch, {
        model: 'm',
        sessionId: 's',
      });
      // 失败即回退：不产出占位，调用方保留残余并停止折叠
      expect(summary).toBeNull();
      // 失败分支被真实执行（运行级证据）
      expect(
        seen.some((m) => m.includes('compaction:tier3_fold_batch_error'))
      ).toBe(true);
    } finally {
      off();
    }
  });
});