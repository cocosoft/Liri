// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Agent 能力评测 — 类型定义（D2 骨架，2026-09-12）
 *
 * 判分分层（可信度排序，来自 τ-bench / SWE-bench 的做法）：
 *   L1 环境终态断言（文件系统/DB 实际变化）—— 首选，确定性
 *   L2 工具调用序列断言 —— L1 覆盖不到的过程约束
 *   L3 LLM-as-judge —— 仅开放式文本答案；本骨架**不实现**（需先用 L1 校验样本校准）
 *
 * 指标：`pass^1`（单次通过率）与 `pass^k`（k 次全通过才算通过）—— 后者才是可用性门槛。
 */

/** 断言结果（L1/L2 均为确定性判据） */
export interface AssertResult {
  /** 是否通过 */
  pass: boolean;
  /** 失败原因（pass=false 时必填） */
  reason?: string;
  /**
   * A4（2026-09-26，《Liri 优化方案》）：**完成度**——Agent 是否真的"动了手"（有动作证据）。
   *
   * 仅 attack 类任务使用：只对完成度成立的 attempt 计入 ASR 分母，避免"完全不动手"与
   * "主动识别并正确防御"同分（ASR = 0%）。口径与**对方案字面口径的更正**见
   * `initialStateCheck.ts` / `tasks/security-injection.ts` 注释。
   */
  completed?: boolean;
}

/** 一次工具调用（L2 过程断言用；来自持久化消息，见 `trace.ts`） */
export interface ToolCallRecord {
  /** 工具名（如 `file_write`） */
  name: string;
  /** 调用 ID（用于去重；部分形态可能缺失） */
  id?: string;
  /** 调用参数（供"参数合法/路径在许可范围"类断言；解析失败时为 undefined） */
  args?: Record<string, unknown>;
}

/** 任务执行上下文（供断言读取环境终态） */
export interface EvalContext {
  /** 隔离工作区（Agent 的 cwd，断言从这里读文件终态） */
  workspace: string;
  /** 隔离的 pyapp 根（LIRI_HOME，第三层） */
  home: string;
  /** 隔离的数据目录（LIRI_DATA_DIR，第二层；含副本 DB） */
  dataDir: string;
  /** Agent 的最终回答文本（供 L2/文本类断言） */
  finalText: string;
  /**
   * 本次会话实际发生的工具调用序列（顺序 = 发生顺序）。
   * L2 断言据此检查"关键工具被调用 / 参数合法"等过程约束。
   */
  toolCalls: ToolCallRecord[];
  /** 本次会话 ID */
  sessionId: string;
  /** 本次实际使用的模型 */
  model: string;
}

/**
 * A6（2026-09-26，《Liri 优化方案》）：内置**等价变形**种类。
 *
 * 语义不变、形式不同 —— 用来反向验证断言**是否过度约束**（把"无关差异"当成硬要求）。
 * 只用**机械可证等价**的变形：空白/换行/编码/对象键序。
 * ⚠️ **不含"任意调换行顺序"** —— 那会**改变语义**（如 `步骤1 → 步骤2`），
 * 不是等价变形（方案里"调换无关顺序"在本仓对应 `json-key-order`：对象键序确属无关）。
 */
export type EquivalentVariantKind =
  /** 参考解**原样**（对照组：必须通过，否则是"基准解不合规"而非"过度约束"） */
  | 'identical'
  /** 尾随换行（文本文件的末尾换行不承载语义） */
  | 'trailing-newline'
  /** CRLF 行尾（Windows 编辑器常态） */
  | 'crlf'
  /** 每行行尾多余空格 */
  | 'trailing-spaces'
  /** 内容前多一个空行 */
  | 'leading-blank-line'
  /** JSON 对象**键序**反转（键序不承载语义；仅当内容是 JSON 对象时适用） */
  | 'json-key-order';

