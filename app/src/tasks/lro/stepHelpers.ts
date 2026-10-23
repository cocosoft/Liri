// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stepHelpers —— 步骤执行的纯函数助手（LRO 拆分批 U-22/S2b）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `isSecurityIntercepted` /
 * `MAX_SECURITY_STEERS_PER_STEP` / `buildSecuritySteeringMessage` /
 * `classifyArtifactAccess` / `buildTaorStepResult`。
 *
 * **为什么外移**：`executeSingleStep` 迁往 `./stepExecution` 后仍需这 5 个符号；
 * 若从宿主 import 会形成 `stepExecution → 宿主 → stepExecution` 循环依赖 ⇒ 先落到本模块。
 * 宿主对前 4 个公开符号**re-export**，既有导入路径（测试）零改动。
 *
 * **行为等价**：判定口径（只认显式布尔标记）/ 文案 / 分类规则 / 摘要格式逐字未变。
 */

import { getToolCategory } from '../../tools/index.js';
// PR-5：审批状态的**唯一事实源**（避免在 tasks 里裸写状态字面量，state-ratchet 门禁）
import { ToolExecutionStatus } from '@modules/utils/toolContract/ToolResult';

/**
 * 安全策略拦截的**显式标记**判定（2026-10-08）。
 *
 * 各工具的拦截分支（`security_analyzer_deny` / `security_analyzer_ask` /
 * `command_whitelist` / `ast_analysis` / `COMMAND_NOT_ALLOWED`）统一写
 * `metadata.securityIntercepted: true` ⇒ 本函数**只认这一布尔标记**，不做错误文案匹配
 * （CS02：状态判定禁止字符串匹配）。
 */
export function isSecurityIntercepted(result: unknown): boolean {
  const meta = (
    result as
      | { metadata?: { securityIntercepted?: boolean } }
      | null
      | undefined
  )?.metadata;
  return meta?.securityIntercepted === true;
}

/** 每步最多注入多少次"改道"steering（防 runaway；拦截本身已被安全层硬拒，不会执行） */
export const MAX_SECURITY_STEERS_PER_STEP = 2;

/**
 * 工具**结果级**失败判定（`execute()` 未抛错，但结果自述失败）。
 *
 * **背景（2026-10-22 真机日志）**：`file_write` 因参数缺失在 `execute()` 内被 catch 后
 * 以 `createToolResult(<错误文案>)` 返回 ⇒ 编排器仍记「工具执行成功」且 `success:1/failed:0`，
 * 与实际结果相反。工具契约里失败**两种写法**并存（见 `bash/powerShellWrapper.ts` 的
 * BUG-8 注释：`error` / `success:false` 必须带，否则消费方误记为成功）⇒ 此处两种都认。
 *
 * @returns 失败原因文本；结果自述成功时返回 undefined
 */
export function describeToolResultFailure(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as {
    success?: unknown;
    error?: unknown;
    errorOutput?: unknown;
  };
  const errorText =
    typeof r.error === 'string' && r.error.trim().length > 0
      ? r.error
      : typeof r.errorOutput === 'string' && r.errorOutput.trim().length > 0
        ? r.errorOutput
        : undefined;
  if (r.success === false) return errorText ?? '工具返回 success=false';
  return errorText;
}

/**
 * 构造"改道"steering 文案（被安全策略拦截后注入，令模型**下一轮**改用专用工具）。
 *
 * 约束（与 `TAORLoop.injectSteering` 的 `_steeringFilter` 对齐）：长度 < 2000，
 * 且不得包含 `system:` / `<|im_start|>`（否则被过滤器整条拒收）。前缀由骨架的
 * `steering` 片段渲染给出 ⇒ **此处不再手写 `[STEERING]`**（避免双轨）。
 */
export function buildSecuritySteeringMessage(
  blockedToolNames: readonly string[]
): string {
  const names = [...new Set(blockedToolNames)].join('、');
  return (
    `上一次工具调用被**安全策略拦截**（${names}）：本仓对 shell 管道（|）、重定向（> >>）、` +
    '命令连接（&& ; ）与 .NET 直调（如 [System.IO.File]::WriteAllText）**一律拒绝**。\n' +
    '请**立即改道**，不要重复同类命令形式：文件读写/编辑用 `file_write` / `file_read` / `file_edit`，' +
    '路径查找用 `glob`，内容检索用 `grep`。\n' +
    '若本步要求产出文件：直接用 `file_write` 写入，随后用 `file_read` 读回内容作为验收证据。'
  );
}

