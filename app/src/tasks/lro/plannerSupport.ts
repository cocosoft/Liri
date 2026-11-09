// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * plannerSupport —— 计划生成/修复与步骤拓扑（LRO 拆分批 U-22/S1）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `roleToolNames`（模块级）/
 * `_groupStepsByDependency` / `_repairPlanJson` / `_repairAcceptanceCriteria`。
 *
 * **职责（单一：把 planner 输出变成可执行计划）**：
 *   ① 角色工具名派生（按 `RoleConfig.taskType` 从 TOOL_CATEGORIES 取，禁止手写清单）；
 *   ② `dependsOn` 拓扑批次分组（循环依赖兜底串行）；
 *   ③ 计划 JSON 修复重问（一次）与验收标准纠正（一次）。
 *
 * **行为等价**：提示词文案、日志字段、失败返回 `undefined` 的语义**逐字未变**。
 */

import { existsSync, readdirSync } from 'fs';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
// 2026-11-09：纠正/修复重问与主规划**共用同一输出预算**（DB `max_output_tokens`，禁止写死）
import { ModelRegistry, modelRouter } from '@modules/ai';

import { getRealToolNamesForTask } from '../../tools/index.js';
import {
  extractFirstJsonObject,
  parsePlanDraft,
  stripOuterFence,
  type PlanDraft,
} from '../planOutputParser';
import type { PlanStep } from '../TaskOrchestrator';
import {
  normalizeExecutorResult,
  PLANNER_ROLE,
  type ExecutorFn,
  type RoleConfig,
} from './contracts.js';

const logger = getLogger('tasks:longRunning');

/**
 * Planner 单次调用的**回退输出上限**（DB 无 `max_output_tokens` 时使用）。
 *
 * 为什么不沿用 provider 默认 4096：思考型模型（`capabilities` 含 `thinking`）会把
 * 输出预算先花在思考上 ⇒ 预算不足时 content 为空、也没有 tool_call，计划被判
 * `empty-output`（真机 `pdca_mw7q12pb`：`output_tokens=4096` 连续两次、耗时 62/70s）。
 *
 * 2026-11-08（真机 `pdca_mw7te6i5`）：**写死 8192 不够** —— `deepseek-v4-pro` 的
 * DB 上限是 16384，却只给 8192，思考吃光后 140s 返回空计划（`finish_reason=max_tokens`）。
 * ⇒ 预算必须读 DB（`model-usage.md` 的「模型属性唯一事实来源」），本常量仅作回退。
 */
const LRO_PLANNER_FALLBACK_MAX_OUTPUT_TOKENS = 8192;

/**
 * 解析 Planner 的输出上限：**优先 DB** 的 `max_output_tokens`，缺失/异常才回退。
 *
 * 模型由 `modelRouter.resolve(PLANNER_ROLE.taskType)` 解析（任务分工 / DB 唯一事实来源），
 * 与默认执行器内 `modelRouter.resolve(params.taskType)` 同一口径 ⇒ 取的正是即将调用的模型。
 *
 * 2026-11-09（真机 `pdca_mw8uz6mf`）：**纠正 / 修复重问也必须传同一预算** —— 两处此前未传
 * ⇒ 退回 provider 默认 4096 ⇒ 思考吃光后 `finish_reason=max_tokens, outputLength=0`，
 * 纠正与修复各白烧一次调用，结论只能降级为"保留原样"。
 */
export function resolvePlannerMaxOutputTokens(): number {
  try {
    const modelId = modelRouter.resolve(PLANNER_ROLE.taskType);
    const maxOutput =
      ModelRegistry.getInstance().getModel(modelId)?.maxOutputTokens;
    return typeof maxOutput === 'number' && maxOutput > 0
      ? maxOutput
      : LRO_PLANNER_FALLBACK_MAX_OUTPUT_TOKENS;
  } catch {
    // @ignore-catch — 解析失败不影响规划：回退到已知安全值
    return LRO_PLANNER_FALLBACK_MAX_OUTPUT_TOKENS;
  }
}

/**
 * 角色可用工具名：由角色的**任务类型**经 `TOOL_CATEGORIES` 派生（单一事实源）。
 *
 * 2026-10-08：禁止手写工具名清单 —— 原 `RoleConfig.toolsets`（hermes 名）展开后 19/23
 * 永不命中 ⇒ 步骤 0 工具可用（事故指纹：73 步 / 0 次工具调用）。
 */
export function roleToolNames(role: RoleConfig): string[] {
  return role.useTools ? getRealToolNamesForTask(role.taskType) : [];
}

