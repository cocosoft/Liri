/**
 * 工具注册表
 * 负责工具的注册、获取、搜索等操作
 */
import { Tool, ToolInfo, ToolTag } from './types/Tool';
import { ToolResult, createToolResult } from './types/ToolResult';
import { guardShieldedToolCall } from './shieldGuard';
import { ToolUseContext } from './types/ToolUseContext';
import {
  isDeferredTool,
  getDeferredTools,
  getNonDeferredTools,
  calculateDeferredToolDescriptionChars,
} from './utils/toolSearch';
import { ToolDefinitionAdapter } from './utils/ToolDefinitionAdapter';
import { findMissingRequiredParams } from './utils/ToolUtils';
import type { ToolDefinition, ToolImplementation } from './types/ToolTypes';
import { isWireSafeToolName, toWireToolName } from './toolNameCodec';
import { getDefaultToolPolicyPipeline } from './policy/defaultPipeline';

import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
// C-3b：模型侧参数描述走 T2 字段级资源链（用户 → 项目 → 包内 → 母语回退 → 源码兜底）
import {
  resolveToolParam,
  resolveToolDescription,
} from '@modules/services/prompt/PromptVersionManager';
import { getSectionCacheLocale } from '@modules/constants';
import { resolveConfiguredLanguage } from '@modules/system/i18n/languageProfiles';
const logger = getLogger('tools:ToolRegistry');

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  /**
   * 出参结构。
   * - U-03（2026-10-19）：允许 `type: 'array'` —— `glob` 等工具的 `data` 本身就是数组，
   *   此前受 `type:'object'` 限制无法声明真实结构；
   * - U-03（2026-10-20）：允许**标量** `string | number | boolean` —— `file_convert` 的
   *   `data` 契约就是「一段 Markdown 文本」（`outputSchema = z.string()`），只能用标量表达。
   *
   * 不变量（由 `resolveToolOutputSchema` 运行时保证）：
   * - `type: 'object'` ⇒ 必有 `properties`；
   * - `type: 'array'` ⇒ `items` 可选；
   * - 标量 ⇒ 不带 `properties` / `items`。
   */
  output_schema: {
    type: 'object' | 'array' | 'string' | 'number' | 'boolean';
    properties?: Record<string, unknown>;
    items?: Record<string, unknown>;
    description?: string;
  };
  aliases?: string[];
  searchTips?: string[];
}

/**
 * 历史占位出参结构（未声明 `outputJsonSchema` 的工具沿用；U-03 2026-10-19 前所有工具都走这里）。
 * 每次返回新对象，避免调用方误改共享引用。
 */
function genericOutputSchema(): ToolSchema['output_schema'] {
  return {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Tool execution result content',
      },
    },
  };
}

/**
 * 取工具**声明的**模型可见出参结构。
 *
 * 合法形状：
 * - `type: 'object'` 且带 `properties`；
 * - `type: 'array'`（`items` 可选）—— 供 `glob` 这类「`data` 即数组」的工具声明（U-03 2026-10-19）；
 * - 标量 `string` / `number` / `boolean` —— 供 `file_convert` 这类「`data` 即文本」的工具声明（U-03 2026-10-20）。
 * 其余形状按"未声明"回退占位，**不阻断** schema 生成（与 `outputSchema` 的保守约定一致）。
 */
function resolveToolOutputSchema(
  tool: Tool,
  info: { outputJsonSchema?: Record<string, unknown> }
): ToolSchema['output_schema'] {
  // 优先取 `getInfo()` 快照（懒加载工具未解包也能读到），其次取实例字段
  const declared = info.outputJsonSchema ?? tool.outputJsonSchema;
  const isObjectSchema =
    declared?.type === 'object' &&
    typeof declared.properties === 'object' &&
    declared.properties !== null;
  const isArraySchema = declared?.type === 'array';
  const isScalarSchema =
    declared?.type === 'string' ||
    declared?.type === 'number' ||
    declared?.type === 'boolean';
  if (declared && (isObjectSchema || isArraySchema || isScalarSchema)) {
    return declared as ToolSchema['output_schema'];
  }
  return genericOutputSchema();
}

/**
 * 工具搜索选项
 */
