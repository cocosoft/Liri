/**
 * Pattern 规范层类型定义（Teamwork P2a，2026-09-06）
 *
 * 声明式"编排模式"描述层：把已有模块组合（PDL 依赖图 / 并行调度 / 对抗编排 / 自我验证）
 * 登记为可命名的 pattern，供 selector 按任务特征选择。本层是**描述层**——不改任何执行
 * 语义；pattern 名下的模块组合以 `PatternDescriptor.assembly`（角色→承担方绑定）表达，
 * 模块实例化仍由既有实现承担（A8：原为自由文本 `composedOf`，程序无法消费）。
 *
 * 职责区分（CS01/文档 §P1-1）：agent 层 `StrategySelector`（agent 类型→agent 路由）是
 * 运行时 agent 选择；本层 `PatternSelector` 是**编排模式选择**（整条任务的组合形状）。
 */

import type { FeatureFlag } from '../featureFlags.js';

/** 编排模式名（注册表首批） */
export type PatternName =
  | 'iterative_refine'
  | 'parallel_distributed'
  | 'long_task_pdl'
  | 'competitive_strategy'
  | 'self_verify';

/**
 * 装配入口标识（承接本模式的装配器）——**闭集**。
 *
 * A8（2026-10-01）：与 `PatternName` 取值同域但**语义不同** —— 前者是"模式名"（选什么），
 * 后者是"装配入口"（由谁承接）。`validatePatterns()` 强制二者双向一一对应，防止注册表
 * 手写漂移。未来若多个模式复用同一装配机制，只需放宽该校验。
 */
export type PatternAssemblerId =
  | 'iterative_refine'
  | 'parallel_distributed'
  | 'long_task_pdl'
  | 'competitive_strategy'
  | 'self_verify';

/**
 * 承担方稳定标识（模块/组件级）——**闭集**。
 * 非用户可见文案，仅作装配绑定用（CS02：状态/装配判定不得依赖用户可见字符串）。
 *
 * T-①04 T1-3（A 解析层）：由 `type` 联合改为 **`as const` 数组 + 派生类型**，使闭集
 * **运行期可枚举** —— 装配解析层与契约自检据此断言"无悬空 provider"（`type` 联合
 * 无法迭代）。**取值域逐字不变**。
 */
export const PATTERN_PROVIDERS = [
  'taor_loop',
  'react_tool_loop',
  'parallel_agent_scheduler',
  'result_aggregator',
  'plan_driven_loop',
  'task_decomposer',
  'competitive_strategy_orchestrator',
  'verifier_agent',
] as const;

export type PatternProvider = (typeof PATTERN_PROVIDERS)[number];

/** 角色 → 承担方绑定（`role` 必须 ∈ `PatternDescriptor.roles`） */
export interface PatternRoleBinding {
  /** 模式角色（与 descriptor.roles 同域） */
  role: string;
  /** 承担该角色的实现标识 */
  providers: PatternProvider[];
}

/**
 * 可执行装配描述 —— 替代原 `composedOf: string` 散文（A8，2026-10-01）。
 *
 * 原字段是自由文本，程序无法解析/校验/消费 ⇒ selector 即便返回 pattern 名，消费方也无从
 * 决策。本结构把"由哪些模块组合而成"表达为**闭集标识 + 角色绑定**，使消费方可直接读
 * `assembler` 判定去向（见 `ChatManager._maybeLaunchPdca` 的研究分流）。
 *
 * 边界（如实）：本层仍**不新建编排运行时** —— 装配器实例化（真正 new 出编排）归后续
 * 立项（待执行清单 T-①04/A4）。
 */
export interface PatternAssembly {
  /** 承接本模式的装配入口 */
  assembler: PatternAssemblerId;
  /** 角色 → 承担方绑定（须与 `roles` 一一对应） */
  bindings: PatternRoleBinding[];
}

/**
 * 执行配方（13-P1-3，2026-10-05）——把装配从「是否走某条路线」升级为**可执行参数**。
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A1 —— 装配结果原只回答"是否走研究编排"
 * 一个布尔问题，未携带 Pattern 应有的执行配方（并发度 / 验证策略 / 预算策略）。
 *
 * 消费方式：由装配入口规格（`query/patternAssembler.ts#ASSEMBLER_SPECS`）携带，并在
 * `instantiatePattern()` 结果里返回；消费方据此配置**既有**运行时（**不新建运行时**）。
 *
 * ⚠️ 落点说明（如实）：配方放在装配入口规格（app 层）而非描述符数据 —— 它是**运行期关切**，
 * 单一落点避免与描述符目录（声明式数据）耦合；类型契约在此共享。
 */
export interface PatternRecipe {
  /** 运行线路（决定使用哪个既有运行时） */
  loopKind: 'research' | 'verify';
  /** 并发度上限（未声明 ⇒ 用运行时默认；**不臆造值**） */
  concurrency?: number;
  /** 验证策略：`off` 不验证 / `advisory` 记录不阻断 / `blocking` 不通过即不放行 */
  verifyPolicy: 'off' | 'advisory' | 'blocking';
  /** 预算策略：`strict` 收紧重试与循环上限 / `default` 运行时默认 */
  budgetPolicy: 'default' | 'strict';
}

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
  /** 可执行装配描述（由哪些现有模块组合而成，非新运行时） */
  assembly: PatternAssembly;
}

/** pattern 匹配特征（selector 输入结构） */
export interface PatternMatchSpec {
  /** 任务复杂度（simple 走快速路径不入 pattern） */
  complexity: 'simple' | 'complex';
  /** 研究型标志（P0-3 门控信号，来自 hasResearchIntent） */
  research?: boolean;
  /**
   * 自校验意图标志（2026-10-07，`pattern-wiring-closure.md` §4）：来自 `hasVerifyIntent`。
   * 供 `self_verify` 模式的触发规则消费。
   */
  verify?: boolean;
}

/**
 * 触发规则项（2026-10-07）—— selector 的**声明式**规则（唯一事实源）。
 *
 * 用途（CS01 归一化）：既驱动 `selectPattern`，也驱动目录的「可达性」判定
 * （`isPatternReachable`）—— 避免"选择层命令式 if"与"展示层另写的可用性判断"两处漂移。
 *
 * ⚠️ 本类型只描述**匹配条件与门控**；装配/运行时归属见 `PatternAssembly`（两件事，不混用）。
 */
export interface PatternSelectionRule {
  /** 命中的模式名 */
  name: PatternName;
  /** 任务复杂度必须相等（simple 快速路径不套 pattern ⇒ 规则均声明 complex） */
  complexity: 'simple' | 'complex';
  /** 声明 `true` ⇒ 要求 `spec.research === true`（缺省 = 不约束） */
  research?: true;
  /** 声明 `true` ⇒ 要求 `spec.verify === true`（缺省 = 不约束；2026-10-07 新增） */
  verify?: true;
  /** 命中后**仍需**开启的功能开关（缺省 = 无门控）；只声明名，解析走 `core#feature` */
  feature?: FeatureFlag;
}
