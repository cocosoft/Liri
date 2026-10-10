/**
 * CodeRunnerTool — code_run 工具（CM-1）
 *
 * 模型通过 code_run 提交编排代码（TypeScript，零 import），在受限沙箱中执行。
 *
 * 执行流程：
 *   1. 参数校验（code 必填/体积上限）
 *   2. 静态校验（validateCodeRunnerCode）→ 降级分类：
 *        - forbidden-import/forbidden-global/forbidden-call → security-rejected（不进迭代循环）
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
import { configManager } from '@modules/config';
import { feature } from '@modules/core';
import { verdictFromScanStatus, type DeepScanStatus } from '@modules/security';

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

/**
 * **Tier1**（默认启用）：本地只读文件检索 —— 沙箱的默认能力面。
 */
export const TIER1_TOOL_WHITELIST: ReadonlySet<string> = new Set([
  'file_read',
  'grep',
  'glob',
]);

/**
 * **Tier2**（**默认关**，需显式开启）：只读扩展集。
 *
 * 开启方式：`CODE_MODE_TOOL_TIER=2`（env 统一出入口 `configManager.env`，R05-012）。
 * 成员口径 = 任务计划 §12 T-2② 裁定（2026-10-05）：
 * 网络检索 / 工具与技能元数据 / 跨会话读取 / 本地媒介·项目只读。
 *
 * 注意：**Tier3（写 / 执行类）永不入白名单** —— 那些工具必须走主循环逐次审批。
 */
export const TIER2_TOOL_WHITELIST: ReadonlySet<string> = new Set([
  // 网络检索（**出网**：参数/上下文会发往外部服务）
  'web_fetch',
  'web_search',
  // 工具与技能元数据（纯元数据查询）
  'tool_search',
  'skills_list',
  'skill_view',
  // 跨会话读取（读会话/消息内容）
  'sessions',
  // 本地媒介 / 项目只读（与 Tier1 同性质）
  'media_info',
  'media_pdf_extract',
  'media_qr_decode',
  'read_project_file',
]);

/** 工具层级：1 = 仅 Tier1（默认）；2 = Tier1 ∪ Tier2 */
export type CodeModeToolTier = 1 | 2;

/** 清单内单条工具描述的截断上限（控制 token 成本） */
const MANIFEST_TOOL_DESC_MAX = 120;

/** 解析层级档位（纯函数，可单测）：缺省 / 非法 / <2 ⇒ **1**（收紧，不放开） */
export function parseCodeModeToolTier(
  raw: string | undefined
): CodeModeToolTier {
  return raw !== undefined && Number(raw) >= 2 ? 2 : 1;
}

/** 某档位对应的**生效白名单**（Tier2 恒为 Tier1 的超集） */
export function whitelistForTier(tier: CodeModeToolTier): ReadonlySet<string> {
  return tier >= 2
    ? new Set([...TIER1_TOOL_WHITELIST, ...TIER2_TOOL_WHITELIST])
    : TIER1_TOOL_WHITELIST;
}

/**
 * 当前**生效**的工具白名单：运行期注入优先（宿主/测试覆盖）→ 否则按
 * `CODE_MODE_TOOL_TIER` 档位解析（缺省 Tier1）。
 */
export function resolveCodeRunnerToolWhitelist(): ReadonlySet<string> {
  if (runtimeDeps.toolWhitelist) return runtimeDeps.toolWhitelist;
  return whitelistForTier(
    parseCodeModeToolTier(configManager.env('CODE_MODE_TOOL_TIER'))
  );
}

/**
 * 构建沙箱内**可调用工具的轻量清单**（"SDK 声明"，T-2 ①，2026-10-05）。
 *
 * 背景：沙箱只暴露 `__liriRuntime.callTool(name, args)` —— 模型此前**无从得知有哪些
 * 工具可调、参数形状如何**，只能靠猜测（与本仓「懒加载注册的工具模型侧不可见」同源）。
 * 本函数把清单由**工具注册表**按**生效白名单**生成，直接拼进 `code_run` 的描述
 * （即模型读取工具契约的位置）。
 *
 * **不编造**（CS06）：白名单项在注册表查不到 ⇒ 跳过；一条都取不到 ⇒ 返回空串（不写清单段）。
 */