export interface ToolSearchOptions {
  /**
   * 搜索关键词
   */
  query: string;
  /**
   * 是否按相关性排序
   */
  sortByRelevance?: boolean;
  /**
   * 搜索字段
   */
  searchFields?: (
    | 'name'
    | 'description'
    | 'aliases'
    | 'searchHint'
    | 'params'
  )[];
  /**
   * 最大结果数
   */
  limit?: number;
}

/**
 * 工具过滤选项
 */
export interface ToolFilterOptions {
  /**
   * 是否启用
   */
  enabled?: boolean;
  /**
   * 是否只读
   */
  readOnly?: boolean;
  /**
   * 是否破坏性
   */
  destructive?: boolean;
  /**
   * 是否并发安全
   */
  concurrencySafe?: boolean;
  /**
   * 是否延迟加载
   */
  deferred?: boolean;
  /**
   * 是否始终加载
   */
  alwaysLoad?: boolean;
  /**
   * 工具类型
   */
  type?: 'mcp' | 'lsp' | 'local';
}

/**
 * 工具使用统计
 */
export interface ToolUsageStats {
  /**
   * 使用次数
   */
  usageCount: number;
  /**
   * 成功次数
   */
  successCount: number;
  /**
   * 失败次数
   */
  failureCount: number;
  /**
   * 平均执行时间（毫秒）
   */
  averageExecutionTime: number;
  /**
   * 最后使用时间
   */
  lastUsed?: Date;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private aliases: Map<string, string> = new Map();
  private usageStats: Map<string, ToolUsageStats> = new Map();

