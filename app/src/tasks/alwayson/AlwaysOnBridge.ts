/**
 * AlwaysOn 桥接器（U-02，2026-10-20 最小可用自主执行 v1）。
 *
 * 把「发一条内部消息 / 建一条专用会话 / 写报告」这些**宿主能力**以函数形式注入
 * （由 entry 构造，遵守 R00-001：`tasks` 不直接依赖 `chat` / 文件系统入口），
 * 产出 `AlwaysOnRuntime` 需要的 4 阶段实现。
 *
 * v1 边界（方案 §2/§6）：不做 worktree 隔离、不并行、不自评目标达成；
 * discovery 高风险或解析失败 ⇒ `null`（本次不执行）。
 */
import { cg3Log } from '../cg3Env';
import type { DiscoveryPlan, ExecutionResult } from './types';
import { parseAlwaysOnPlan } from './planParser';

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
   * 发一条内部消息并返回助手最终文本。
   *
   * @param options.taskType 工具面收窄（经编排器 `metadata.taskType` 生效）：
   *   discovery 用 `'messaging'`（只读面），execution 用 `'coding'`（可写面）
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

/** 生成报告 Markdown（与 `DiscoveryFire.report()` 的结构保持同族） */
export function buildReportMarkdown(
  projectName: string,
  plan: DiscoveryPlan,
  result: ExecutionResult,
  usage: AlwaysOnUsage
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
  ];
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
    const text = await deps.sendPrompt(
      sid,
      buildDiscoveryPrompt(deps.projectName, deps.projectPath),
      {},
      // 只读面：`messaging` 任务白名单不含写/执行类工具（file_read/search/network/…）
      { taskType: 'messaging' }
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
    // v1：不做 worktree 隔离（方案 §6），工作区 = 项目目录
    lastPlan = plan;
    return deps.projectPath;
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

    const sid = await ensureSession();
    let toolCalls = 0;
    lastUsage = {};
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
    let output = '';
    let success = true;
    try {
      output = await deps.sendPrompt(
        sid,
        buildExecutionPrompt(workspacePath, plan, deps.limits),
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
      lastUsage
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
          `工具调用：${result.toolCalls}`,
          `耗时：${result.durationMs}ms`,
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