/**
 * PR-5（2026-10-23）：单次工具调用的**结构化结局**。
 *
 * 背景（方案 §3.10.6）：审查门此前只拿到拼接文本，无法区分"模型没做"与
 * "系统不让做"（失败 / 安全拦截 / 正在等审批）⇒ 把等审批当未达成，反复 retry/escalate。
 */
export interface ToolOutcome {
  toolName: string;
  toolCallId?: string;
  /** 是否成功（`success=false` / 带 error / 待审批 / 被拦截 均不算成功） */
  success: boolean;
  /** 失败原因（结果级失败或调用抛错） */
  error?: string;
  /** 被安全策略拦截（工具显式标记 `metadata.securityIntercepted`） */
  securityIntercepted: boolean;
  /** 工具要求人工审批（`requireApproval` / `status=requires_approval`），**未执行** */
  pendingApproval: boolean;
  /** 审批原因（工具自述） */
  approvalReason?: string;
}

/** 结构化结局汇总（投给 Reviewer/Verifier，并落 `PlanStep.toolOutcomes`） */
export interface ToolOutcomeSummary {
  outcomes: ToolOutcome[];
  total: number;
  successCount: number;
  failedCount: number;
  securityIntercepted: number;
  pendingApproval: number;
}

/** 判定单条工具结果是否"要求审批"（失败关闭：只认显式标记） */
function isPendingApproval(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as { requireApproval?: unknown; status?: unknown };
  return (
    r.requireApproval === true ||
    r.status === ToolExecutionStatus.REQUIRES_APPROVAL
  );
}

/**
 * 把编排器收集的工具结果汇总为结构化清单（纯函数）。
 *
 * 只认**显式标记**（CS02）：失败看 `describeToolResultFailure`、拦截看
 * `isSecurityIntercepted`、待审批看 `requireApproval` / `status`。
 */
export function summarizeToolOutcomes(
  results: ReadonlyArray<{
    toolName?: string;
    toolCallId?: string;
    result?: unknown;
    error?: unknown;
  }>
): ToolOutcomeSummary {
  const outcomes: ToolOutcome[] = results.map((r) => {
    const pendingApproval = isPendingApproval(r.result);
    const intercepted = isSecurityIntercepted(r.result);
    const resultFailure = describeToolResultFailure(r.result);
    const callError =
      typeof r.error === 'string' && r.error.trim() ? r.error : undefined;
    const error = callError ?? resultFailure;
    const approvalReason = (
      r.result as { approvalReason?: unknown } | null | undefined
    )?.approvalReason;
    return {
      toolName: r.toolName ?? '(unnamed-tool)',
      ...(r.toolCallId ? { toolCallId: r.toolCallId } : {}),
      success: !error && !pendingApproval && !intercepted,
      ...(error ? { error } : {}),
      securityIntercepted: intercepted,
      pendingApproval,
      ...(typeof approvalReason === 'string' && approvalReason
        ? { approvalReason }
        : {}),
    };
  });

  return {
    outcomes,
    total: outcomes.length,
    successCount: outcomes.filter((o) => o.success).length,
    failedCount: outcomes.filter((o) => !o.success && !o.pendingApproval)
      .length,
    securityIntercepted: outcomes.filter((o) => o.securityIntercepted).length,
    pendingApproval: outcomes.filter((o) => o.pendingApproval).length,
  };
}

/**
 * PR-5：**不参与截断**的关键证据行（失败 / 拦截 / 待审批）。
 *
 * 方案 §3.10.5 R3：证据窗口只取最后 12 条、每条 800 字 ⇒ 早期关键失败会被丢掉。
 * 这些行由编排器前置进 `step.result`，无论窗口如何都保留。
 */
