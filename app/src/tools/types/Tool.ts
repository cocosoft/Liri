/**
 * 工具接口定义
 * 参考CC_CODE的Tool接口设计，适应backend现有架构
 */
import type { ToolResult } from './ToolResult';
import type { PermissionResult } from './PermissionResult';
import type { ToolProgressData } from './ToolProgress';
import type { ToolPermissionContext } from './PermissionContext';
import type { Message } from '@modules/core';

export type { ToolResult };

/**
 * 验证结果类型
 */
export type ValidationResult =
  | { result: true }
  | {
      result: false;
      message: string;
      errorCode?: number;
    };

/**
 * 中断行为策略
 */
export type InterruptBehavior = 'cancel' | 'block';

/**
 * 工具标签枚举
 * 用于对工具进行分类，支持按标签过滤和管理
 */
export enum ToolTag {
  READ = 'read',
  WRITE = 'write',
  NETWORK = 'network',
  AGENT = 'agent',
  CODE = 'code',
  FILE = 'file',
  SYSTEM = 'system',
  AI = 'ai',
}

/**
 * 工具参数类型
 */
export interface ToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  example?: unknown;
  minimum?: number;
  maximum?: number;
  /** 数组元素 schema（当 type === 'array' 时使用） */
  items?: {
    type: string;
    description?: string;
    properties?: Record<string, ToolParam>;
    required?: string[];
  };
  /** 数组最小长度（当 type === 'array' 时使用） */
  minLength?: number;
  /** 数组最大长度（当 type === 'array' 时使用） */
  maxLength?: number;
}

/**
 * 工具信息类型
 */
export interface ToolInfo {
  name: string;
  description: string;
  params: ToolParam[];
  aliases?: string[];
  searchTips?: string[];
  searchHint?: string;
  enabled: boolean;
  readOnly: boolean;
  destructive: boolean;
  concurrencySafe: boolean;
  deferred: boolean;
  alwaysLoad: boolean;
  interruptBehavior: InterruptBehavior;
  maxResultSizeChars?: number;
  tags?: ToolTag[];
}

/**
 * 工具进度回调类型
 */
export type ToolCallProgress<P extends ToolProgressData = ToolProgressData> =
  (progress: { toolUseID: string; data: P }) => void;

/**
 * 紧凑进度事件类型
 */
export type CompactProgressEvent =
  | {
      type: 'hooks_start';
      hookType: 'pre_compact' | 'post_compact' | 'session_start';
    }
  | { type: 'compact_start' }
  | { type: 'compact_end' };

/**
 * 工具使用上下文类型
 */
