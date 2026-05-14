/**
 * 工具基类
 * 提供Tool接口的默认实现，子类继承并实现抽象方法
 */
import type {
  Tool,
  ToolInfo,
  ToolParam,
  ValidationResult,
  InterruptBehavior,
  ToolUseContext,
  ToolResult,
  PermissionResult,
  ToolCallProgress,
  ToolProgressData,
} from './types';
import { createAllowResult } from './types/PermissionResult';

export type { ToolDef } from './types/Tool';
export { buildTool } from './types/Tool';

/**
 * 工具基类
 * 实现Tool接口的默认方法，提供抽象方法供子类实现
 */
export abstract class BaseTool<
  Input = unknown,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> implements Tool<Input, Output, P> {
  /** 工具名称（子类必须实现） */
  abstract name: string;

  /** 工具描述（子类必须实现） */
  abstract description: string;

  /** 工具参数（子类必须实现） */
  abstract params: ToolParam[];

  /** 工具别名（可选） */
  aliases?: string[];

  /** 搜索提示（可选） */
  searchHint?: string;

  /** 延迟加载标志（可选） */
  shouldDefer?: boolean = false;

  /** 始终加载标志（可选） */
  alwaysLoad?: boolean = false;

  /** 最大结果大小（字符数）（可选） */
  maxResultSizeChars?: number;

  /** 严格模式标志（可选） */
  strict?: boolean = false;

  /** 工具版本号（用于灰度发布和版本管理，可选） */
  version?: string;

  /**
   * 检查工具是否启用
   * 默认返回true
   * @returns 是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 检查工具是否只读
   * 默认返回false（假设写操作）
   * @param input 工具输入（可选）
   * @returns 是否只读
   */
  isReadOnly(input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否破坏性操作（不可逆转）
   * 默认返回false
   * @param input 工具输入（可选）
   * @returns 是否破坏性
   */
  isDestructive?(input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否并发安全
   * 默认返回false（假设不安全）
   * @param input 工具输入（可选）
   * @returns 是否并发安全
   */
  isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 中断行为策略
   * 当用户在工具运行时提交新消息时应该发生什么
   * 默认返回'block'（继续运行，新消息等待）
   * @returns 中断行为策略
   */
  interruptBehavior?(): InterruptBehavior {
    return 'block';
  }

  /**
   * 获取工具操作的文件路径（可选）
   * 默认返回空字符串
   * @param input 工具输入
   * @returns 文件路径
   */
  getPath?(input: Record<string, unknown>): string {
    return '';
  }

  /**
   * 执行工具（子类必须实现）
   * @param input 工具输入
   * @param context 工具使用上下文
   * @param onProgress 进度回调（可选）
   * @returns 工具执行结果
   */
  abstract execute(
    input: Input,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;

  /**
   * 检查权限
   * 默认返回allow，交由通用权限系统处理
   * @param input 工具输入
   * @param context 工具使用上下文
   * @returns 权限结果
   */
  async checkPermissions?(
    input: unknown,
    context: ToolUseContext
  ): Promise<PermissionResult> {
    return createAllowResult(input);
  }

  /**
   * 验证输入
   * 默认返回true
   * @param input 工具输入
   * @returns 验证结果
   */
  validateInput?(input: unknown): ValidationResult {
    return { result: true };
  }

  /**
   * 带上下文的输入验证（可选）
   * 默认调用validateInput
   * @param input 工具输入
   * @param context 工具使用上下文
   * @returns 验证结果
   */
  async validateInputWithContext?(
    input: unknown,
    context: ToolUseContext
  ): Promise<ValidationResult> {
    if (this.validateInput) {
      return this.validateInput(input);
    }
    return { result: true };
  }

  /**
   * 获取工具信息
   * @returns 工具信息
   */
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
  }

  /**
   * 获取工具用于自动分类器的输入
   * 默认返回空字符串
   * @param input 工具输入
   * @returns 分类器输入
   */
  toAutoClassifierInput?(input: unknown): unknown {
    return '';
  }

  /**
   * 获取用户可见的工具名称
   * 默认返回工具名称
   * @param input 工具输入（可选）
   * @returns 用户可见名称
   */
  userFacingName?(input?: Partial<unknown>): string {
    return this.name;
  }

  /**
   * 获取活动描述
   * 默认返回null
   * @param input 工具输入（可选）
   * @returns 活动描述
   */
  getActivityDescription?(input?: Partial<unknown>): string | null {
    return null;
  }

  /**
   * 获取工具使用摘要
   * 默认返回null
   * @param input 工具输入（可选）
   * @returns 工具使用摘要
   */
  getToolUseSummary?(input?: Partial<unknown>): string | null {
    return null;
  }

  /**
   * 检查工具是否是搜索或读取命令
   * 默认返回false
   * @param input 工具输入
   * @returns 搜索或读取命令信息
   */
  isSearchOrReadCommand?(input: unknown): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: false, isRead: false };
  }

  /**
   * 检查工具是否是开放世界操作
   * 默认返回false
   * @param input 工具输入
   * @returns 是否开放世界操作
   */
  isOpenWorld?(input: unknown): boolean {
    return false;
  }

  /**
   * 检查工具是否需要用户交互
   * 默认返回false
   * @returns 是否需要用户交互
   */
  requiresUserInteraction?(): boolean {
    return false;
  }

  /**
   * 准备权限匹配器
   * 默认返回始终匹配的函数
   * @param input 工具输入
   * @returns 权限匹配器函数
   */
  async preparePermissionMatcher?(
    input: unknown
  ): Promise<(pattern: string) => boolean> {
    return () => true;
  }
}