/**
 * D2（M3，2026-08-13）：按 step.dependsOn 做拓扑批次分组。
 * 无 dependsOn 的步骤视为相互独立（可并行）；有 dependsOn 的步骤延迟到依赖批次之后。
 * 当前 PDCA 流程未填充 dependsOn → 单批次（全部独立）；依赖模型启用后自动生效。
 * 死锁/循环依赖兜底：整批剩余步骤串行执行（不阻塞主流程）。
 */
export function groupStepsByDependency(steps: PlanStep[]): PlanStep[][] {
  const remaining = new Map(steps.map((s) => [s.id, s]));
  const batches: PlanStep[][] = [];

  while (remaining.size > 0) {
    const ready: PlanStep[] = [];
    for (const step of remaining.values()) {
      const deps = step.dependsOn ?? [];
      // 依赖不在剩余集合 = 已执行完成或属于更早批次
      if (deps.every((d) => !remaining.has(d))) ready.push(step);
    }
    if (ready.length === 0) {
      // 循环依赖或残留依赖缺失：兜底按剩余顺序串行执行
      batches.push([...remaining.values()]);
      remaining.clear();
      break;
    }
    for (const s of ready) remaining.delete(s.id);
    batches.push(ready);
  }
  return batches;
}

export interface PlannerRepairDeps {
  taskId: string;
  executor: ExecutorFn;
  isolation: Parameters<ExecutorFn>[0]['isolation'];
}

/**
 * 2026-11-08（真机）：**规划阶段的路径约束**。
 *
 * 执行期的步骤 prompt 早已要求"路径相对工作区"，但**规划阶段没有任何约束** ⇒ planner 反复
 * 把步骤/验收标准的落点写成 `/tmp/xxx`（Unix 绝对路径）或 `C:\...`，执行期一律被越界守卫
 * 拒绝（真机 `pdca_mw6mktrf` / `pdca_mw6mq5qz`：step_1 空转数轮、审查 5 分、目标不收敛）。
 *
 * 三个 prompt 共用本段（首轮规划 / JSON 修复重问 / 验收标准重写），避免各写一份漂移。
 */
export function workspacePathConstraint(workspace: string): string {
  const workspaceEmpty = isWorkspaceEmpty(workspace);
  return [
    '【路径约束（硬性）】',
    `本任务工作区根目录: \`${workspace}\``,
    '- steps 与 acceptanceCriteria 里出现的**所有文件路径必须是工作区相对路径**（如 `output/report.md`）；',
    '- 禁止 `/tmp/...`、`%TEMP%\\...`、`C:\\...`、`~/...` 等绝对路径或工作区外路径 ——',
    '  执行器会按"越界"直接拒绝，该步骤必然失败。',
    // 2026-11-08（真机 `pdca_mw7tlrc4`）：Planner 把"统计 app/src/tasks 下 .ts 数"写成步骤，
    // 理由是"app/src/... 也是相对路径"。但那是**仓库**相对路径，工作区里根本不存在该目录
    // ⇒ 执行器 glob 全是空结果、反复换 pattern 直到 IO 守卫中止。必须把"工作区 ≠ 仓库"说清。
    // 2026-11-09：cwd 对齐会话工作区后，工作区**可能本来是项目目录** ⇒ 不能再断言
    // "仓库代码不在工作区里"（真机 `pdca_mw8uz6mf` 的工作区就已有文件）。改为"先 glob 确认"。
    `- 工作区当前内容：${workspaceEmpty ? '**空目录**（本任务还没有任何文件）' : '已有文件（会话工作区原有内容 + 本任务产物）'}；`,
    '- 需要仓库/项目源码时**先用 `glob` 确认该路径在工作区里确实存在**再规划读取；不存在则不要规划' +
      '"遍历 / 统计 / 浏览仓库源码"的步骤（glob/grep 只会得到空结果）。本任务**没有 `projectId`**，`read_project_file` 不可用。',
  ].join('\n');
}

/** 工作区是否为空（规划期事实快照；读失败按"空"处理，只影响提示词措辞） */
export function isWorkspaceEmpty(workspace: string): boolean {
  try {
    if (!existsSync(workspace)) return true;
    return readdirSync(workspace).length === 0;
  } catch {
    // @ignore-catch — 仅影响提示词措辞，不影响规划
    return true;
  }
}