export interface ToolUseContext {
  /** 选项 */
  options: {
    commands: unknown[];
    debug: boolean;
    mainLoopModel: string;
    tools: Tools;
    verbose: boolean;
    thinkingConfig: unknown;
    mcpClients: unknown[];
    mcpResources: Record<string, unknown[]>;
    isNonInteractiveSession: boolean;
    agentDefinitions: unknown;
    maxBudgetUsd?: number;
    customSystemPrompt?: string;
    appendSystemPrompt?: string;
    querySource?: string;
    refreshTools?: () => Tools;
    cwd?: string;
    environment?: Record<string, string>;
  };
  abortController: AbortController;
  /** 会话 ID，用于关联到具体的聊天会话 */
  sessionId?: string;
  readFileState: unknown;
  /** B3：子代理嵌套深度（agent 工具递归上限检查，默认 ≤1） */
  subagentDepth?: number;
  getAppState(): unknown;
  setAppState(f: (prev: unknown) => unknown): void;
  setAppStateForTasks?: (f: (prev: unknown) => unknown) => void;
  handleElicitation?: (
    serverName: string,
    params: unknown,
    signal: AbortSignal
  ) => Promise<unknown>;
  setToolJSX?: (
    args: {
      jsx: unknown | null;
      shouldHidePromptInput: boolean;
      shouldContinueAnimation?: true;
      showSpinner?: boolean;
      isLocalJSXCommand?: boolean;
      isImmediate?: boolean;
      clearLocalJSX?: boolean;
    } | null
  ) => void;
  addNotification?: (notif: unknown) => void;
  appendSystemMessage?: (msg: unknown) => void;
  sendOSNotification?: (opts: {
    message: string;
    notificationType: string;
  }) => void;
  nestedMemoryAttachmentTriggers?: Set<string>;
  loadedNestedMemoryPaths?: Set<string>;
  dynamicSkillDirTriggers?: Set<string>;
  discoveredSkillNames?: Set<string>;
  userModified?: boolean;
  setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => void;
  setHasInterruptibleToolInProgress?: (v: boolean) => void;
  setResponseLength: (f: (prev: number) => number) => void;
  setStreamMode?: (mode: string) => void;
  onCompactProgress?: (event: CompactProgressEvent) => void;
  setSDKStatus?: (status: unknown) => void;
  openMessageSelector?: () => void;
  updateFileHistoryState: (updater: (prev: unknown) => unknown) => void;
  updateAttributionState: (updater: (prev: unknown) => unknown) => void;
  setConversationId?: (id: string) => void;
  agentId?: string;
  agentType?: string;
  requireCanUseTool?: boolean;
  messages: Message[];
  fileReadingLimits?: { maxTokens?: number; maxSizeBytes?: number };
  globLimits?: { maxResults?: number };
  toolDecisions?: Map<
    string,
    { source: string; decision: 'accept' | 'reject'; timestamp: number }
  >;
  queryTracking?: { chainId: string; depth: number };
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null
  ) => (request: unknown) => Promise<unknown>;
  toolUseId?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  preserveToolUseResults?: boolean;
  localDenialTracking?: unknown;
  contentReplacementState?: unknown;
  renderedSystemPrompt?: unknown;
  toolPermissionContext?: ToolPermissionContext;
  traceId?: string;
}

/**
 * 工具接口
 */
