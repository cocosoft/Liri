/**
 * 工具接口定义
 * 参考CC_CODE的Tool接口设计，适应backend现有架构
 */
import type { ToolUseContext } from './ToolUseContext';
import type { ToolResult } from './ToolResult';
import type { PermissionResult } from './PermissionResult';
import type { ToolProgressData } from './ToolProgress';

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
 * 工具参数类型
 */
export interface ToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: any;
  enum?: string[];
  example?: any;
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
}

/**
 * 工具进度回调类型
 */
export type ToolCallProgress<P extends ToolProgressData = ToolProgressData> =
  (progress: { toolUseID: string; data: P }) => void;

/**
 * 工具接口
 */
export interface Tool<
  Input = any,
  Output = any,
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
      toolPermissionContext: any;
    }
  ): Promise<string>;

  /**
   * 输入Schema
   */
  inputSchema?: Input;

  /**
   * JSON格式的输入Schema（用于MCP工具）
   */
  inputJSONSchema?: any;

  /**
   * 输出Schema
   */
  outputSchema?: unknown;

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
}

/**
 * 工具集合类型
 */
export type Tools = readonly Tool[];

/**
 * 工具定义类型
 */
export type ToolDef<
  Input = any,
  Output = any,
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
    >
  >;

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
  Input = any,
  Output = any,
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
 */
export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return tools.find((t) => toolMatchesName(t, name));
}
