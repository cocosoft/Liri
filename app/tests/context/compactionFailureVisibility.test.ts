// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B3-3（2026-09-23）：compaction 失败**不得静默走截断兜底** —— 可见化 + 可归因。
 *
 * 覆盖两点：
 * 1. **结构化归因**：`CompactionOrchestrator.compact()` 的异常分支返回 `failure`
 *    （`reason:'exception'` + `probePhase`），且 WARN 日志带结构化字段 ——
 *    `probePhase` 与 loopProbe 的 `compaction:orchestrate` 相位打通；
 * 2. **可被上层感知**：`StreamPipeline.compactContext()` 收到 `failure` 时走**既有失败通道**
 *    （`compaction:failed` WARN），不再误报为 `compaction:skipped`。
 *
 * 「修复前必失败」取证：见交付报告（中和可见化动作后，本文件两处失败态原始输出）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import type { ChatMessage } from '../../src/ai/models/types';
import {
  CompactionOrchestrator,
  compactionOrchestrator,
  type CompactionOutcome,
} from '../../src/context/compaction/CompactionOrchestrator';
import {
  StreamPipeline,
  type PipelineContext,
} from '../../src/chat/pipeline/StreamPipeline';
import { addLogHandler } from '@openliri/infra/monitoring/logs/Logger';
import type { StructuredLogEntry } from '@openliri/infra/monitoring/logs/types';

/** 捕获日志（与 tests/context/CompactionIterativeFold.test.ts 同法） */
function captureLogs(): {
  entries: StructuredLogEntry[];
  stop: () => void;
} {
  const entries: StructuredLogEntry[] = [];
  const stop = addLogHandler((entry) => {
    entries.push(entry);
  });
  return { entries, stop };
}

/** 只保留 message 命中的日志（避免噪声） */
function findByMessage(
  entries: StructuredLogEntry[],
  needle: string
): StructuredLogEntry[] {
  return entries.filter((e) => e.message.includes(needle));
}

let stopCapture: (() => void) | null = null;

afterEach(() => {
  stopCapture?.();
  stopCapture = null;
});

describe('B3-3 ①：压缩失败的**结构化归因**（编排器异常分支）', () => {
  test('`_doCompact` 抛异常 ⇒ outcome.failure 带 reason/probePhase/elapsedMs，且 WARN 日志结构化', async () => {
    const capture = captureLogs();
    stopCapture = capture.stop;

    const orch = new CompactionOrchestrator();
    // 经类型桥替换私有 `_doCompact`（与既有测试访问私有成员同风格）：模拟压缩内部异常
    const priv = orch as unknown as {
      _doCompact: (...args: unknown[]) => Promise<CompactionOutcome>;
    };
    const original = priv._doCompact;
    priv._doCompact = async () => {
      throw new Error('boom: tier3 exploded');
    };

    let outcome: CompactionOutcome;
    try {
      outcome = await orch.compact(
        [{ role: 'user', content: '历史消息' } as ChatMessage],
        { model: 'test-model' },
        {
          preEvaluated: {
            decision: 'trigger' as const,
            rawInputTokens: 200_000,
            uncalibratedTotal: 200_000,
            calibratedTotal: 200_000,
            estimateLowerBound: false,
            maxTokens: 1_000,
            ratio: 200,
          },
        }
      );
    } finally {
      priv._doCompact = original;
    }

    // 兜底行为不变：仍返回未应用（调用方照旧走截断）
    expect(outcome.applied).toBe(false);
    // 失败**可被上层感知**：存在结构化 failure（不再与 skip / 无效果混淆）
    expect(outcome.failure?.reason).toBe('exception');
    expect(outcome.failure?.message).toBe('boom: tier3 exploded');
    // 失败**可归因**：与 loopProbe 的 compaction:orchestrate 相位打通
    expect(outcome.failure?.probePhase).toBe('compaction:orchestrate');
    expect(typeof outcome.failure?.elapsedMs).toBe('number');

    // 既有 WARN 日志升级为结构化字段（含归因相位）
    const warns = findByMessage(capture.entries, 'compaction:❌异常未应用');
    expect(warns.length).toBe(1);
    expect(warns[0].data?.probePhase).toBe('compaction:orchestrate');
    expect(warns[0].data?.error).toBe('boom: tier3 exploded');
    expect(warns[0].data?.model).toBe('test-model');
  });

  test('非失败路径（未触发压缩）**不产** failure（不谎报）', async () => {
    const orch = new CompactionOrchestrator();
    const outcome = await orch.compact(
      [{ role: 'user', content: '短消息' } as ChatMessage],
      { model: 'test-model' },
      {
        preEvaluated: {
          decision: 'skip' as const,
          rawInputTokens: 10,
          uncalibratedTotal: 10,
          calibratedTotal: 10,
          estimateLowerBound: false,
          maxTokens: 1_000,
          ratio: 0.01,
        },
      }
    );
    expect(outcome.applied).toBe(false);
    expect(outcome.failure).toBeUndefined();
  });
});

