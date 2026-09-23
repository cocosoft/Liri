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
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';
import type { StructuredLogEntry } from '../../src/monitoring/logs/types.js';

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
            beforeTokens: 200_000,
            snapshot: { tokens: 200_000, maxTokens: 1_000, ratio: 200 },
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
          beforeTokens: 10,
          snapshot: { tokens: 10, maxTokens: 1_000, ratio: 0.01 },
        },
      }
    );
    expect(outcome.applied).toBe(false);
    expect(outcome.failure).toBeUndefined();
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
