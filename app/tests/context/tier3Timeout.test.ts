/**
 * P1-2（2026-11-04）：Tier3 超时编排回归。
 *
 * 旧行为：主超时一到就返回 `{applied:false}`，把内层已经折叠完的批次一起丢掉
 * （实测 `tier3 超时` 3 次/窗口 ⇒ 白跑 60 秒，只能回退 tier2）。
 * 新行为：超时 → abort → 给一个收敛宽限，能拿回 `applied:true` 的部分结果就采用。
 *
 * 计时参数可注入 ⇒ 用例用毫秒级窗口，不等待真实 60s。
 */
import { describe, it, expect } from 'bun:test';
import type { ChatMessage } from '../../src/ai/models/types';
import type { CompactionOutcome } from '../../src/context/compaction/CompactionOrchestrator';
import { runTier3WithTimeout } from '../../src/context/compaction/tier3Timeout';

const FALLBACK: ChatMessage[] = [
  { role: 'user', content: 'tier2 结果' } as ChatMessage,
];

describe('P1-2：tier3 超时编排', () => {
  it('内层在超时前完成 ⇒ 原样采用，不触发 abort', async () => {
    let aborted = false;
    const work: Promise<CompactionOutcome> = Promise.resolve({
      messages: [{ role: 'user', content: '折叠结果' } as ChatMessage],
      applied: true,
    });
    const result = await runTier3WithTimeout({
      work,
      abort: () => {
        aborted = true;
      },
      timeoutMs: 50,
      graceMs: 50,
      fallbackMessages: FALLBACK,
    });
    expect(result.timedOut).toBe(false);
    expect(result.keptPartial).toBe(false);
    expect(result.outcome.applied).toBe(true);
    expect(aborted).toBe(false);
  });

  it('超时后内层在宽限内返回部分结果 ⇒ 采纳（不再丢弃已完成折叠）', async () => {
    let aborted = false;
    const work = new Promise<CompactionOutcome>((resolve) => {
      const timer = setInterval(() => {
        if (!aborted) return;
        clearInterval(timer);
        resolve({
          messages: [{ role: 'user', content: '部分折叠结果' } as ChatMessage],
          applied: true,
        });
      }, 2);
    });
    const result = await runTier3WithTimeout({
      work,
      abort: () => {
        aborted = true;
      },
      timeoutMs: 10,
      graceMs: 200,
      fallbackMessages: FALLBACK,
    });
    expect(result.timedOut).toBe(true);
    expect(result.keptPartial).toBe(true);
    expect(result.outcome.applied).toBe(true);
    expect(result.outcome.messages[0]?.content).toBe('部分折叠结果');
  });

  it('宽限内仍拿不到可用结果 ⇒ 回退 fallback（tier2 结果）', async () => {
    const work = new Promise<CompactionOutcome>(() => {
      // 永不 settle：模拟 abort 后仍卡在不可中断的等待里
    });
    const result = await runTier3WithTimeout({
      work,
      abort: () => {},
      timeoutMs: 10,
      graceMs: 20,
      fallbackMessages: FALLBACK,
    });
    expect(result.timedOut).toBe(true);
    expect(result.keptPartial).toBe(false);
    expect(result.outcome.applied).toBe(false);
    expect(result.outcome.messages).toBe(FALLBACK);
  });
});
