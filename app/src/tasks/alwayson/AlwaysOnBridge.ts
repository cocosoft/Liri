/**
 * AlwaysOn 桥接器（U-02，2026-10-20 最小可用自主执行 v1 → v2）。
 *
 * 把「发一条内部消息 / 建一条专用会话 / 写报告 / 准备隔离区」这些**宿主能力**以函数形式注入
 * （由 entry 构造，遵守 R00-001：`tasks` 不直接依赖 `chat` / 文件系统入口），
 * 产出 `AlwaysOnRuntime` 需要的 4 阶段实现。
 *
 * v2（方案 §10.7 裁定，2026-10-20）：
 * - **执行前隔离**：git-worktree；脏仓/非 git ⇒ **跳过本轮并如实报告**（不直连项目目录）；
 * - **只留补丁**：隔离区改动导出 `.patch`，**不自动 apply**，由用户决定；
 * - **会话 cwd 按轮绑定**：执行前把 `metadata.workspacePath` 指向隔离区（复用同一会话）。
 *
 * 目标达成自评（2026-10-20 产品裁定启用）：执行收尾后由宿主注入的 `evaluateGoal`
 * 做一次**文本证据自评**（不看仓库 —— 本轮改动只在隔离区且未 apply），结果进报告；
 * 未注入 / 预算不足 / 解析失败 ⇒ `unverified`（不臆造达成）。
 *
 * 仍不做：并行；discovery 高风险或解析失败 ⇒ `null`（本次不执行）。
 */
import { cg3Log } from '../cg3Env';
import type { DiscoveryPlan, ExecutionResult } from './types';
import { parseAlwaysOnPlan } from './planParser';
import {
  formatGoalAchievementLine,
  unverifiedGoal,
  type AlwaysOnGoalEvaluation,
} from './goalEvaluator';

/** 用量汇总（只取桥接器关心的字段） */
export interface AlwaysOnUsage {
  totalTokens?: number;
  estimatedCostUsd?: number;
}

/** 发消息时的回调（由宿主转成 `SendMessageOptions.onToolCall/onUsage`） */
export interface AlwaysOnPromptHooks {
  onToolCall?: (phase: 'start' | 'end', toolName: string) => void;
  onUsage?: (usage: AlwaysOnUsage) => void;
}

/**
 * 隔离工作区句柄。
 *
 * 任务层**只透传、不解读** `ref`（worktree 路径/分支等宿主私有语义），
 * 以保证 `tasks` 不反向依赖 `workspaces` 实现细节。
 */
export interface AlwaysOnWorkspaceRef {
  /** 隔离区工作目录（本轮工具 cwd） */
  cwd: string;
  /** 策略标识（宿主给出，如 `git-worktree`） */
  strategy: string;
  /** 宿主私有句柄（至少含 `runId`），任务层原样回传 */
  ref: Record<string, unknown>;
}

/** `prepareWorkspace` 结果：`workspace` 与 `skippedReason` 必有其一 */
export interface AlwaysOnWorkspacePrepareResult {
  workspace?: AlwaysOnWorkspaceRef;
  /** 无法隔离的原因（如 `not_git_repo_or_dirty`）⇒ 本轮跳过，不做任何写操作 */
  skippedReason?: string;
}

/** `finishWorkspace` 结果 */
export interface AlwaysOnWorkspaceFinishResult {
  /** 改动导出为补丁后的落盘路径（无改动 / 导出失败 ⇒ undefined） */
  patchPath?: string;
  /** 补丁字符数（报告用；无改动 ⇒ 0） */
  diffBytes: number;
  /** 隔离区是否被保留（补丁导出失败/超长时为 true，避免成果丢失） */
  kept?: boolean;
  /** 收尾错误（不阻断报告） */
  error?: string;
}