/**
 * U-01（2026-10-17）：Planner 输出修复重问（只做一次）。
 *
 * 与 `repairAcceptanceCriteria` 同模式：把不可解析的原始输出回灌，要求**仅输出 JSON**。
 * 返回 `undefined` 表示修复不可用 —— 调用方据此整体失败（不再行切兜底）。
 */
export async function repairPlanJson(
  deps: PlannerRepairDeps,
  description: string,
  originalOutput: string,
  reason: string
): Promise<PlanDraft | undefined> {
  const prompt = [
    '你先前输出的执行计划无法被 JSON 解析。请**只输出修正后的 JSON**（不要围栏、不要解释、不要前后缀）。',
    '',
    `任务描述: ${description}`,
    workspacePathConstraint(deps.isolation.workspace),
    `解析失败原因: ${reason}`,
    '',
    '【原始输出（可能被截断）】',
    originalOutput.slice(0, 6000),
    '',
    '【输出格式】',
    '{"steps": ["步骤1描述", "步骤2描述"], "acceptanceCriteria": ["步骤1验收", "步骤2验收"], "dependsOn": [[], [0]]}',
    'steps 必须是非空字符串数组（1–10 条）；acceptanceCriteria 条数须与 steps 一致；',
    'dependsOn 可选，只允许引用更早步骤的下标（0-based）。',
  ].join('\n');

  try {
    const raw = await deps.executor({
      systemPrompt: PLANNER_ROLE.systemPrompt,
      userPrompt: prompt,
      tools: roleToolNames(PLANNER_ROLE),
      taskType: PLANNER_ROLE.taskType,
      // 2026-11-09：与主规划同预算，避免思考型模型把 4096 吃光后返回空
      maxTokens: resolvePlannerMaxOutputTokens(),
      isolation: deps.isolation,
    });
    const text = normalizeExecutorResult(raw).content;
    const finishReason = typeof raw === 'string' ? undefined : raw.finishReason;
    const parsed = parsePlanDraft(text);
    if (!parsed.ok) {
      // 2026-11-09（真机 01:56:41 同族日志 `Unexpected EOF`）：只报 reason 无法区分
      // 「格式错」与「被 max_tokens 截断」—— 后者换同一提示词重问只会再截一次。
      const truncated =
        /^(max_tokens|length)$/i.test(finishReason ?? '') ||
        /Unterminated|Unexpected end|Unexpected EOF/i.test(parsed.reason);
      logger.warn('[orchestrator] Planner JSON 修复重问仍不可解析', {
        taskId: deps.taskId,
        reason: parsed.reason,
        finishReason,
        outputLength: text.length,
        ...(truncated ? { truncated: true } : {}),
      });
      return undefined;
    }
    logger.info('[orchestrator] Planner JSON 修复重问成功', {
      taskId: deps.taskId,
      steps: parsed.draft.steps.length,
    });
    return parsed.draft;
  } catch (e) {
    await handleError(e, {
      module: 'tasks:longRunning',
      action: 'repairPlanJson',
    });
    return undefined;
  }
}

/**
 * 验收标准**一次纠正**（2026-10-08，方案1 全面修复）：
 * 要求 planner **只重写 `acceptanceCriteria`**（步骤描述与顺序不变、条数对齐），
 * 使每条都落在"工具输出可直接证明"的范围内。
 *
 * 返回 `undefined` 表示纠正不可用（解析失败/条数不齐/调用异常）—— 调用方**保留原验收标准**
 * （绝不因纠正失败而丢条件）。
 */
