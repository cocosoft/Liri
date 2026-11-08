/**
 * 压缩执行结果与失败归因（**纯类型 leaf**，2026-11-08）
 *
 * 从 `CompactionOrchestrator` 拆出：`tier3Timeout` 需要 `CompactionOutcome`，
 * 而编排器又 import `tier3Timeout` ⇒ 形成 `CompactionOrchestrator ↔ tier3Timeout` 循环
 * （CI `madge --circular` 基线 0，阻断）。类型下沉到本文件后，两者都只依赖这里。
 *
 * 公开面不变：`CompactionOrchestrator` 仍 re-export 这些类型。
 */

import type { ChatMessage } from '@modules/ai';
import type { RetentionResult } from './retentionProbe';

/**
 * P1-2（2026-08-27）：摘要调用信封——记录 Tier3 摘要生成的模型调用信息，
 * 使一次摘要请求可从日志/事件重建（对标 dsh compaction/summary 的
 * provider/model/maxTokens/usage + llmStreamCall 标记）。
 */
export interface CompactionSummaryEnvelope {
  /** 摘要调用使用的模型名 */
  model: string;
  /** 生成上限（max_tokens） */
  maxTokens?: number;
  /** 摘要调用的 token 使用（provider 返回） */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** 是否使用了结构化 5 字段摘要（false = 回退纯文本） */
  structured: boolean;
}

/**
 * B3-3（2026-09-23）：压缩**失败**的结构化归因。
 *
 * **为什么需要**：压缩失败（`_doCompact` 抛异常）此前只有一个 `applied:false` 返回值 ——
 * 与"决策 skip / 压缩无效果"**无法区分** ⇒ 调用方（如 `StreamPipeline.compactContext`）
 * 把失败记成 `compaction:skipped`，随后静默走截断兜底：**失败不可见、不可归因**
 * （方案 §5 B3-3「今日实测本会话 2 次 `phase=failed` 后走截断」）。
 *
 * 本结构让失败**可被上层感知**（返回值）+ **可归因**（`probePhase` 与 loopProbe 的
 * `compaction:orchestrate` 相位打通）；**兜底行为不变**（仍返回 `applied:false`，调用方
 * 照旧走截断）。
 */
export interface CompactionFailure {
  /** 失败原因码（机器可读枚举，禁止按文案判别 —— CS02） */
  reason: 'exception';
  /** 原始错误信息（诊断用） */
  message: string;
  /** loopProbe 阶段归因：失败发生时活跃的最内层阶段（正常必为 `compaction:orchestrate`；探针关闭时为 null） */
  probePhase: string | null;
  /** 失败前的耗时（ms） */
  elapsedMs: number;
}

/** 压缩执行结果（P1-2 扩展：success 时携带摘要调用信封供事件重建） */
export type CompactionOutcome = {
  messages: ChatMessage[];
  applied: boolean;
  summaryEnvelope?: CompactionSummaryEnvelope;
  /**
   * B3-3：失败归因（仅失败时存在）。**存在即表示"这次压缩尝试失败"**，
   * 与"未触发/无效果"（`applied:false` 但无 `failure`）区分开。
   */
  failure?: CompactionFailure;
  /**
   * M5（2026-10-06）：Tier 3 折叠后「关键实体保留度」（跨批按实体总量加权聚合）。
   * 仅 **Tier 3** 产出（Tier 1/2 按设计有损、无摘要 ⇒ 缺省）。**仅观测，不改压缩行为**。
   */
  retention?: RetentionResult;
};
