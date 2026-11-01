/**
 * `ClassifierDecision` —— 分类器决策结果的**类型叶子**（自 `AutoModeClassifier.ts` 抽离）。
 *
 * **为什么抽离**（2026-09-26，CI `Static Checks` 的循环依赖门禁 10 > 基线 7）：
 * `injection-rules.ts` / `vector-rules.ts` 需要该类型，原先是
 * `import type { ClassifierDecision } from './AutoModeClassifier'` ⇒ 形成
 * `AutoModeClassifier ↔ injection-rules` 与 `AutoModeClassifier ↔ vector-rules` 两条**环**
 * （`madge --circular` 计数**包含 `import type`**，故类型位置也会被计环）。
 *
 * 本文件**零 import**（纯类型叶子）⇒ 两个 rules 与 `AutoModeClassifier` 都改为从这里取类型，
 * 回边消失、环被物理打断；运行时行为**零变化**（TS 类型擦除）。
 * 对外导出路径保持不变：`AutoModeClassifier.ts` 以 `export type` 再导出本类型。
 */

/**
 * 分类器决策结果
 */
export interface ClassifierDecision {
  /**
   * 是否应该阻止
   */
  shouldBlock: boolean;
  /**
   * 阻止原因
   */
  reason?: string;
  /**
   * 分类器是否不可用
   */
  unavailable?: boolean;
  /**
   * 转录是否太长
   */
  transcriptTooLong?: boolean;
  /**
   * 分类器使用信息
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  /**
   * 使用的模型
   */
  model?: string;
  /**
   * 执行耗时（毫秒）
   */
  durationMs?: number;
}