export function buildCodeRunnerToolManifest(): string {
  const registry = getToolRegistry();
  if (!registry) return '';

  const entries: string[] = [];
  for (const name of resolveCodeRunnerToolWhitelist()) {
    const tool = registry.getTool(name);
    if (!tool) continue;
    const params = (tool.params ?? [])
      .map((p) => `${p.name}${p.required ? '' : '?'}: ${p.type}`)
      .join(', ');
    const description = (tool.description ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MANIFEST_TOOL_DESC_MAX);
    entries.push(
      `- ${name}(${params})${description ? ` — ${description}` : ''}`
    );
  }
  if (entries.length === 0) return '';

  return (
    '\n\n沙箱内可通过 __liriRuntime.callTool(name, args) 调用的工具：\n' +
    entries.join('\n')
  );
}

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

  /** 基础契约（2026-10-07 起随 schema 口径改中文，与既有工具描述同风格）；工具清单段由 getter 动态拼接 */
  private static readonly BASE_DESCRIPTION =
    '在受限沙箱中执行 TypeScript 编排代码。' +
    '代码不得包含任何 import/require 语句；能力通过全局 ' +
    '__liriRuntime API（callTool/readContext/writeOutput/emitEvent/done）提供。' +
    '完成时调用 __liriRuntime.done(result)。用于复杂的多步骤任务。';

  /**
   * 工具描述 = 基础契约 + **沙箱内可调用工具清单**（T-2 ①，2026-10-05）。
   *
   * 必须用 **getter** 而非字段：模型每轮的工具定义取自
   * `ToolRegistry.getToolSchemas() → tool.getInfo()`（`ToolRegistry.ts:282`），getter 才能
   * 反映**运行期**注册表（含懒加载后新注册的工具）。
   */
  get description(): string {
    return CodeRunnerTool.BASE_DESCRIPTION + buildCodeRunnerToolManifest();
  }
  params: ToolParam[] = [
    {
      name: 'code',
      type: 'string',
      description:
        'TypeScript 编排代码。不允许任何 import。使用 globalThis.__liriRuntime。',
      required: true,
    },
    {
      name: 'language',
      type: 'string',
      description: '语言（默认：ts）',
      required: false,
      enum: ['ts'],
      default: 'ts',
    },
    {
      name: 'round',
      type: 'number',
      description: '轮次标记（仅用于日志，无状态）',
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
        (i) =>
          i.kind === 'forbidden-import' ||
          i.kind === 'forbidden-global' ||
          i.kind === 'forbidden-call'
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

    // 2.1 P0-3（`security-decision-verdict.md` §3.4）：**深扫未完成不得折叠为"扫描通过"**。
    // scanStatus='skipped'（原生缺失）/'failed'（解析失败或抛错）在默认姿态下为 INDETERMINATE，
    // 在 `CODE_RUN_DEEP_SCAN_STRICT` 开启时为 REQUIRE_REVIEW。
    const strictDeepScan = feature('CODE_RUN_DEEP_SCAN_STRICT');
    const scanVerdict = verdictFromScanStatus(
      validation.scanStatus,
      strictDeepScan
    );
    if (scanVerdict === 'REQUIRE_REVIEW') {
      // 本入口无交互审批链 ⇒ 按 fail-closed 拒绝（不执行），原因可读、状态可核
      logger.warn('code_run deep scan not completed ⇒ rejected (strict)', {
        sessionId,
        scanStatus: validation.scanStatus,
      });
      return {
        success: false,
        error: `[security-rejected] deep static scan not completed (scanStatus=${validation.scanStatus}); CODE_RUN_DEEP_SCAN_STRICT requires review`,
        data: {
          status: 'security-rejected' as const,
          scanStatus: validation.scanStatus,
        },
      };
    }
    if (scanVerdict === 'INDETERMINATE') {
      // 默认姿态：不收紧（零行为变更），但**如实留痕**（深扫未完成 ≠ 扫描通过）
      logger.warn('code_run deep scan not executed; proceeding (non-strict)', {
        sessionId,
        scanStatus: validation.scanStatus,
      });
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
      toolWhitelist: resolveCodeRunnerToolWhitelist(),
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
    return mapRunResult(result, roundNumber, validation.scanStatus);
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
function mapRunResult(
  result: CodeRunResult,
  round: number,
  scanStatus: DeepScanStatus
): ToolResult {
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
        // P0-3：深扫状态随结果带出（skipped/failed ≠ 扫描通过，供上层/模型识别）
        scanStatus,
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
      scanStatus,
    },
  };
}

export function createCodeRunnerTool(): CodeRunnerTool {
  return new CodeRunnerTool();
}