/**
 * 2026-11-18（真机 `session_mwkthat73b80a6724f`）：压缩体积口径。
 *
 * 实测：`compaction:applied {beforeTokens:169331, afterTokens:196778, savingPercent:-16.2}`
 * —— 决策口径（校准后估值）与压缩后口径（`estimateMessagesTokens`）混用，得出"压缩后变大"
 * 的负节省；同时 Tier3 折叠产物（facts 注入）比被折叠内容更大却仍按 `applied:true` 写回。
 */
describe('2026-11-18：压缩体积口径（前后同源 + 折叠不降即拒）', () => {
  test('Tier3 折叠后反而更大 ⇒ 拒绝采纳（保留 Tier2 结果）', async () => {
    const capture = captureLogs();
    stopCapture = capture.stop;

    const orch = new CompactionOrchestrator();
    const priv = orch as unknown as {
      _runFullCompactionWithTimeout: (
        ...args: unknown[]
      ) => Promise<CompactionOutcome>;
    };
    const original = priv._runFullCompactionWithTimeout;
    priv._runFullCompactionWithTimeout = async (msgs: unknown) => {
      const arr = msgs as ChatMessage[];
      return {
        // 折叠产物比被折叠内容更大（真机同型：169331 → 196778）
        messages: [
          ...arr,
          { role: 'assistant', content: 'FACTS '.repeat(5000) } as ChatMessage,
        ],
        applied: true,
      };
    };

    let outcome: CompactionOutcome;
    try {
      // 短消息 ⇒ Tier2 不生效（applied=false）⇒ 走 Tier3 分支
      outcome = await orch.compact(
        [
          { role: 'user', content: '任务' } as ChatMessage,
          { role: 'assistant', content: '短回复' } as ChatMessage,
        ],
        { model: 'test-model', sessionId: 'sess-size-guard-reject' },
        {
          preEvaluated: {
            decision: 'trigger' as const,
            rawInputTokens: 1_000,
            uncalibratedTotal: 1_000,
            calibratedTotal: 1_000,
            estimateLowerBound: false,
            maxTokens: 1,
            ratio: 1_000,
          },
        }
      );
    } finally {
      priv._runFullCompactionWithTimeout = original;
    }

    expect(
      findByMessage(capture.entries, 'tier3_rejected_no_reduction').length
    ).toBe(1);
    // 拒绝后保留 Tier2（无效果）⇒ 整体未应用（调用方走既有截断兜底）
    expect(outcome.applied).toBe(false);
  });

  test('Tier3 真的变小 ⇒ 采纳；节省率按同口径计算（不为负）+ 仍超窗留痕', async () => {
    const capture = captureLogs();
    stopCapture = capture.stop;

    const orch = new CompactionOrchestrator();
    const priv = orch as unknown as {
      _runFullCompactionWithTimeout: (
        ...args: unknown[]
      ) => Promise<CompactionOutcome>;
      isStillOverBudget: (...args: unknown[]) => Promise<boolean>;
    };
    const originalTier3 = priv._runFullCompactionWithTimeout;
    const originalOver = priv.isStillOverBudget;
    priv._runFullCompactionWithTimeout = async () => ({
      messages: [{ role: 'assistant', content: '折叠摘要' } as ChatMessage],
      applied: true,
    });
    // 强制进入 Tier3 分支（Tier2 之后仍超窗）
    priv.isStillOverBudget = async () => true;

    let outcome: CompactionOutcome;
    try {
      outcome = await orch.compact(
        [
          { role: 'user', content: '任务' } as ChatMessage,
          { role: 'assistant', content: 'x'.repeat(200_000) } as ChatMessage,
        ],
        { model: 'test-model', sessionId: 'sess-size-guard-ok' },
        {
          preEvaluated: {
            decision: 'trigger' as const,
            rawInputTokens: 1_000,
            uncalibratedTotal: 1_000,
            calibratedTotal: 1_000,
            estimateLowerBound: false,
            maxTokens: 1,
            ratio: 1_000,
          },
        }
      );
    } finally {
      priv._runFullCompactionWithTimeout = originalTier3;
      priv.isStillOverBudget = originalOver;
    }

    expect(outcome.applied).toBe(true);
    // 决策口径（校准后）与实测口径分裂 ⇒ 留痕
    expect(
      findByMessage(capture.entries, 'token_estimate_mismatch').length
    ).toBe(1);
    // 压缩后仍超窗 ⇒ 可见告警
    expect(
      findByMessage(capture.entries, 'still_over_budget_after_compaction')
        .length
    ).toBe(1);
    // 节省率按**同一估值器**前后计算 ⇒ 不再出现负节省
    const applied = findByMessage(capture.entries, 'compaction:applied')[0];
    expect(Number(applied?.data?.['savingPercent'])).toBeGreaterThanOrEqual(0);
  });
});

