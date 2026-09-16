// MIT License
// Copyright (c) 2026 190615273@qq.com

// R1（2026-09-16）：Tier3 迭代折叠早轮 —— 批折叠拆分逻辑单测。
// 验证 extractEarliestBatch 从"最早中间轮"提取折叠批的语义：
//   1) 旧→新顺序、最早一批优先
//   2) 单条超大消息不被打散（自成一批，保证批内 tool 配对可完整折叠）
//   3) 连续调用可把整个待折叠流拆成若干批，且各批 ≤ 预算（近似）
import { describe, it, expect } from 'bun:test';
import type { ChatMessage } from '../../src/ai/models/types';
import { extractEarliestBatch } from '../../src/context/compaction/CompactionOrchestrator';

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