export async function repairAcceptanceCriteria(
  deps: PlannerRepairDeps,
  description: string,
  steps: readonly string[],
  offending: readonly string[],
  /** PR-5：`form-only` = 可证但过于形式化（如只要求 grep 命中条数） */
  mode: 'unprovable' | 'form-only' = 'unprovable'
): Promise<string[] | undefined> {
  const stepList = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const intro =
    mode === 'form-only'
      ? '你先前给出的验收标准中，下列条目**过于形式化**（只要"命中/非空/存在/成功"这类形式条件，空壳稿也能满足），请**只重写验收标准**（步骤描述与顺序保持不变）。'
      : '你先前给出的验收标准中，下列条目**无法用工具输出证明**，请**只重写验收标准**（步骤描述与顺序保持不变）。';
  const requirement =
    mode === 'form-only'
      ? [
          '【硬性要求】每条验收标准除"形式条件"外，**必须至少包含一条内容判据**（具体值 / 必含字段 / 结构要点），仍须**一次工具输出**即可判定。',
          '✅ 正例：`grep 在 <文件> 中命中 <具体文本>`；`file_read 返回内容包含 "## 概述" 与 "## 验收"`。',
          '❌ 禁止：只写「grep 命中 ≥1 行」「输出非空」「文件存在」「退出码为 0」这类形式条件。',
        ]
      : [
          '【硬性要求】每条验收标准执行完后，用**一次**工具调用的输出即可直接判定真假。',
          '✅ 正例：`file_read 读取 <路径> 返回内容等于 <值>`；`glob 在 <目录> 下能列出 <文件名>`；',
          '`grep 在 <文件> 中命中 <文本>`。',
          '❌ 禁止：字节级/编码级（严格 N 字节、无 BOM、无多余换行/空格、校验和/哈希）；',
          '**以 shell（bash/powershell）作为判定动作**（shell 受安全策略门控，可能被硬拒）；',
          '指定"必须调用某具体工具"；需文件系统元数据（权限位/时间戳/磁盘空间）；"可写性（需显式写入测试）"；"执行前后对比"。',
          '若某点无法被证明，改写成**可观察的近似条件**（如"内容等于 X"），不要叠加不可证修饰。',
        ];
  const prompt = [
    intro,
    '',
    `任务描述: ${description}`,
    workspacePathConstraint(deps.isolation.workspace),
    '',
    `步骤（共 ${steps.length} 步，顺序不变）:`,
    stepList,
    '',
    '【不合格条目】',
    ...offending.map((s) => `- ${s}`),
    '',
    ...requirement,
    '',
    `只输出 JSON（不要其他内容），且必须恰好 ${steps.length} 条、与步骤一一对应：`,
    '{"acceptanceCriteria": ["第1步的验收标准", "第2步的验收标准"]}',
  ].join('\n');

  try {
    const raw = await deps.executor({
      systemPrompt: PLANNER_ROLE.systemPrompt,
      userPrompt: prompt,
      tools: roleToolNames(PLANNER_ROLE),
      taskType: PLANNER_ROLE.taskType,
      // 2026-11-09：同主规划预算（见 `resolvePlannerMaxOutputTokens` 注释）
      maxTokens: resolvePlannerMaxOutputTokens(),
      isolation: deps.isolation,
    });
    const text = normalizeExecutorResult(raw).content;
    const finishReason = typeof raw === 'string' ? undefined : raw.finishReason;
    // 2026-11-09：模型常把 JSON 包在 ```json 围栏或加前后缀 ⇒ 裸 `JSON.parse` 必然失败，
    // 纠正能力被白白丢掉（真机日志 `JSON Parse error: Unexpected EOF`）。复用 Planner 解析器
    // 的同一提取口径（`stripOuterFence` + `extractFirstJsonObject`），不做猜造式降级。
    const candidates = new Set<string>();
    const fenced = stripOuterFence(text);
    if (fenced) candidates.add(fenced);
    const objectText = extractFirstJsonObject(fenced);
    if (objectText) candidates.add(objectText);

    let parsed: { acceptanceCriteria?: unknown } | undefined;
    let parseReason = '';
    for (const candidate of candidates) {
      try {
        parsed = JSON.parse(candidate) as { acceptanceCriteria?: unknown };
        break;
      } catch (e) {
        parseReason = e instanceof Error ? e.message : String(e);
      }
    }
    const next = Array.isArray(parsed?.acceptanceCriteria)
      ? parsed.acceptanceCriteria.map((s) => String(s))
      : undefined;
    if (!next || next.length !== steps.length) {
      // 解析失败是**设计内降级**（保留原验收标准），不是错误 ⇒ 走 warn，
      // 不再经 `handleError` 记入 ErrorTracker；并把截断线索带出，便于区分格式错与预算耗尽。
      const truncated =
        /^(max_tokens|length)$/i.test(finishReason ?? '') ||
        /Unterminated|Unexpected end|Unexpected EOF/i.test(parseReason);
      logger.warn(
        '[orchestrator] 验收标准纠正结果不可用（条数不齐/解析失败）',
        {
          taskId: deps.taskId,
          expected: steps.length,
          got: next?.length ?? -1,
          finishReason,
          outputLength: text.length,
          ...(next ? {} : { parseReason: parseReason || 'no-json-object' }),
          ...(truncated ? { truncated: true } : {}),
        }
      );
      return undefined;
    }
    return next;
  } catch (e) {
    await handleError(e, {
      module: 'tasks:longRunning',
      action: 'repairAcceptanceCriteria',
    });
    return undefined;
  }
}