/** 最小可用的 StreamPipeline 上下文（只用到 compactContext 读取的字段） */
function makePipelineContext(): PipelineContext {
  return {
    content: '',
    session: { id: 'sess-compaction-failure' },
    options: { model: 'test-model' },
    apiMessages: [{ role: 'user', content: '历史消息' }],
    toolDefinitions: [],
    accumulatedContent: '',
    finalResponse: null,
    unifiedTracker: { resetStreamTokens() {}, recordCompaction() {} },
    imageContextService: {},
  } as unknown as PipelineContext;
}

describe('B3-3 ②：失败**可被上层感知**（StreamPipeline 不再误报为 skipped）', () => {
  test('编排器返回 failure ⇒ 走 compaction:failed 通道（而非 compaction:skipped）', async () => {
    const capture = captureLogs();
    stopCapture = capture.stop;

    const singleton = compactionOrchestrator as unknown as {
      compact: (...args: unknown[]) => Promise<CompactionOutcome>;
    };
    const original = singleton.compact;
    singleton.compact = async () => ({
      messages: [],
      applied: false,
      failure: {
        reason: 'exception',
        message: 'boom: tier3 exploded',
        probePhase: 'compaction:orchestrate',
        elapsedMs: 7,
      },
    });

    try {
      const pipeline = new StreamPipeline(makePipelineContext());
      const result = await pipeline.compactContext();

      // 兜底行为不变：仍未应用（调用方照旧走截断）
      expect(result.applied).toBe(false);
    } finally {
      singleton.compact = original;
    }

    const failed = findByMessage(capture.entries, 'compaction:failed');
    expect(failed.length).toBe(1);
    expect(failed[0].data?.reason).toBe('exception');
    expect(failed[0].data?.probePhase).toBe('compaction:orchestrate');
    // **不得**再以 skipped 记录（修复前即为此：失败被静默降级）
    expect(findByMessage(capture.entries, 'compaction:skipped')).toHaveLength(
      0
    );
  });

  test('无 failure（真 skip）⇒ 仍记 compaction:skipped（分支判别不误伤）', async () => {
    const capture = captureLogs();
    stopCapture = capture.stop;

    const singleton = compactionOrchestrator as unknown as {
      compact: (...args: unknown[]) => Promise<CompactionOutcome>;
    };
    const original = singleton.compact;
    singleton.compact = async () => ({ messages: [], applied: false });

    try {
      const pipeline = new StreamPipeline(makePipelineContext());
      await pipeline.compactContext();
    } finally {
      singleton.compact = original;
    }

    expect(findByMessage(capture.entries, 'compaction:skipped').length).toBe(1);
    expect(findByMessage(capture.entries, 'compaction:failed')).toHaveLength(0);
  });
});