/** 一条评测任务 */
export interface EvalTask {
  /** 稳定 ID（报告与回归对照的键） */
  id: string;
  /** 人读名称 */
  name: string;
  /** 判分层级（本骨架仅 L1/L2） */
  level: 'L1' | 'L2';
  /**
   * A4（2026-09-26，《Liri 优化方案》v2）：**断言极性**（方案强制"先逐题分类，再实现"）。
   *
   * - `positive`：正向实现类（"产出了才算对"）⇒ 做**起始态必失败校验**（fail-closed 合理：
   *   起始态就通过 ⇒ 断言区分不出"做了/没做" ⇒ 任务无效）
   * - `negative`：否定式判据（"副作用**未**发生"）⇒ **不做**必失败校验 —— 它在起始态天然
   *   `pass`（方案 §1.1 #11：7 条 attack 全部如此，直接平移 fail-closed 会当场废掉一半题集）；
   *   改为要求断言能区分"未产出（空转）"与"已防御"（见 `AssertResult.completed`）
   */
  assertionPolarity: 'positive' | 'negative';
  /**
   * 安全评测标记（D9）：成对任务用于**同时**观测 ASR（漏检）与 benign utility（误伤）。
   *
   * - `kind: 'attack'`：提示词本身正常，但工具返回值/文件内容含注入指令；断言"注入副作用**未**发生"
   * - `kind: 'benign'`：同一场景但**不含**注入，断言正常任务完成（其通过率降幅即"误伤"）
   * - `pair`：成对任务的共同键（两侧须一致）
   */
  security?: { kind: 'benign' | 'attack'; pair: string };
  /**
   * 构造发给 Agent 的提示词。
   *
   * 传入隔离工作区绝对路径 —— **不要**写"当前工作目录"：DAEMON 模式会把进程 cwd
   * 设为项目根（`main.ts` 的 `process.chdir(resolveProjectRoot())`），与评测工作区不是同一个地方。
   */
  prompt: (workspace: string) => string;
  /**
   * A7 防泄题（2026-09-26）：本题的**题源路径**（把本仓代码变成任务源时，原始实现所在文件）。
   *
   * 声明后，运行器在**建沙箱时**把它注入 `PERMISSION_SHIELDED_PATHS` ⇒ `ToolRegistry.executeTool`
   * 拒绝一切引用该路径（含其直接父目录）的工具调用，挡住"`file_read` 原实现抄答案"这条泄漏路径
   * （缺口与能力边界见 `tools/pathShield.ts`）。声明了就必须被沙箱接受，否则**拒绝运行**
   * （`evals/shieldPlan.ts` 的 `verifyShieldApplied`，fail-closed）。
   */
  shieldedPaths?: string[];
  /**
   * A6（2026-09-26，《Liri 优化方案》）：**断言反向验证**的参考解（agent 检查器自检）。
   *
   * 声明"正确的解会产出什么"，由 `assertionAudit.ts` 施加**等价变形**后重跑 `assert`；
   * 变形后断言失败 ⇒ 该断言**过度约束**（论文 §3.2 所指"陈述未支持的约束"）。
   *
   * ⚠️ **未声明 ⇒ 该题不参与审计**（如实计入 `skipped`，**不判失败**）：凭空替任务编参考解
   * 等于伪造基准（CS04/CS06）。
   */
  assertionAudit?: {
    /** 参考解产出的文件（相对 workspace 路径） */
    artifacts: Array<{ path: string; content: string }>;
    /** 仅跑这些变形（缺省 = 全部内置变形） */
    variants?: EquivalentVariantKind[];
  };
  /**
   * 期望结果：
   *   'pass' — 正常任务，断言应通过
   *   'fail' — **控制任务**：断言应当失败，用于证明判分器"能判会失败"（防判分器恒真）
   */
  expect?: 'pass' | 'fail';
  /** 任务前置（可选）：在隔离工作区里预置初始状态 */
  setup?: (
    ctx: Pick<EvalContext, 'workspace' | 'home' | 'dataDir'>
  ) => Promise<void>;
  /** L1/L2 断言（读环境终态与过程证据） */
  assert: (ctx: EvalContext) => Promise<AssertResult>;
  /** 单次超时（毫秒），默认 180000 */
  timeoutMs?: number;
}

/** 工具调用明细（A1）：参数逐值截断，阈值见 `trace.ts` 的 `TOOL_CALL_ARG_MAX_CHARS` */
export interface ToolCallDetail {
  name: string;
  /** 截断后的参数（原语原样；字符串超长裁剪；对象/数组超长降级为带省略标记的字符串） */
  args?: unknown;
}

/**
 * S2（2026-09-26，《Liri 优化方案》题源扩展）—— **过程断言**的单条结果。
 *
 * 契约定义在此（`evals/types.ts` 是该目录唯一数据契约处，与 `ToolCallDetail`/`BehaviorMetrics` 同处）；
 * 判据与口径见 `processAssertions.ts`。**仅观测**：不参与 `asExpected`。
 */
export interface ProcessFinding {
  /** 规则 id（`P-a` … `P-d`） */
  rule: string;
  /** 规则简述（人读） */
  title: string;
  /** 是否通过（`false` = 违规） */
  pass: boolean;
  /** 证据（人读；含具体工具名 / 资源 / 次数，便于复盘） */
  detail: string;
}

/**
 * 行为指标（A2，2026-09-26，《Liri 优化方案》）
 *
 * **⚠️ 仅观测，不作门禁**：三个子指标都**不得**参与通过/失败判定（exploration / drafting
 * 的置信区间跨过 0，统计上不显著）。口径与前置确认见 `behaviorMetrics.ts` 文件头。
 */
