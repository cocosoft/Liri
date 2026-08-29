/**
 * CodeRunnerTool — code_run 工具（CM-1）
 *
 * 模型通过 code_run 提交编排代码（TypeScript，零 import），在受限沙箱中执行。
 *
 * 执行流程：
 *   1. 参数校验（code 必填/体积上限）
 *   2. 静态校验（validateCodeRunnerCode）→ 降级分类：
 *        - forbidden-import/forbidden-global → security-rejected（不进迭代循环）
 *        - syntax-error → compiled-error（立即降级不重试）
 *   3. 轮次计数（RoundTracker，sessionId 维度，超限拒绝）
 *   4. 构建 RPC 桥接（callTool 工具级权限链路 + 显式白名单 + ask 拒绝）
 *   5. runCodeRunner（跨平台受限子进程）
 *   6. 结果分类映射（completed/failed/compiled-error/security-rejected/timeout）
 *
 * 依赖注入：readContext/writeEvent 由模块级 configureCodeRunner 注册
 * （避免 tools 层依赖 ChatManager 具体类）；executeTool 内部走
 * getToolRegistry() + PermissionManager.getInstance()。
 */

import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';
import { getLogger } from '@modules/monitoring';
import { getToolRegistry } from '../ToolRegistry';
import { PermissionManager } from '@modules/permission';

import { validateCodeRunnerCode } from './staticValidation';
import { runCodeRunnerSafely } from './LinuxSandboxRunner';
import { CodeRunnerBridge } from './RuntimeBridge';
import { roundTracker } from './roundTracker';
import type { CodeRunInput, CodeRunResult } from './types';

const logger = getLogger('tools:CodeRunner:tool');

/** code 参数体积上限（字节） */
const CODE_MAX_BYTES = 64 * 1024;
/** 默认超时（ms） */
const DEFAULT_TIMEOUT_MS = 60_000;

/** 首版 callTool 显式工具白名单（方案待确认②建议：只读工具） */
const DEFAULT_TOOL_WHITELIST: ReadonlySet<string> = new Set([
  'file_read',
  'grep',
  'glob',
]);

/** 会话上下文读取器注入点 */
export interface CodeRunnerRuntimeDeps {
  /** 读取会话上下文（EventLogStorage 查询，由 ChatManager 注入） */
  readContext?: (opts?: { limit?: number }) => Promise<unknown>;
  /** 写事件（ChatManagerInterface.appendStreamEvent 引用） */
  writeEvent?: (type: string, data: unknown) => Promise<unknown>;
  /** 从会话事件流读取已用轮次数（CM-1 持久化重建，首次调用时惰性执行） */
  loadUsedRounds?: () => Promise<number>;
  /** 工具白名单（默认只读工具） */
  toolWhitelist?: ReadonlySet<string>;
}

let runtimeDeps: CodeRunnerRuntimeDeps = {};

/**
 * 配置 CodeRunner 运行期依赖（由 ChatManager/启动接线时调用）
 */
export function configureCodeRunner(deps: CodeRunnerRuntimeDeps): void {
  runtimeDeps = { ...runtimeDeps, ...deps };
  logger.info('CodeRunner runtime deps configured', {
    hasReadContext: typeof runtimeDeps.readContext === 'function',
    hasWriteEvent: typeof runtimeDeps.writeEvent === 'function',
  });
}

export class CodeRunnerTool extends BaseTool<Record<string, unknown>> {
  name = 'code_run';
  description =
    'Execute TypeScript orchestration code in a restricted sandbox. ' +
    'The code must not contain any import/require statements; capabilities are provided ' +
    'via the global __liriRuntime API (callTool/readContext/writeOutput/emitEvent/done). ' +
    'Call __liriRuntime.done(result) when finished. Use for complex multi-step tasks.';
  params: ToolParam[] = [
    {
      name: 'code',
      type: 'string',
      description:
        'TypeScript orchestration code. Zero imports allowed. Use globalThis.__liriRuntime.',
      required: true,
    },
    {
      name: 'language',
      type: 'string',
      description: 'Language (default: ts)',
      required: false,
      enum: ['ts'],
      default: 'ts',
    },
    {
      name: 'round',
      type: 'number',
      description: 'Round marker (log only, no state)',
      required: false,
      minimum: 1,
      maximum: 10,
    },
  ];