export function buildCriticalOutcomeEvidence(
  summary: ToolOutcomeSummary
): string[] {
  const lines: string[] = [];
  for (const o of summary.outcomes) {
    if (o.success) continue;
    const flags = [
      o.pendingApproval ? 'PENDING_APPROVAL（未执行，等人工确认）' : '',
      o.securityIntercepted ? 'SECURITY_INTERCEPTED（被安全策略拦截）' : '',
      o.error ? `执行失败：${o.error.slice(0, 300)}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`[CRITICAL][${o.toolName}] ${flags}`);
  }
  return lines;
}

/**
 * PR-5：把结构化结局格式化为**给 LLM 审查员/验证器**的清单文本。
 *
 * 只写事实（成功数 / 失败项 / 拦截 / 待审批），不替审查员下结论。
 */
export function formatToolOutcomeSummary(summary: ToolOutcomeSummary): string {
  if (summary.total === 0) return '';
  const lines = [
    `[工具结果结构化清单] total=${summary.total} success=${summary.successCount} failed=${summary.failedCount} intercepted=${summary.securityIntercepted} pendingApproval=${summary.pendingApproval}`,
    '（pendingApproval = 该调用**未执行**，正在等人工确认；不得据此判定"模型未产出"）',
  ];
  for (const o of summary.outcomes) {
    if (o.success) continue;
    const kind = o.pendingApproval
      ? 'PENDING_APPROVAL'
      : o.securityIntercepted
        ? 'SECURITY_INTERCEPTED'
        : '执行失败';
    lines.push(
      `- [${o.toolName}] ${kind}${o.error ? `：${o.error.slice(0, 200)}` : ''}${o.approvalReason ? `（${o.approvalReason.slice(0, 160)}）` : ''}`
    );
  }
  return lines.join('\n');
}

/**
 * 步骤执行结果摘要 —— REVIEW 的唯一"实际输出"输入（`buildReviewPrompt` 取 `step.result`）。
 * **2026-10-08（真机实测暴露）**：原先 `markStepCompleted` 只写
 * `[TAORLoop] turns=… tokens=… elapsed=…ms` —— 只有**循环统计**、零执行证据 ⇒ Reviewer
 * 只能判"无任何证据"⇒ 每步 failed ⇒ `PDCA_GOAL_NOT_CONVERGED`
 * （实测：工具已真实执行、目标文件确实生成，任务仍报未收敛）。
 * 现把**助手文本 + 工具执行结果**一并写入。
 *
 * PR-5：`criticalEvidence`（失败/拦截/待审批）**前置且不参与窗口截断**。
 *
 * @param messages 本轮**最终**消息快照（TAORLoop 每轮传全量 `this.messages`）
 */
export function buildTaorStepResult(
  messages: ReadonlyArray<{
    role?: string;
    name?: string;
    content?: unknown;
  }>,
  stats: { turns: number; tokens: number; elapsedMs: number },
  criticalEvidence: readonly string[] = []
): string {
  const MAX_MSG_CHARS = 800;
  const LRO_MAX_MESSAGES = 12;
  const lines: string[] = [
    `[TAORLoop] turns=${stats.turns} tokens=${stats.tokens} elapsed=${stats.elapsedMs}ms`,
    ...criticalEvidence,
  ];
  for (const m of messages.slice(-LRO_MAX_MESSAGES)) {
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content === undefined || m.content === null
          ? ''
          : JSON.stringify(m.content);
    if (!text) continue;
    const role = m.name
      ? `${m.role ?? 'assistant'}:${m.name}`
      : (m.role ?? 'assistant');
    lines.push(`[${role}] ${text.slice(0, MAX_MSG_CHARS)}`);
  }
  return lines.join('\n');
}

/** 一步内某次工具调用对「产物」的读写意图（机械保障：写后读回用） */
export interface ArtifactAccess {
  kind: 'write' | 'read';
  path: string;
}

/**
 * 从工具调用推断其对产物的读写意图（纯函数，可单测）。
 *
 * 分类**不手写工具名**，直接复用 `TOOL_CATEGORIES` 的既有口径：
 * `'file'` = 写/改类（`file_write` / `file_edit` / `file_convert` / `write_project_file`），
 * `'file_read'` = 只读类（`file_read` / `glob` / `read_project_file`）。新增工具只要类别登记正确即自动纳入。
 *
 * 路径取 `file_path`（本仓写/读类工具的统一参数名），兼容常见别名 `path`。
 */
export function classifyArtifactAccess(
  toolName: string,
  args: Record<string, unknown> | undefined
): ArtifactAccess | undefined {
  const category = getToolCategory(toolName);
  const kind: ArtifactAccess['kind'] | undefined =
    category === 'file'
      ? 'write'
      : category === 'file_read'
        ? 'read'
        : undefined;
  if (!kind) return undefined;
  const raw =
    typeof args?.file_path === 'string'
      ? args.file_path
      : typeof args?.path === 'string'
        ? args.path
        : undefined;
  const path = raw?.trim();
  if (!path) return undefined;
  return { kind, path };
}
