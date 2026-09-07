/**
 * Pattern 规范层类型定义（Teamwork P2a，2026-09-06）
 *
 * 声明式"编排模式"描述层：把已有模块组合（PDL 依赖图 / 并行调度 / 对抗编排 / 自我验证）
 * 登记为可命名的 pattern，供 selector 按任务特征选择。本层是**描述层**——不改任何执行
 * 语义；pattern 名下模块组合由既有实现承担（迭代 refine → TAORLoop/ReActToolLoop、
 * parallel-distributed → ParallelAgentScheduler、long-task-pdl → PlanDrivenLoop、
 * competitive-strategy → CompetitiveStrategyOrchestrator、self-verify → VerifierAgent）。
 *
 * 职责区分（CS01/文档 §P1-1）：agent 层 `StrategySelector`（agent 类型→agent 路由）是
 * 运行时 agent 选择；本层 `PatternSelector` 是**编排模式选择**（整条任务的组合形状）。
 */

/** 编排模式名（注册表首批） */
export type PatternName =
  | 'iterative_refine'
  | 'parallel_distributed'
  | 'long_task_pdl'
  | 'competitive_strategy'
  | 'self_verify';

/** 声明式 pattern 描述 */
export interface PatternDescriptor {
  /** 唯一名 */
  name: PatternName;
  /** 展示名 */
  displayName: string;
  /** 何时放行（人类可读准入说明） */
  when: string;
  /** 任务特征（selector 规则用） */
  matches: PatternMatchSpec;
  /** 模式角色集合 */
  roles: string[];
  /** 由哪些现有模块组合而成（组合描述，非新运行时） */
  composedOf: string;
}

/** pattern 匹配特征（selector 输入结构） */
export interface PatternMatchSpec {
  /** 任务复杂度（simple 走快速路径不入 pattern） */
  complexity: 'simple' | 'complex';
  /** 研究型标志（P0-3 门控信号，来自 hasResearchIntent） */
  research?: boolean;
  /** 任务类型（TaskType；可为空——selector 不强依赖） */
  taskType?: string;
}