/** 宿主注入依赖 */
export interface AlwaysOnBridgeDeps {
  projectId: string;
  projectName: string;
  projectPath: string;
  /** 预算上限（来自 `AlwaysOnConfig.execution`） */
  limits: { maxToolCalls: number; timeoutMinutes: number };
  /** 建一条专用会话（幂等由宿主保证） */
  createSession: (project: { id: string; name: string }) => Promise<string>;
  /** 读取该项目上次使用的会话（跨重启复用；无记录 ⇒ undefined） */
  loadSession: (projectId: string) => Promise<string | undefined>;
  /** 记住该项目使用的会话（供下次启动复用） */
  saveSession: (projectId: string, sessionId: string) => Promise<void>;
  /**
   * 准备**本轮**隔离工作区（v2 P2）。
   *
   * 宿主实现：git-worktree 且工作区干净 ⇒ 返回 `workspace`；否则返回 `skippedReason`
   * （**不臆造隔离**，也不退回直连项目目录 —— 方案 §10.7 裁定 B）。
   */
  prepareWorkspace: (input: {
    projectPath: string;
    runId: string;
  }) => Promise<AlwaysOnWorkspacePrepareResult>;
  /**
   * 收尾：把隔离区改动**导出为补丁**（不自动 apply），再清理隔离区。
   * 导出失败/超长 ⇒ 宿主应保留隔离区并在结果里 `kept: true`（避免成果丢失）。
   */
  finishWorkspace: (
    workspace: AlwaysOnWorkspaceRef
  ) => Promise<AlwaysOnWorkspaceFinishResult>;
  /**
   * 把会话的工具 cwd 指向指定目录（写 `metadata.workspacePath` 并持久化）。
   *
   * 工具执行侧读的就是该字段（`ToolExecutionService` → `getSessionWorkspacePath`）。
   */
  setSessionWorkspace: (sessionId: string, cwd: string) => Promise<void>;
  /**
   * 发一条内部消息并返回助手最终文本。
   *
   * @param options.taskType 工具面收窄（经编排器 `metadata.taskType` 生效）：
   *   discovery 用 `'alwayson_discovery'`（只读面），execution 用 `'coding'`（可写面）
   * @param options.abortSignal 超时中止（宿主应映射到 `streamMessage` 的 `signal`）
   */
  sendPrompt: (
    sessionId: string,
    prompt: string,
    hooks: AlwaysOnPromptHooks,
    options?: { taskType?: string; abortSignal?: AbortSignal }
  ) => Promise<string>;
  /** 写报告并返回落盘路径 */
  writeReport: (planId: string, markdown: string) => Promise<string>;
  /**
   * 目标达成自评（可选；宿主实现负责**调模型**与预算门控）。
   *
   * 未注入 ⇒ 报告保持 `unverified（未做模型自评）`；注入后抛错/超时 ⇒ 同样
   * `unverified`（不阻断本轮报告，也**不**把异常当成"未达成"）。
   */
  evaluateGoal?: (input: {
    sessionId: string;
    goalSummary: string;
    planJson: string;
    success: boolean;
    toolCalls: number;
    errors: readonly string[];
    output: string;
    diffBytes?: number;
  }) => Promise<AlwaysOnGoalEvaluation>;
  /** 报告投递（主动通知；队列未启用/被门禁丢弃 ⇒ false） */
  notifyReport: (input: {
    planId: string;
    title: string;
    body: string;
    success: boolean;
  }) => Promise<boolean>;
}

/** 4 阶段实现（注入 `AlwaysOnRuntime`） */
export interface AlwaysOnBridge {
  discovery: () => Promise<DiscoveryPlan | null>;
  workspace: (plan: DiscoveryPlan) => Promise<string>;
  execution: (workspacePath: string) => Promise<ExecutionResult>;
  report: (result: ExecutionResult) => Promise<string>;
}

/** discovery 阶段的只读探针 prompt */
export function buildDiscoveryPrompt(
  projectName: string,
  projectPath: string
): string {
  return [
    '你是 AlwaysOn 自主执行器的「发现阶段」。',
    `项目：${projectName}（${projectPath}）。`,
    '**只读分析**，不要修改任何文件；输出**仅一段 JSON**，不要额外说明：',
    '{"summary":"一句话结论","actions":[{"type":"inspect|test|fix","description":"要做的事"}],"riskLevel":"low|medium|high"}',
    '约束：actions 1-5 条；把握不足或需要破坏性操作时 riskLevel 填 high。',
  ].join('\n');
}

/** execution 阶段 prompt（携带计划与预算） */
export function buildExecutionPrompt(
  projectPath: string,
  plan: DiscoveryPlan,
  limits: { maxToolCalls: number; timeoutMinutes: number }
): string {
  return [
    `按以下计划在项目 ${projectPath} 内执行。`,
    `预算：最多 ${limits.maxToolCalls} 次工具调用、${limits.timeoutMinutes} 分钟。`,
    `计划：${JSON.stringify(plan)}`,
    '要求：只做计划中的事；不得执行 git push / 发布 / 删除用户数据；',
    '结束后用一句话给出结果摘要。',
  ].join('\n');
}

/** 报告里的工作区口径（由桥接器从 prepare/finish 结果汇总） */
export interface AlwaysOnReportWorkspace {
  strategy?: string;
  cwd?: string;
  /** 本轮被跳过（未隔离）时的原因 */
  skippedReason?: string;
  /** 改动导出的补丁路径（**未自动应用**） */
  patchPath?: string;
  diffBytes?: number;
  /** 隔离区被保留（补丁导出失败） */
  kept?: boolean;
}