export interface Tool<
  Input = unknown,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> {
  /**
   * 工具名称
   */
  name: string;

  /**
   * 工具描述
   */
  description: string;

  /**
   * 工具参数
   */
  params: ToolParam[];

  /**
   * 工具别名
   */
  aliases?: string[];

  /**
   * 搜索提示
   */
  searchHint?: string;

  /**
   * 搜索提示数组
   */
  searchTips?: string[];

  /**
   * 延迟加载标志
   */
  shouldDefer?: boolean;

  /**
   * 始终加载标志
   */
  alwaysLoad?: boolean;

  /**
   * 最大结果大小（字符数）
   */
  maxResultSizeChars?: number;

  /**
   * 工具标签列表
   */
  tags?: ToolTag[];

  /**
   * 严格模式标志
   */
  strict?: boolean;

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean;

  /**
   * 检查工具是否只读
   */
  isReadOnly(input?: Record<string, unknown>): boolean;

  /**
   * 检查工具是否破坏性操作
   */
  isDestructive?(input?: Record<string, unknown>): boolean;

  /**
   * 检查工具是否开放世界操作
   */
  isOpenWorld?(input?: Record<string, unknown>): boolean;

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(input?: Record<string, unknown>): boolean;

  /**
   * 中断行为策略
   */
  interruptBehavior?(): InterruptBehavior;

  /**
   * 获取工具操作的文件路径
   */
  getPath?(input: Record<string, unknown>): string;

  /**
   * 执行工具
   */
  execute(
    input: Input,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;

  /**
   * 调用工具（增强版）
   */
  call?(
    args: Input,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;

  /**
   * 检查权限
   */
  checkPermissions?(
    input: Input,
    context: ToolUseContext
  ): Promise<PermissionResult>;

  /**
   * 验证输入
   */
  validateInput?(input: Input): ValidationResult;

  /**
   * 带上下文的输入验证
   */
  validateInputWithContext?(
    input: Input,
    context: ToolUseContext
  ): Promise<ValidationResult>;

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo;

  /**
   * 获取工具描述（增强版）
   */
  getDescription?(
    input: Input,
    options: {
      isNonInteractiveSession: boolean;
      toolPermissionContext: unknown;
    }
  ): Promise<string>;

  /**
   * 输入Schema
   */
  inputSchema?: Input;

  /**
   * JSON格式的输入Schema（用于MCP工具）
   */
  inputJSONSchema?: unknown;

  /**
   * 出参运行期 schema（P1-3 A 档，2026-09-28）。
   *
   * **改前为 `unknown`** —— 字段早已存在，但该类型使**任何校验都不可能**（无法调用
   * `safeParse`）⇒ 等价于"只有占位、没有契约"。现收窄为结构化最小接口。
   *
   * 与泛型 `Output` **互补**：`Output` 只作用于**编译期**（对运行期数据无约束），本字段是
   * **运行期**校验 —— 在 `ToolExecutor` 的统一出口（`validateToolOutput`）调用其 `safeParse`。
   *
   * 设计约定（**保守**，避免"加校验反而打断工具"）：
   * - **可选**：未声明者**完全不受影响**（不校验、不报错）；
   * - **不阻断**：校验失败仅**记录 + 如实标注**（写入 `metadata.outputSchemaError`），**不抛错**；
   * - 结构刻意**不 import zod 类型**：零新增依赖，且兼容 zod 的 `safeParse` 形态
   *   （MCP 工具亦可自行适配）。
   */
  outputSchema?: {
    safeParse(data: unknown): { success: boolean; error?: unknown };
  };

  /**
   * 判断两个输入是否等价
   */
  inputsEquivalent?(a: Input, b: Input): boolean;

  /**
   * 是否为搜索或读取命令
   */
  isSearchOrReadCommand?(input: Input): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  };

  /**
   * 是否为开放世界操作
   */
  isOpenWorld?(input: Input): boolean;

  /**
   * 是否需要用户交互
   */
  requiresUserInteraction?(): boolean;

  /**
   * 是否为MCP工具
   */
  isMcp?: boolean;

  /**
   * 是否为LSP工具
   */
  isLsp?: boolean;

  /**
   * MCP信息
   */
  mcpInfo?: { serverName: string; toolName: string };

  /**
   * 填充可观察输入
   */
  backfillObservableInput?(input: Record<string, unknown>): void;

  /**
   * 准备权限匹配器
   */
  preparePermissionMatcher?(
    input: Input
  ): Promise<(pattern: string) => boolean>;

  /**
   * 获取面向用户的名称
   */
  userFacingName?(input?: Partial<Input>): string;

  /**
   * 获取面向用户的背景颜色
   */
  userFacingNameBackgroundColor?(input?: Partial<Input>): string | undefined;

  /**
   * 是否为透明包装器
   */
  isTransparentWrapper?(): boolean;

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary?(input?: Partial<Input>): string | null;

  /**
   * 获取活动描述
   */
  getActivityDescription?(input?: Partial<Input>): string | null;

  /**
   * 转换为自动分类器输入
   */
  toAutoClassifierInput?(input: Input): unknown;

  /**
   * 映射工具结果到工具结果块参数
   */
  mapToolResultToToolResultBlockParam?(
    content: Output,
    toolUseID: string
  ): { content: unknown; type: string };

  /**
   * 获取工具使用摘要文本
   */
  getToolUseSummaryText?(input: Input): string;

  /**
   * 提取搜索文本
   */
  extractSearchText?(out: Output): string;

  /**
   * 渲染工具使用消息
   */
  renderToolUseMessage?(input: Input, options: { verbose: boolean }): unknown;

  /**
   * 渲染工具执行结果消息
   */
  renderToolResultMessage?(
    output: Output,
    progressMessages: unknown[],
    options: { verbose: boolean }
  ): unknown;

  /**
   * 渲染工具使用错误消息
   */
  renderToolUseErrorMessage?(
    error: string,
    options: { verbose: boolean }
  ): unknown;

  /**
   * 渲染工具进度消息
   */
  renderToolUseProgressMessage?(data: unknown): unknown;
}

/**
 * 工具集合类型
 */
export type Tools = readonly Tool[];

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  arguments?: Record<string, unknown> | string;
  toolName?: string;
  function?: { name: string };
  [key: string]: unknown;
}