  override searchHint = 'Execute restricted TypeScript orchestration code';
  override sandboxLevel = 'execution' as const;

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult> {
    const sessionId = context.sessionId ?? 'unknown';
    const { code, language, round } = input as unknown as CodeRunInput;

    // 1. 参数校验
    if (typeof code !== 'string' || code.trim().length === 0) {
      return {
        success: false,
        error: 'code is required and must be a non-empty string',
      };
    }
    if (Buffer.byteLength(code, 'utf8') > CODE_MAX_BYTES) {
      return {
        success: false,
        error: `code exceeds ${CODE_MAX_BYTES} bytes limit`,
      };
    }
    if (language && language !== 'ts') {
      return {
        success: false,
        error: 'only TypeScript (language=ts) is supported in this version',
      };
    }

    // 2. 静态校验 → 降级分类
    const validation = validateCodeRunnerCode(code);
    if (!validation.ok) {
      const hasForbidden = validation.issues.some(
        (i) => i.kind === 'forbidden-import' || i.kind === 'forbidden-global'
      );
      const messages = validation.issues.map((i) => i.message).join('; ');
      if (hasForbidden) {
        return {
          success: false,
          error: `[security-rejected] ${messages}`,
          data: {
            status: 'security-rejected' as const,
            issues: validation.issues,
          },
        };
      }
      return {
        success: false,
        error: `[compiled-error] ${messages}`,
        data: { status: 'compiled-error' as const, issues: validation.issues },
      };
    }

    // 3. 轮次计数（超限拒绝）；首次调用从事件流重建基线（CM-1 持久化）
    if (!roundTracker.has(sessionId) && runtimeDeps.loadUsedRounds) {
      try {
        const used = await runtimeDeps.loadUsedRounds();
        roundTracker.setBaseline(sessionId, used);
        logger.info('code_run round baseline rebuilt from events', {
          sessionId,
          used,
        });
      } catch (error) {
        logger.warn('code_run round baseline rebuild failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (roundTracker.isExceeded(sessionId)) {
      return {
        success: false,
        error: `code_run round limit exceeded (used ${roundTracker.current(sessionId)})`,
        data: {
          status: 'security-rejected' as const,
          reason: `round limit exceeded (used ${roundTracker.current(sessionId)})`,
        },
      };
    }
    const roundNumber = roundTracker.consume(sessionId);

    // 4. 构建桥接
    const bridge = new CodeRunnerBridge({
      sessionId,
      executeTool: async (name, args) =>
        executeWhitelistedTool(name, args, sessionId, context),
      readContext:
        runtimeDeps.readContext ??
        (async () => ({ unavailable: true, reason: 'readContext not wired' })),
      writeEvent:
        runtimeDeps.writeEvent ??
        (async () => {
          /* 未接线时忽略（CM-5 后接入） */
        }),
      toolWhitelist: runtimeDeps.toolWhitelist ?? DEFAULT_TOOL_WHITELIST,
    });

    // 5. 执行（安全选择器：Linux landlock → 跨平台降级）
    const result = await runCodeRunnerSafely({
      sessionId,
      code,
      bridge,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

    // 5.5 事件落盘（CM-5）：assistant/code_run（内部调用摘要不逐条落 tool_call；
    //    round 序号供轮次计数事件流重建）
    if (runtimeDeps.writeEvent) {
      try {
        await runtimeDeps.writeEvent('assistant/code_run', {
          code,
          round: roundNumber,
          status: result.status,
          output: result.output,
          error: result.error,
          structuredError: result.structuredError,
          toolCalls: result.toolCalls,
          logs: result.logs.slice(-20),
          durationMs: result.durationMs,
        });
      } catch (error) {
        logger.warn('code_run event write failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 6. 结果分类映射
    return mapRunResult(result, roundNumber);
  }
}

/** 白名单工具执行：工具存在 → 权限校验（ask 拒绝）→ 执行 */
async function executeWhitelistedTool(
  name: string,
  input: Record<string, unknown>,
  sessionId: string,
  context: ToolUseContext
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const registry = getToolRegistry();
  const tool = registry?.getTool(name);
  if (!tool) {
    return { ok: false, error: `tool '${name}' not found` };
  }

  // 工具级权限校验（context 透传 sessionId + source 标识）
  try {
    const pm = PermissionManager.getInstance();
    const permission = await pm.checkPermissionForTool(name, input, {
      sessionId,
      metadata: { source: 'code_mode' },
    });
    // ask 决策（submittedToInbox 或 isInboxApprovalEnabled 关闭未提交）一律视为拒绝
    if (!permission.allowed) {
      return {
        ok: false,
        error:
          permission.decision?.reason ??
          permission.reason ??
          'permission denied',
      };
    }
  } catch (error) {
    logger.warn('code_mode permission check failed (fail-closed)', {
      tool: name,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: 'permission check error, denied' };
  }

  try {
    const toolResult = await registry.executeTool(
      { toolName: name, input },
      context
    );
    const ok = toolResult.success !== false && !toolResult.error;
    return {
      ok,
      result: toolResult.data ?? toolResult.output ?? null,
      error: ok
        ? undefined
        : (toolResult.error ?? toolResult.output ?? 'tool failed'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/** CodeRunResult → ToolResult 映射 */
function mapRunResult(result: CodeRunResult, round: number): ToolResult {
  const status = result.status;
  if (status === 'completed') {
    return {
      success: true,
      data: {
        status,
        round,
        output: result.output ?? null,
        toolCalls: result.toolCalls,
        durationMs: result.durationMs,
      },
      output:
        result.output !== undefined
          ? `CodeRunner completed in ${result.durationMs}ms`
          : `CodeRunner completed in ${result.durationMs}ms (no output)`,
    };
  }
  // 失败类统一（error 前缀携带 status，供上层/模型识别）
  return {
    success: false,
    error: `[${status}] ${result.structuredError?.message ?? result.error ?? 'code runner failed'}`,
    data: {
      status,
      round,
      error: result.error,
      structuredError: result.structuredError,
      logs: result.logs.slice(-50),
      toolCalls: result.toolCalls,
      durationMs: result.durationMs,
    },
  };
}

export function createCodeRunnerTool(): CodeRunnerTool {
  return new CodeRunnerTool();
}