/** 生成报告 Markdown（与 `DiscoveryFire.report()` 的结构保持同族） */
export function buildReportMarkdown(
  projectName: string,
  plan: DiscoveryPlan,
  result: ExecutionResult,
  usage: AlwaysOnUsage,
  workspace?: AlwaysOnReportWorkspace,
  goal?: AlwaysOnGoalEvaluation
): string {
  const lines = [
    `# AlwaysOn Execution Report · ${projectName}`,
    '',
    `- **Plan**: ${plan.summary}`,
    `- **Actions**: ${plan.actions.length}`,
    `- **Success**: ${result.success}`,
    `- **Tool Calls**: ${result.toolCalls}`,
    `- **Duration**: ${result.durationMs}ms`,
    `- **Tokens**: ${usage.totalTokens ?? 0}${
      usage.estimatedCostUsd !== undefined
        ? `（≈$${usage.estimatedCostUsd.toFixed(4)}）`
        : ''
    }`,
    // 达成判定与"流程成功"分离：未自评 / 证据不足一律 `unverified`，避免把"没报错"读成"已达成"。
    formatGoalAchievementLine(goal),
  ];
  if (workspace) {
    if (workspace.skippedReason) {
      lines.push(
        `- **Workspace**: 未隔离（${workspace.skippedReason}）⇒ 本轮未执行写操作`
      );
    } else {
      const isSnapshot = workspace.strategy === 'snapshot-copy';
      lines.push(
        `- **Workspace**: ${workspace.strategy ?? 'isolated'}（${workspace.cwd ?? ''}）`
      );
      lines.push(
        workspace.patchPath
          ? `- **${isSnapshot ? 'Diff' : 'Patch'}**: ${workspace.patchPath}（${
              workspace.diffBytes ?? 0
            } bytes，**未自动应用**）`
          : `- **${isSnapshot ? 'Diff' : 'Patch'}**: 无改动`
      );
      if (workspace.kept) {
        lines.push(
          `- **${isSnapshot ? 'Snapshot Kept' : 'Worktree Kept'}**: ${
            workspace.cwd ?? ''
          }（${
            isSnapshot
              ? 'snapshot 模式不自动回灌，请到该目录取改动'
              : '补丁未导出，已保留待人工处理'
          }）`
        );
      }
    }
  }
  if (result.errors.length > 0) {
    lines.push('', '## Errors');
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  if (result.output) lines.push('', '## Output', '', result.output);
  return lines.join('\n');
}

/**
 * 创建桥接器。`lastPlan` 由 discovery 写入、execution 读取 ——
 * 这是 `AlwaysOnRuntime.setExecutionFn(fn: (workspace) => …)` 签名所限（不传 plan），
 * 桥接器负责把两阶段粘起来；每项目一个桥接器实例，故不会串项目。
 */
export function createAlwaysOnBridge(deps: AlwaysOnBridgeDeps): AlwaysOnBridge {
  let sessionId: string | undefined;
  let lastPlan: DiscoveryPlan | null = null;
  let lastUsage: AlwaysOnUsage = {};
  /** 本轮隔离区（workspace 阶段写入，execution 收尾后清空） */
  let workspaceState: AlwaysOnWorkspaceRef | null = null;
  /** 本轮未隔离的原因（跳过执行，仅报告） */
  let workspaceSkipReason: string | undefined;
  /** 本轮收尾结果（补丁导出 / 清理） */
  let finishState: AlwaysOnWorkspaceFinishResult | undefined;
  /** 报告用的工作区快照（收尾后 `workspaceState` 已清空，故单独留存） */
  let reportWorkspace: AlwaysOnReportWorkspace | undefined;
  /** 本轮目标达成自评（未评估 ⇒ undefined，报告按 `unverified` 陈述） */
  let lastGoal: AlwaysOnGoalEvaluation | undefined;

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    // v1.1：跨重启复用（映射由宿主持久化；无记录 ⇒ 新建并记住）
    const saved = await deps.loadSession(deps.projectId);
    if (saved) {
      sessionId = saved;
      return saved;
    }
    sessionId = await deps.createSession({
      id: deps.projectId,
      name: deps.projectName,
    });
    await deps.saveSession(deps.projectId, sessionId);
    return sessionId;
  };

  const discovery = async (): Promise<DiscoveryPlan | null> => {
    const sid = await ensureSession();
    // v2 P1：discovery 的读基准必须指向目标项目 —— 上轮执行可能把会话 cwd
    // 留在已被清理的 worktree 上，这里每轮复位到项目根（只读面，无副作用）。
    await deps.setSessionWorkspace(sid, deps.projectPath);
    const text = await deps.sendPrompt(
      sid,
      buildDiscoveryPrompt(deps.projectName, deps.projectPath),
      {},
      // 只读面：专用任务类 `alwayson_discovery`（仅 file_read + search 两类；
      // 不含 shell/file 写/session/channel/network）—— 见 `tools/toolCategories.ts`
      { taskType: 'alwayson_discovery' }
    );
    const planId = `alwayson-${deps.projectId}-${Date.now()}`;
    const plan = parseAlwaysOnPlan(text, planId);
    if (!plan) {
      cg3Log('tasks:alwayson:bridge', 'info', 'discovery:no-plan', {
        projectId: deps.projectId,
      });
      return null;
    }
    lastPlan = plan;
    cg3Log('tasks:alwayson:bridge', 'info', 'discovery:plan-ready', {
      projectId: deps.projectId,
      actions: plan.actions.length,
      riskLevel: plan.riskLevel,
    });
    return plan;
  };

  const workspace = async (plan: DiscoveryPlan): Promise<string> => {
    lastPlan = plan;
    workspaceState = null;
    workspaceSkipReason = undefined;
    finishState = undefined;
    reportWorkspace = undefined;

    // v2（方案 §10.7 裁定 B）：先隔离、后执行；脏仓/非 git ⇒ 跳过本轮，不直连项目目录。
    const prepared = await deps.prepareWorkspace({
      projectPath: deps.projectPath,
      runId: plan.id,
    });
    if (!prepared.workspace) {
      workspaceSkipReason = prepared.skippedReason ?? 'workspace_unavailable';
      reportWorkspace = { skippedReason: workspaceSkipReason };
      cg3Log('tasks:alwayson:bridge', 'info', 'workspace:skipped', {
        projectId: deps.projectId,
        reason: workspaceSkipReason,
      });
      return '';
    }

    workspaceState = prepared.workspace;
    reportWorkspace = {
      strategy: prepared.workspace.strategy,
      cwd: prepared.workspace.cwd,
    };
    cg3Log('tasks:alwayson:bridge', 'info', 'workspace:ready', {
      projectId: deps.projectId,
      strategy: prepared.workspace.strategy,
      cwd: prepared.workspace.cwd,
    });
    return prepared.workspace.cwd;
  };

  const execution = async (workspacePath: string): Promise<ExecutionResult> => {
    const start = Date.now();
    const plan = lastPlan;
    if (!plan) {
      return {
        success: false,
        output: '',
        errors: ['missing-plan'],
        toolCalls: 0,
        durationMs: 0,
      };
    }

    const ws = workspaceState;
    if (!workspacePath || !ws) {
      // 未隔离 ⇒ **不做任何写操作**（方案 §10.7 裁定 B），如实登记后进报告
      const reason = workspaceSkipReason ?? 'workspace_unavailable';
      lastGoal = unverifiedGoal('skipped:workspace', `本轮未执行（${reason}）`);
      cg3Log('tasks:alwayson:bridge', 'info', 'execution:skipped', {
        projectId: deps.projectId,
        reason,
      });
      return {
        success: false,
        output: '',
        errors: [`workspace-skipped: ${reason}`],
        toolCalls: 0,
        durationMs: Date.now() - start,
      };
    }

    let toolCalls = 0;
    let success = true;
    let output = '';
    let turnSessionId: string | undefined;
    lastUsage = {};
    lastGoal = undefined;
    const errors: string[] = [];

    const hooks: AlwaysOnPromptHooks = {
      onToolCall: (phase) => {
        if (phase === 'start') toolCalls += 1;
      },
      onUsage: (usage) => {
        lastUsage = {
          totalTokens: (lastUsage.totalTokens ?? 0) + (usage.totalTokens ?? 0),
          estimatedCostUsd:
            (lastUsage.estimatedCostUsd ?? 0) + (usage.estimatedCostUsd ?? 0),
        };
      },
    };

    const timeoutMs = deps.limits.timeoutMinutes * 60_000;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const sid = await ensureSession();
      turnSessionId = sid;
      // v2 P1：本轮工具 cwd = 隔离区（工具执行侧读 `metadata.workspacePath`）。
      await deps.setSessionWorkspace(sid, ws.cwd);
      output = await deps.sendPrompt(
        sid,
        buildExecutionPrompt(ws.cwd, plan, deps.limits),
        hooks,
        // 可写面：`coding` 任务白名单含 file/shell/code/search/network/…
        { taskType: 'coding', abortSignal: controller.signal }
      );
    } catch (error) {
      success = false;
      errors.push(
        timedOut
          ? `timeout: ${deps.limits.timeoutMinutes}min`
          : error instanceof Error
            ? error.message
            : String(error)
      );
    } finally {
      clearTimeout(timer);
    }

    if (toolCalls > deps.limits.maxToolCalls) {
      success = false;
      errors.push(`maxToolCalls exceeded: ${toolCalls}`);
    }

    // 收尾：导出补丁 + 清理隔离区（无论成败都导出，避免成果丢失）
    try {
      finishState = await deps.finishWorkspace(ws);
      reportWorkspace = {
        strategy: ws.strategy,
        cwd: ws.cwd,
        patchPath: finishState.patchPath,
        diffBytes: finishState.diffBytes,
        kept: finishState.kept,
      };
      if (finishState.error) {
        success = false;
        errors.push(`workspace-finish: ${finishState.error}`);
      }
      cg3Log('tasks:alwayson:bridge', 'info', 'workspace:finished', {
        projectId: deps.projectId,
        patchPath: finishState.patchPath,
        diffBytes: finishState.diffBytes,
        kept: finishState.kept === true,
      });
    } catch (error) {
      success = false;
      errors.push(
        `workspace-finish: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      workspaceState = null;
    }

    // 自评前置：会话 cwd 复位到**项目根**（隔离区已清理，原路径已不存在）。
    if (turnSessionId) {
      try {
        await deps.setSessionWorkspace(turnSessionId, deps.projectPath);
      } catch (error) {
        cg3Log('tasks:alwayson:bridge', 'warn', 'workspace:reset-cwd-failed', {
          projectId: deps.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 目标达成自评（宿主未注入 ⇒ 不评估，报告按 `unverified` 陈述）。
    // 失败/超时**不**阻断报告，也**不**把异常当成"未达成"。
    if (turnSessionId && deps.evaluateGoal) {
      try {
        lastGoal = await deps.evaluateGoal({
          sessionId: turnSessionId,
          goalSummary: plan.summary,
          planJson: JSON.stringify(plan),
          success,
          toolCalls,
          errors,
          output,
          ...(finishState?.diffBytes !== undefined
            ? { diffBytes: finishState.diffBytes }
            : {}),
        });
      } catch (error) {
        lastGoal = unverifiedGoal(
          'error:evaluate-failed',
          error instanceof Error ? error.message : String(error)
        );
      }
      cg3Log('tasks:alwayson:bridge', 'info', 'goal:evaluated', {
        projectId: deps.projectId,
        verdict: lastGoal.verdict,
        source: lastGoal.source ?? '',
      });
    }

    const result: ExecutionResult = {
      success,
      output,
      errors,
      toolCalls,
      durationMs: Date.now() - start,
    };
    cg3Log('tasks:alwayson:bridge', 'info', 'execution:done', {
      projectId: deps.projectId,
      success,
      toolCalls,
      durationMs: result.durationMs,
    });
    return result;
  };

  const report = async (result: ExecutionResult): Promise<string> => {
    const plan = lastPlan;
    if (!plan) return '';
    const markdown = buildReportMarkdown(
      deps.projectName,
      plan,
      result,
      lastUsage,
      reportWorkspace,
      lastGoal
    );
    const path = await deps.writeReport(plan.id, markdown);
    cg3Log('tasks:alwayson:bridge', 'info', 'report:written', {
      projectId: deps.projectId,
      path,
    });
    // 主动通知（队列未启用 / 门禁 drop ⇒ false，不阻断本轮）
    try {
      await deps.notifyReport({
        planId: plan.id,
        title: `AlwaysOn · ${deps.projectName} 执行完成`,
        body: [
          `计划：${plan.summary}`,
          `结果：${result.success ? '成功' : '失败'}`,
          `目标达成：${lastGoal ? lastGoal.verdict : 'unverified（未自评）'}${
            lastGoal?.reason ? `（${lastGoal.reason}）` : ''
          }`,
          `工具调用：${result.toolCalls}`,
          `耗时：${result.durationMs}ms`,
          ...(reportWorkspace?.skippedReason
            ? [`已跳过：${reportWorkspace.skippedReason}`]
            : []),
          ...(finishState?.patchPath ? [`补丁：${finishState.patchPath}`] : []),
        ].join('\n'),
        success: result.success,
      });
    } catch (error) {
      cg3Log('tasks:alwayson:bridge', 'warn', 'report:notify-failed', {
        projectId: deps.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return markdown;
  };

  return { discovery, workspace, execution, report };
}