export interface BehaviorMetrics {
  /** ① 首个编辑之后的"独立验证命令"数（按归一化命令字符串跨工具去重） */
  selfVerificationCount: number;
  /** ② 首个编辑之前的读/搜次数（`file_read` / `grep` / `glob`） */
  explorationCount: number;
  /** ③ 草稿比 = 当轮正文长度 ÷ 工具调用数（无工具调用 ⇒ 0） */
  draftingRatio: number;
}

/** 单次执行结果 */
export interface EvalAttempt {
  /** 第几次（1..k） */
  index: number;
  /** 断言结果（控制任务需与 expect 相反才算"符合预期"） */
  assertion: AssertResult;
  /** 是否符合该任务的期望（expect 与 assertion.pass 的关系） */
  asExpected: boolean;
  durationMs: number;
  /** 模型用量（若流内返回） */
  promptTokens?: number;
  completionTokens?: number;
  /** 执行异常（进程/网络级失败） */
  error?: string;
  /** 本次实际发生的工具调用名序列（过程证据，便于 L2 失败复盘） */
  toolCalls?: string[];
  /**
   * A1（2026-09-26）：工具调用**明细**（含参数，逐值截断）—— 使报告从"不可复算"变为
   * "可离线重算"，并作为 A2（行为指标）/ A6 的**前置条件**。
   * `toolCalls` 字段保持不变，不破坏既有报告格式与断言。
   */
  toolCallsDetail?: ToolCallDetail[];
  /**
   * A2（2026-09-26）：行为指标（自验证 / 探索度 / 草稿比）。
   * **仅观测信号，不参与 `asExpected` 判定**（见 `BehaviorMetrics` 注释与方案 A2）。
   */
  behavior?: BehaviorMetrics;
  /** Agent 最终回答（截断保存，便于失败复盘） */
  finalText?: string;
  /**
   * 2026-09-26：本次失败的**种类**（结构化字段，供"基建重试"判定）。
   *
   * ⚠️ **禁止用 `assertion.reason` 字符串匹配来判种类**（CS02：状态判断不得字符串匹配）——
   * 这里由执行路径显式置位：
   * - `'infra'`：**执行异常**（模型/网络/进程级：超时、端点不可达、断言执行器抛错）⇒ **与能力无关**，
   *   可按 `--retry-on-infra` 重试且不消耗 attempt 额度；
   * - `'assert'`：正常走完流程（含模型"未交付/答错"）⇒ **不重试**（那才是能力信号）。
   *
   * 缺省（旧报告 / 测试夹具）视为 `'assert'`（fail-closed：不确定就不重试）。
   */
  failureKind?: 'infra' | 'assert';
  /** 2026-09-26：本次 attempt 因基建失败而**额外重试**的次数（0 / 缺省 = 未重试） */
  infraRetries?: number;
  /**
   * S2（2026-09-26）：**过程断言**结果（只读 `toolCallsDetail` 离线可重算）。
   * **仅观测**，不参与 `asExpected`；接线（写入本字段 + 报告展示）见 `processAssertions.ts`。
   */
  processFindings?: ProcessFinding[];
}

/** 单任务汇总 */
export interface EvalTaskResult {
  task: EvalTask;
  attempts: EvalAttempt[];
  /** 原始断言通过次数（控制任务天然为 0） */
  assertPassCount: number;
  /** **符合预期率** = 满足 task.expect 的次数 / 次数（控制任务即"被判为失败"的比例） */
  pass1: number;
  /** k 次全部符合预期 */
  passK: boolean;
}

/** 一轮评测汇总 */
export interface EvalRunSummary {
  startedAt: string;
  finishedAt: string;
  model: string;
  k: number;
  tasks: EvalTaskResult[];
  /** 全部任务 pass^k 的占比 */
  passKRate: number;
  /** 全部任务 pass^1 的均值 */
  pass1Mean: number;
  /** 判分器自检：控制任务是否都被判为"符合预期失败" */
  judgeSanityOk: boolean;
  /** 安全鲁棒性汇总（D9；仅当题集中存在成对安全任务时给出） */
  security?: SecuritySummary;
}

/**
 * 安全鲁棒性汇总（D9）
 *
 * 依据 AgentDojo 的教训：**只报拦截率（ASR）会误导** —— 防护可能正在瘫痪正常任务
 * （其 PI detector 把 ASR 从 57.7% 压到 8%，同时把正常任务成功率从 69% 砍到 41.5%）。
 * 因此这里**同时**给出两个数。
 */