  /**
   * 注册工具
   * @param tool 工具实例
   * @param options 可选：onConflict='error' 时与已注册工具撞名抛出异常（默认 overwrite 兼容现状）
   */
  registerTool(
    tool: Tool,
    options?: { onConflict?: 'error' | 'overwrite' }
  ): void {
    if (this.tools.has(tool.name) && options?.onConflict === 'error') {
      throw new AppError(
        `Tool already registered: ${tool.name}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TOOL_ALREADY_REGISTERED'
      );
    }

    this.tools.set(tool.name, tool);

    if (tool.aliases) {
      for (const alias of tool.aliases) {
        // 别名守卫（2026-09-29）：**真实工具名不得被当作他工具的别名**。
        // 依据（实测）：`TodoWriteTool` 曾把真实工具名 `create_task_list` 当别名 ⇒
        // `tool_search(select:create_task_list)` 指错工具（台账「另案 ③-①」）。
        // 处置口径与下方 wire 名冲突**一致**：**跳过 + warn**，不静默改名。
        if (this.tools.has(alias)) {
          logger.warn('工具别名守卫：别名与已注册工具的真实名冲突，跳过登记', {
            toolName: tool.name,
            alias,
            occupiedBy: this.tools.get(alias)?.name,
          });
          continue;
        }
        this.aliases.set(alias, tool.name);
      }
    }

    // 反向守卫（同批）：本工具的**真实名**若已被先前注册的工具当作别名占用 ⇒ 摘除该别名
    //（真实名优先，与 `getTool()` / `findToolByName()` 的口径一致）。
    if (this.aliases.has(tool.name)) {
      logger.warn('工具别名守卫：真实名被先前工具的别名占用，已摘除该别名', {
        toolName: tool.name,
        previousOwner: this.aliases.get(tool.name),
      });
      this.aliases.delete(tool.name);
    }

    // wire codec：非 wire 安全名（冒号命名空间，如 `calendar:add`）自动登记其 wire 安全名
    // （`calendar_add`）为别名 ⇒ 模型以安全名调用时可解析回真名（`getTool()` 已内置别名解析）。
    // 冲突（安全名已被别的工具名/别名占用）→ 跳过并 warn：该工具降级为"不可下发"，
    // **不做静默改名**（避免两个工具抢同一 wire 名导致误执行）。
    if (!isWireSafeToolName(tool.name)) {
      const wireName = toWireToolName(tool.name);
      if (this.tools.has(wireName) || this.aliases.has(wireName)) {
        logger.warn('工具名 codec：wire 安全名冲突，跳过别名登记', {
          toolName: tool.name,
          wireName,
          occupiedBy:
            this.tools.get(wireName)?.name ?? this.aliases.get(wireName),
        });
      } else {
        this.aliases.set(wireName, tool.name);
      }
    }

    // 初始化使用统计
    this.usageStats.set(tool.name, {
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      averageExecutionTime: 0,
    });
  }

  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * 注销工具（含别名与使用统计）
   * @param name 工具名
   */
  unregisterTool(name: string): void {
    const tool = this.tools.get(name);
    if (!tool) return;

    this.tools.delete(name);
    this.usageStats.delete(name);

    if (tool.aliases) {
      for (const alias of tool.aliases) {
        this.aliases.delete(alias);
      }
    }

    // wire codec：清理自动登记的 wire 安全别名（仅当仍指向本工具）
    if (!isWireSafeToolName(tool.name)) {
      const wireName = toWireToolName(tool.name);
      if (this.aliases.get(wireName) === tool.name) {
        this.aliases.delete(wireName);
      }
    }
  }

  /**
   * 注册 CC 风格的工具定义 + 实现函数
   * 自动通过 ToolDefinitionAdapter 包装为 Tool 接口实例
   */
  registerDefinition(
    definition: ToolDefinition,
    implementation: ToolImplementation
  ): void {
    const adapter = new ToolDefinitionAdapter(definition, implementation);
    this.registerTool(adapter);
  }

  getTool(name: string): Tool | undefined {
    if (this.tools.has(name)) {
      return this.tools.get(name);
    }

    const toolName = this.aliases.get(name);
    if (toolName && this.tools.has(toolName)) {
      return this.tools.get(toolName);
    }

    return undefined;
  }

  /**
   * 将外部传入的工具名归一为注册名（wire codec）。
   *
   * 模型侧只见到 wire 安全名（`calendar_add`），策略/权限/审计需按真名（`calendar:add`）
   * 判定，故在这些判定点先经本方法归一。未命中时原样返回（调用方按未知工具处理）。
   */
  resolveRegisteredName(name: string): string {
    return this.getTool(name)?.name ?? name;
  }

  getTools(): Map<string, Tool> {
    return this.tools;
  }

  getToolSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = [];
    // C-3b / T2（2026-10-18）：locale 与参数面同源 —— **显式配置优先**，其次 assembly 写入的缓存。
    // 根因：schema 生成早于 `assembleSystemPrompt()`，只读缓存会让 en-US 译文「晚一轮/不生效」。
    // 循环外解析一次：同一批 schema 不得因逐工具重算而出现前后不一致。
    const locale = resolveConfiguredLanguage() ?? getSectionCacheLocale();

    for (const tool of this.tools.values()) {
      const info = tool.getInfo();
      const schema: ToolSchema = {
        name: info.name,
        // 工具级描述按资源链取译文；`info.description` 是源码（或其自身 T2 链）兜底。
        description: resolveToolDescription(
          info.name,
          info.description,
          locale
        ),
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
        // U-03（2026-10-19）：工具声明了 `outputJsonSchema` 就下发给模型真实出参结构；
        // 未声明仍沿用历史占位 `{ content: string }`（零破坏）。
        output_schema: resolveToolOutputSchema(tool, info),
        // D1（2026-08-24）无损 JSON 校验会**整条拒绝**含 `undefined` 值的载荷，而本函数产物
        // 正是 `context/model-input` 事件的 `tools.schemas`（修复前该事件每轮被拒 ⇒
        // 「模型可见 ⇔ 已落盘」实际不成立，见 `.trae/specs/event-payload-undefined-rootfix.md`）。
        // ⇒ 可选字段一律**有值才写键**（`.trae/specs` 既有约定）。
        // 语义零变更：`undefined` 在 JSON 中与"键不存在"等价（JSON.stringify 本就丢弃）。
        ...(info.aliases !== undefined ? { aliases: info.aliases } : {}),
        searchTips: info.searchHint ? [info.searchHint] : [],
      };

      if (info.params) {
        // C-3b：参数描述按当前 locale 走资源链；无资源时回退源码描述（行为零变化）
        // locale 已在循环外按「显式配置优先」解析（与工具级描述同源）。
        for (const param of info.params) {
          const paramSchema: Record<string, unknown> = {
            type: param.type,
            description: resolveToolParam(
              info.name,
              param.name,
              param.description,
              locale
            ),
            // 无默认值的参数（如各工具的 `cwd`）此前会留下 `default: undefined` ——
            // 正是实测被 D1 校验拒绝的具体路径（`schemas[0]…cwd.default`）
            ...(param.default !== undefined ? { default: param.default } : {}),
            // U-03（2026-10-19）：透传参数约束 —— 原实现丢弃 `enum/minimum/maximum`，
            // 模型只能靠描述猜取值与边界（与 `ToolParam` 契约不一致）。
            ...(Array.isArray(param.enum) && param.enum.length > 0
              ? { enum: param.enum }
              : {}),
            ...(typeof param.minimum === 'number'
              ? { minimum: param.minimum }
              : {}),
            ...(typeof param.maximum === 'number'
              ? { maximum: param.maximum }
              : {}),
          };

          // 数组类型：透传 items 内部结构和长度约束
          if (param.type === 'array') {
            if (param.items) {
              const itemsSchema: Record<string, unknown> = {
                type: param.items.type,
              };
              if (param.items.description) {
                itemsSchema.description = resolveToolParam(
                  info.name,
                  `${param.name}.items`,
                  param.items.description,
                  locale
                );
              }
              if (
                param.items.properties &&
                Object.keys(param.items.properties).length > 0
              ) {
                const properties: Record<string, unknown> = {};
                const required: string[] = [];
                for (const [key, subParam] of Object.entries(
                  param.items.properties
                )) {
                  properties[key] = {
                    type: subParam.type,
                    description: resolveToolParam(
                      info.name,
                      `${param.name}.items.${key}`,
                      subParam.description,
                      locale
                    ),
                    // U-03：数组元素同样透传枚举/边界（此前一并丢弃）
                    ...(Array.isArray(subParam.enum) && subParam.enum.length > 0
                      ? { enum: subParam.enum }
                      : {}),
                    ...(typeof subParam.minimum === 'number'
                      ? { minimum: subParam.minimum }
                      : {}),
                    ...(typeof subParam.maximum === 'number'
                      ? { maximum: subParam.maximum }
                      : {}),
                  };
                  if (subParam.required) required.push(key);
                }
                itemsSchema.properties = properties;
                if (required.length > 0) itemsSchema.required = required;
              }
              paramSchema.items = itemsSchema;
            }
            if (typeof param.minLength === 'number') {
              paramSchema.minLength = param.minLength;
            }
            if (typeof param.maxLength === 'number') {
              paramSchema.maxLength = param.maxLength;
            }
          }

          schema.input_schema.properties[param.name] = paramSchema;

          if (param.required) {
            schema.input_schema.required?.push(param.name);
          }
        }
      }

      schemas.push(schema);
    }

    return schemas;
  }

  async executeTool(
    toolCall: { toolName: string; input: Record<string, unknown> },
    context: ToolUseContext,
    // 2026-08-24 进度链路打通：透传 onProgress 到 tool.execute（细粒度百分比进度）
    onProgress?: (progress: {
      toolUseID: string;
      data: Record<string, unknown>;
    }) => void
  ): Promise<ToolResult> {
    // A7 防泄题（2026-09-26）：**Agent 路径**的路径屏蔽收口（另一处是 `ToolManager.executeTool`，
    // 见 `shieldGuard.ts` 对"两条收口"的说明）。命中 ⇒ fail-closed 拒绝，**工具不被执行**。
    const shieldRejection = guardShieldedToolCall(
      toolCall.toolName,
      toolCall.input
    );
    if (shieldRejection) return shieldRejection;

    const tool = this.getTool(toolCall.toolName);
    if (!tool) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: Tool not found: ${toolCall.toolName}`,
          },
        ],
      });
    }

    // A2-a（2026-10-18）：策略收口 —— 主聊天路径不经过 `ToolManager.executeTool`，
    // 因此必须在 Registry（共同执行入口）评估。默认 `userRole: 'owner'` ⇒ 零行为变更；
    // 仅当调用方显式传入 `policyContext.userRole === 'guest'` 时才收紧为只读。
    const policyContext = context.policyContext ?? {
      sessionId: context.sessionId,
      userRole: 'owner' as const,
    };
    const policyResult = getDefaultToolPolicyPipeline().evaluate(
      tool,
      policyContext
    );
    if (!policyResult.allowed) {
      logger.warn('工具调用被策略拒绝', {
        toolName: toolCall.toolName,
        sessionId: policyContext.sessionId,
        userRole: policyContext.userRole,
        policyName: policyResult.policyName,
        reason: policyResult.reason,
      });
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: Tool ${toolCall.toolName} is not allowed by policy: ${policyResult.reason ?? 'unknown'}`,
          },
        ],
      });
    }

    const startTime = Date.now();
    let result: ToolResult;

    // 2026-10-22：必填参数前置校验（共同执行入口）。此前主聊天路径（ChatManager →
    // ToolExecutionService → 本 Registry）**与**长程任务编排器都直接 `tool.execute()`，
    // 缺参时由工具内部裸抛运行时错误（实测 `file_write`：`path.dirname(undefined)` →
    // `The "path" property must be of type string, got undefined`），模型拿不到"缺哪个参数"
    // 也无从自纠。此处 fail-closed，返回与 `ToolExecutor.validateInput` 同口径的提示。
    const missingParams = findMissingRequiredParams(
      tool.params,
      toolCall.input
    );
    if (missingParams.length > 0) {
      logger.warn('工具调用缺少必填参数，拒绝执行', {
        toolName: toolCall.toolName,
        sessionId: policyContext.sessionId,
        missingParams,
        receivedKeys: Object.keys(toolCall.input ?? {}),
      });
      return createToolResult(null, {
        success: false,
        error: `Missing required parameter: ${missingParams.join(', ')}`,
        newMessages: [
          {
            role: 'system',
            content:
              `Error: Missing required parameter: ${missingParams.join(', ')}. ` +
              `请按工具定义的参数名重新调用（本次收到的参数键: ${
                Object.keys(toolCall.input ?? {}).join(', ') || '（空）'
              }；本工具参数: ${tool.params.map((p) => p.name).join(', ')}）。`,
          },
        ],
      });
    }

    try {
      result = await tool.execute(
        toolCall.input,
        context,
        onProgress as Parameters<typeof tool.execute>[2]
      );
      this.updateUsageStats(tool.name, true, Date.now() - startTime);
      // 统一统计收口（与 ToolExecutor.recordToolExecution 对齐）——
      // 主执行路径 ChatManager → ToolExecutionService → ToolRegistry 此前绕过埋点层，
      // 仪表盘"工具调用 Top 10"读不到数据（第六份导出修复仅覆盖 ToolExecutor，非真实主路径）
      void this.reportToolExecutionToAnalytics(
        tool.name,
        startTime,
        true,
        context.sessionId
      );
    } catch (error) {
      this.updateUsageStats(tool.name, false, Date.now() - startTime);
      void this.reportToolExecutionToAnalytics(
        tool.name,
        startTime,
        false,
        context.sessionId
      );
      throw error;
    }

    return result;
  }

  /** 统一工具执行统计上报：AnalyticsService（内存，驱动 /v1/analytics/dashboard）+ query_logs（SQLite 持久化） */
  private async reportToolExecutionToAnalytics(
    toolName: string,
    startTime: number,
    success: boolean,
    sessionId?: string
  ): Promise<void> {
    const durationMs = Date.now() - startTime;
    try {
      const { analyticsService } =
        await import('@modules/analytics/AnalyticsService');
      analyticsService.logEvent('tool_execute', {
        tool_name: toolName,
        success,
        duration_ms: durationMs,
      });
    } catch (err) {
      // @ignore-catch — 统计上报失败不影响工具执行
    }
    if (!sessionId) return;
    try {
      const { getQueryLogStore } =
        await import('@modules/query/QueryLogStore.js');
      await getQueryLogStore()
        .log({
          sessionId,
          type: 'tool_call',
          toolName,
          promptTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs,
          success,
          error: success ? undefined : 'tool_execution_failed',
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          // @ignore-catch — query_logs 落库失败不影响工具执行
        });
    } catch (err) {
      // @ignore-catch — QueryLogStore 不可用时跳过持久化
    }
  }

  searchTools(options: string | ToolSearchOptions): Tool[] {
    const {
      query,
      sortByRelevance = true,
      searchFields = ['name', 'description', 'aliases', 'searchHint'],
      limit,
    } = typeof options === 'string' ? { query: options } : options;
    const queryLower = query.toLowerCase();
    const results: { tool: Tool; relevance: number }[] = [];

    for (const tool of this.tools.values()) {
      const info = tool.getInfo();
      let relevance = 0;

      if (
        searchFields.includes('name') &&
        info.name.toLowerCase().includes(queryLower)
      ) {
        relevance += 10;
        if (info.name.toLowerCase() === queryLower) relevance += 5;
      }

      if (
        searchFields.includes('description') &&
        info.description.toLowerCase().includes(queryLower)
      ) {
        relevance += 5;
      }

      if (searchFields.includes('aliases') && info.aliases) {
        for (const alias of info.aliases) {
          if (alias.toLowerCase().includes(queryLower)) {
            relevance += 8;
            if (alias.toLowerCase() === queryLower) relevance += 4;
            break;
          }
        }
      }

      if (
        searchFields.includes('searchHint') &&
        info.searchHint &&
        info.searchHint.toLowerCase().includes(queryLower)
      ) {
        relevance += 3;
      }

      if (searchFields.includes('params')) {
        for (const param of info.params) {
          if (
            param.name.toLowerCase().includes(queryLower) ||
            param.description.toLowerCase().includes(queryLower)
          ) {
            relevance += 2;
            break;
          }
        }
      }

      if (relevance > 0) {
        results.push({ tool, relevance });
      }
    }

    if (sortByRelevance) {
      results.sort((a, b) => b.relevance - a.relevance);
    }

    const tools = results.map((item) => item.tool);
    return limit ? tools.slice(0, limit) : tools;
  }

  filterTools(
    options: ((tool: Tool) => boolean) | ToolFilterOptions
  ): Map<string, Tool> {
    const filteredTools = new Map<string, Tool>();

    for (const [name, tool] of this.tools) {
      let include = true;

      if (typeof options === 'function') {
        include = options(tool);
      } else {
        const info = tool.getInfo();

        if (options.enabled !== undefined && info.enabled !== options.enabled) {
          include = false;
        }

        if (
          options.readOnly !== undefined &&
          info.readOnly !== options.readOnly
        ) {
          include = false;
        }

        if (
          options.destructive !== undefined &&
          info.destructive !== options.destructive
        ) {
          include = false;
        }

        if (
          options.concurrencySafe !== undefined &&
          info.concurrencySafe !== options.concurrencySafe
        ) {
          include = false;
        }

        if (
          options.deferred !== undefined &&
          info.deferred !== options.deferred
        ) {
          include = false;
        }

        if (
          options.alwaysLoad !== undefined &&
          info.alwaysLoad !== options.alwaysLoad
        ) {
          include = false;
        }

        if (options.type) {
          switch (options.type) {
            case 'mcp':
              if (!tool.isMcp) include = false;
              break;
            case 'lsp':
              if (!tool.isLsp) include = false;
              break;
            case 'local':
              if (tool.isMcp || tool.isLsp) include = false;
              break;
          }
        }
      }

      if (include) {
        filteredTools.set(name, tool);
      }
    }

    return filteredTools;
  }

  /**
   * 按标签过滤工具
   */
  filterByTag(tag: ToolTag): Tool[] {
    const results: Tool[] = [];

    for (const tool of this.tools.values()) {
      const info = tool.getInfo();
      if (info.tags?.includes(tag)) {
        results.push(tool);
      }
    }

    return results;
  }

  getToolUsageStats(toolName: string): ToolUsageStats | undefined {
    return this.usageStats.get(toolName);
  }

  getAllToolUsageStats(): Map<string, ToolUsageStats> {
    return this.usageStats;
  }

  updateUsageStats(
    toolName: string,
    success: boolean,
    executionTime: number
  ): void {
    const stats = this.usageStats.get(toolName);
    if (stats) {
      stats.usageCount++;
      if (success) {
        stats.successCount++;
      } else {
        stats.failureCount++;
      }
      // 更新平均执行时间
      stats.averageExecutionTime =
        (stats.averageExecutionTime * (stats.usageCount - 1) + executionTime) /
        stats.usageCount;
      stats.lastUsed = new Date();
    }
  }

  removeTool(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      if (tool.aliases) {
        for (const alias of tool.aliases) {
          this.aliases.delete(alias);
        }
      }

      this.tools.delete(name);
      this.usageStats.delete(name);
    }
  }

  clear(): void {
    this.tools.clear();
    this.aliases.clear();
    this.usageStats.clear();
  }

  size(): number {
    return this.tools.size;
  }

  hasTool(name: string): boolean {
    return this.tools.has(name) || this.aliases.has(name);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getToolAliases(): Map<string, string> {
    return this.aliases;
  }

  getToolByAlias(alias: string): Tool | undefined {
    const toolName = this.aliases.get(alias);
    return toolName ? this.tools.get(toolName) : undefined;
  }

  /**
   * 获取延迟工具列表
   * 参考CC源码 isDeferredTool 实现
   * @returns 延迟工具列表
   */
  getDeferredTools(): Tool[] {
    return getDeferredTools(Array.from(this.tools.values()));
  }

  /**
   * 获取非延迟工具列表
   * @returns 非延迟工具列表
   */
  getNonDeferredTools(): Tool[] {
    return getNonDeferredTools(Array.from(this.tools.values()));
  }

  /**
   * 检查工具是否为延迟工具
   * @param name 工具名称
   * @returns 是否为延迟工具
   */
  isDeferredTool(name: string): boolean {
    const tool = this.getTool(name);
    return tool ? isDeferredTool(tool) : false;
  }

  /**
   * 计算延迟工具描述字符数
   * 用于判断是否需要启用工具搜索
   * @returns 延迟工具描述总字符数
   */
  getDeferredToolDescriptionChars(): number {
    return calculateDeferredToolDescriptionChars(
      Array.from(this.tools.values())
    );
  }

  /**
   * 获取延迟工具数量
   * @returns 延迟工具数量
   */
  getDeferredToolCount(): number {
    return this.getDeferredTools().length;
  }

  /**
   * 获取非延迟工具数量
   * @returns 非延迟工具数量
   */
  getNonDeferredToolCount(): number {
    return this.getNonDeferredTools().length;
  }

  /**
   * 获取工具统计信息
   * @returns 工具统计信息
   */
  getToolStats(): {
    total: number;
    deferred: number;
    nonDeferred: number;
    aliases: number;
    mcp: number;
    lsp: number;
    local: number;
  } {
    const tools = Array.from(this.tools.values());
    return {
      total: tools.length,
      deferred: this.getDeferredToolCount(),
      nonDeferred: this.getNonDeferredToolCount(),
      aliases: this.aliases.size,
      mcp: tools.filter((t) => t.isMcp).length,
      lsp: tools.filter((t) => t.isLsp).length,
      local: tools.filter((t) => !t.isMcp && !t.isLsp).length,
    };
  }
}

/**
 * 全局工具注册表实例
 */
let globalToolRegistry: ToolRegistry | null = null;

/**
 * 获取全局工具注册表实例
 * @returns 工具注册表实例
 */
export function getToolRegistry(): ToolRegistry {
  if (!globalToolRegistry) {
    globalToolRegistry = new ToolRegistry();
  }
  return globalToolRegistry;
}

/**
 * 解析工具在**运行期注册表**中声明的入参名。
 *
 * 2026-09-29（spec `pathguard-registry-driven-args.md` T3）：把 `PathGuard` 的"哪个入参是路径"
 * 判定从**静态工具名清单**改为可由**注册表**驱动 ⇒ 覆盖外部 MCP 动态注册的工具
 * （`mcp__<server>__<tool>`；静态名单不可能枚举它们）。
 *
 * 调用方（`ReActToolLoop` / `TAORLoop`）把它作为 `PathGuardOptions.resolvePathArgKeys` 注入。
 *
 * @returns 该工具声明的**全部**入参名（是否"路径"由 `PathGuard` 侧的键集合收窄）；
 *          **工具未注册** ⇒ `null`（调用方据此回退既有静态名单，零回归）。
 */
export function resolveToolParamNames(toolName: string): string[] | null {
  const tool = getToolRegistry().getTool(toolName);
  if (!tool) return null;
  // 防御：注册表允许"最小工具桩"（清单/展示用，未实现完整 Tool 契约）。
  // 缺 `getInfo` 时按"未注册"处理 ⇒ 调用方回退静态名单，绝不让 PathGuard 抛错中断工具执行。
  // （与 `ToolExecutor.ts` 的 `tool.getInfo?.()?.params` 同口径。）
  const info = tool.getInfo?.();
  if (!info?.params) return null;
  return info.params.map((p) => p.name);
}

/**
 * 设置全局工具注册表实例
 * @param registry 工具注册表实例
 */
export function setToolRegistry(registry: ToolRegistry): void {
  globalToolRegistry = registry;
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