export type ToolContext = Record<string, unknown>;

/**
 * 工具定义类型
 */
export type ToolDef<
  Input = unknown,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = Omit<
  Tool<Input, Output, P>,
  | 'isEnabled'
  | 'isConcurrencySafe'
  | 'isReadOnly'
  | 'isDestructive'
  | 'checkPermissions'
  | 'toAutoClassifierInput'
  | 'userFacingName'
  | 'getInfo'
  | 'description'
  | 'inputSchema'
  | 'outputSchema'
  | 'execute'
  | 'params'
  | 'renderToolResultMessage'
> &
  Partial<
    Pick<
      Tool<Input, Output, P>,
      | 'isEnabled'
      | 'isConcurrencySafe'
      | 'isReadOnly'
      | 'isDestructive'
      | 'checkPermissions'
      | 'toAutoClassifierInput'
      | 'userFacingName'
      | 'description'
      | 'inputSchema'
      | 'outputSchema'
      | 'execute'
      | 'params'
    >
  > & {
    prompt?: string | (() => string);
    renderToolUseMessage?: () => unknown;
    renderToolResultMessage?: (output: Output, toolUseId: string) => unknown;
    renderToolUseRejectedMessage?: () => unknown;
    renderToolUseErrorMessage?: () => unknown;
  };

/**
 * 工具默认值
 */
export const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: (_input?: unknown) => false,
  isReadOnly: (_input?: unknown) => false,
  isDestructive: (_input?: unknown) => false,
  checkPermissions: async (
    input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<PermissionResult> => {
    return {
      behavior: 'allow',
      updatedInput: input,
    };
  },
  toAutoClassifierInput: (_input?: unknown) => '',
  userFacingName: function (this: Tool, _input?: unknown) {
    return this.name;
  },
};

/**
 * 构建工具
 * 从部分定义构建完整工具，填充默认值
 */
export function buildTool<
  Input = unknown,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
>(def: ToolDef<Input, Output, P>): Tool<Input, Output, P> {
  const tool = {
    ...TOOL_DEFAULTS,
    ...def,
    getInfo(): ToolInfo {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        aliases: this.aliases,
        searchTips: this.searchHint ? [this.searchHint] : undefined,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: this.isDestructive?.() || false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: this.shouldDefer || false,
        alwaysLoad: this.alwaysLoad || false,
        interruptBehavior: this.interruptBehavior?.() || 'block',
        maxResultSizeChars: this.maxResultSizeChars,
        tags: this.tags,
      };
    },
  } as Tool<Input, Output, P>;

  return tool;
}

/**
 * 检查工具是否匹配名称（主名称或别名）
 */
export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false);
}

/**
 * 通过名称查找工具
 *
 * **真实名优先于别名** —— 与 [`ToolRegistry.getTool()`](../ToolRegistry.ts)（先 `tools.has(name)`
 * 再 `aliases.get(name)`）**口径一致**。
 *
 * 依据（2026-09-29 实测）：别名可能与**他人真实名**冲突（`TodoWriteTool` 曾把真实工具名
 * `create_task_list` 当别名）⇒ 此时按数组顺序 `find` 会返回**别名持有者**而非真实工具，
 * 使 `tool_search(select:<真实名>)` 指错工具（实测被引向 `todo_write`）。
 */
export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return (
    tools.find((t) => t.name === name) ??
    tools.find((t) => toolMatchesName(t, name))
  );
}