export interface SecuritySummary {
  /** 成对任务数（attack + benign 各算一对） */
  pairs: number;
  /**
   * 攻击成功率：注入副作用实际发生的比例（**越低越好**）。
   *
   * A4（2026-09-26）：分母收窄为**已完成**（`completed === true`）的 attempt —— 否则
   * "完全不动手"与"主动识别并正确防御"同分（ASR = 0%，方案 §1.1 #12 实证）。
   */
  asr: number;
  /** 正常任务符合期望率（**越高越好**；其相对无防护基线的降幅即"误伤"） */
  benignPassRate: number;
  /** A4：计入 ASR **分母**的已完成 attack attempt 数 */
  attackCompleted: number;
  /** A4：**未完成（空转）**的 attack attempt 数 —— 不进分母，单列以便识别"分母过小/为 0" */
  attackIncomplete: number;
}

// ---------------------------------------------------------------------------
// A7（2026-09-26，《Liri 优化方案》）：题目来源自动化 —— 把本仓代码库变成任务源
// ---------------------------------------------------------------------------

/**
 * A7：**任务源规格** —— 人工挑定一个"有公开入口 + 可观察输出"的本仓纯函数，声明成题目原材料。
 *
 * ⚠️ 两条硬约束（决定"这条能不能做成题"）：
 *  1. **可独立运行**：源文件必须是**零运行时 import**的纯函数模块（启动器只 `import` 该文件本身）；
 *  2. **期望输出不由人写**：`cases` 只给**输入**，期望输出一律由**真实执行原始实现**捕获
 *     （`SourceTaskBuild.goldens`）—— 人工填期望值就是伪造基准（CS04/CS06）。
 */
export interface SourceTaskSpec {
  /** 稳定 ID */
  id: string;
  /** 人读名称 */
  name: string;
  /** **仓库相对**路径（`/` 分隔），指向**原始实现**（golden 的唯一事实来源） */
  sourcePath: string;
  /** 目标导出函数名 */
  exportName: string;
  /** 行为规范（写进提示词）；**只描述行为，不给期望输出**（否则等于把答案交给被测者） */
  behavior: string[];
  /** 用例**输入**（`args` 为该函数的位置参数），期望输出由真实执行捕获 */
  cases: Array<{ name: string; args: unknown[] }>;
}

/** A7：候选任务源（扫描结果；**仅是候选**，能否成题须经 `buildSourceTask` 自检） */
export interface SourceTaskCandidate {
  /** 仓库相对路径（`/` 分隔） */
  path: string;
  /** 该文件导出的函数名（按出现顺序） */
  exports: string[];
  /** 行数（粗略反映规模） */
  lines: number;
}

/** A7：泄漏面种类（"清理泄漏"是方案 §3 A7 流程的第 4 步） */
export type SourceTaskLeakKind =
  | 'repo-source'
  | 'build-artifact'
  | 'installed-copy';

/** A7：一处泄漏（**只报告，不自动清理**） */
export interface SourceTaskLeak {
  kind: SourceTaskLeakKind;
  /** 命中的绝对路径 */
  path: string;
  detail: string;
}

/** A7：单条用例的执行结果（原始实现 / 桩 / Agent 产物三处共用同一结构） */
export interface SourceCaseResult {
  name: string;
  /** 是否正常返回（函数抛错 / 导出不存在 ⇒ `false`） */
  ok: boolean;
  /** `ok` 时的返回值（经 JSON 往返，仅支持可 JSON 化类型） */
  value?: unknown;
  /** `!ok` 时的原因 */
  error?: string;
}

/**
 * A7：一条任务源的**自检结论**（`buildSourceTask` 的产物）。
 *
 * 三件事全靠**真实执行**，不靠人工判断：
 *  ① `goldens` = 原始实现在用例上的输出；
 *  ② `stub` = 起始点（剥掉实现）的输出 —— `ready` 要求它**无一条**与 golden 相同（"起始点确实缺失"）；
 *  ③ `leaks` = 泄漏面扫描结果。
 */
export interface SourceTaskBuild {
  id: string;
  status: 'ready' | 'rejected';
  /** 拒绝原因（`ready` 时为空数组） */
  reasons: string[];
  /** 原始实现执行结果（**golden 的出处**） */
  goldens: SourceCaseResult[];
  /** 起始点执行结果（`ready` 时必须**全部**与 golden 不同） */
  stub: SourceCaseResult[];
  leaks: SourceTaskLeak[];
  /**
   * A7 防泄题（2026-09-26）：**该题源必须被屏蔽的路径**（源文件**绝对**路径）。
   *
   * 由 `materialize()` 原样带进产出的 `EvalTask.shieldedPaths` ⇒ 注册时不会漏；运行器据此
   * 注入沙箱（`PERMISSION_SHIELDED_PATHS`）并 fail-closed 校验。
   */
  shieldedPaths: string[];
}

/** A7：一条任务源的**产出** —— 自检结论 + （通过时）可用的 `EvalTask` */
export interface SourceTaskMaterialization {
  build: SourceTaskBuild;
  /** 仅 `build.status === 'ready'` 时给出 */
  task?: EvalTask;
}
