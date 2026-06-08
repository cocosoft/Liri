// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 命令类型定义
 */

/**
 * 命令类型
 */
export type CommandType =
  | 'prompt'
  | 'action'
  | 'tool'
  | 'chat'
  | 'local'
  | 'local-jsx';

/**
 * 命令接口
 */
export interface Command {
  /**
   * 命令类型
   */
  type: CommandType;

  /**
   * 命令名称
   */
  name: string;

  /**
   * 命令描述
   */
  description: string;

  /**
   * 是否有用户指定的描述
   */
  hasUserSpecifiedDescription?: boolean;

  /**
   * 命令别名
   */
  aliases?: string[];

  /**
   * 参数提示
   */
  argumentHint?: string;

  /**
   * 使用场景
   */
  whenToUse?: string;

  /**
   * 版本
   */
  version?: string;

  /**
   * 是否禁用模型调用
   */
  disableModelInvocation?: boolean;

  /**
   * 是否可由用户调用
   */
  userInvocable?: boolean;

  /**
   * 加载来源
   */
  loadedFrom?: string;

  /**
   * 是否隐藏
   */
  isHidden?: boolean;

  /**
   * 加载命令实现
   */
  load?: () => Promise<CommandImplementation>;

  /**
   * 获取命令提示 (内联实现)
   */
  getPromptForCommand?: (
    args: string,
    context?: Record<string, unknown>
  ) => string | Promise<Array<{ type: string; text: string }>>;
}

/**
 * 命令实现接口
 */
export interface CommandImplementation {
  /**
   * 获取命令提示
   */
  getPromptForCommand?: (
    args: string,
    context?: Record<string, unknown>
  ) => string | Promise<Array<{ type: string; text: string }>>;

  /**
   * 执行命令
   */
  execute?: (args: string, context: CommandContext) => Promise<CommandResult>;

  /**
   * 调用命令 (别名)
   */
  call?: (args: string, context: CommandContext) => Promise<unknown>;

  /**
   * 验证命令参数
   */
  validate?: (args: string) => ValidationResult;
}

/**
 * 命令上下文
 */
export interface CommandContext {
  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 用户ID
   */
  userId?: string;

  /**
   * 项目ID
   */
  projectId?: string;

  /**
   * 当前工作目录
   */
  cwd?: string;

  /**
   * 环境变量
   */
  environment?: Record<string, string>;

  /**
   * 聊天管理器
   */
  chatManager?: unknown;

  /**
   * 插件管理器
   */
  pluginManager?: unknown;

  /**
   * 工具管理器
   */
  toolManager?: unknown;

  /**
   * AI 服务（用于需要 AI 交互的命令）
   */
  aiService?: unknown;

  /**
   * 模型管理器（用于模型相关命令）
   */
  modelManager?: unknown;

  /**
   * 成本管理器（用于成本相关命令）
   */
  costManager?: unknown;

  /**
   * 权限管理器（用于权限相关命令）
   */
  permissionManager?: unknown;

  /**
   * 完成回调
   */
  onDone?: (message: string, options?: Record<string, unknown>) => void;

  /**
   * 消息列表（供命令访问当前会话消息）
   */
  messages?: unknown[];

  /**
   * 命令选项（用于解析后的选项）
   */
  options?: Record<string, unknown>;

  /**
   * REPL 的 readline 接口（交互式命令用于暂停/恢复输入）
   */
  replReadline?: import('readline').Interface;

  /**
   * 停止加载动画的回调（交互式命令在接管输出前调用）
   */
  stopLoading?: () => void;
}

/**
 * 命令结果
 */
export interface CommandResult {
  /**
   * 结果类型
   */
  type?: 'text' | 'skip' | 'system' | 'error' | string;

  /**
   * 结果值
   */
  value?: string;

  /**
   * 是否成功
   */
  success?: boolean;

  /**
   * 消息
   */
  message?: string;

  /**
   * 数据
   */
  data?: unknown;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 显示选项
   */
  display?: string;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /**
   * 是否有效
   */
  valid: boolean;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 建议
   */
  suggestions?: string[];
}

/**
 * 命令加载器接口
 */
export interface CommandLoader {
  /**
   * 加载命令
   */
  loadCommands(): Promise<Command[]>;

  /**
   * 获取来源
   */
  getSource(): string;
}

/**
 * 命令加载结果
 */
export interface LoadResult {
  /**
   * 成功加载的命令
   */
  commands: Command[];
  /**
   * 加载错误
   */
  errors: { name: string; error: string }[];
}

/**
 * 命令加载状态
 */
export interface CommandLoadStatus {
  /**
   * 已加载的命令名称
   */
  loaded: string[];
  /**
   * 加载失败的命令名称
   */
  failed: { name: string; error: string }[];
}

/**
 * Local命令结果类型（来自CC源码）
 */
export type LocalCommandResult =
  | { type: 'text'; value: string }
  | { type: 'compact'; compactionResult: unknown; displayText?: string }
  | { type: 'skip' };

/**
 * 命令选项定义
 */
export interface CommandOption {
  /**
   * 选项名称
   */
  name: string;
  /**
   * 短名称（单字母）
   */
  shortName?: string;
  /**
   * 选项标志（如 --name, -n）
   */
  flags?: string;
  /**
   * 选项描述
   */
  description: string;
  /**
   * 是否必需
   */
  required?: boolean;
  /**
   * 默认值
   */
  defaultValue?: string | boolean | number;
  /**
   * 选项类型
   */
  type?: 'string' | 'boolean' | 'number';
}

/**
 * 解析后的命令
 */
export interface ParsedCommand {
  /**
   * 命令名称
   */
  name: string;
  /**
   * 位置参数
   */
  args: string[];
  /**
   * 选项
   */
  options: Record<string, string | boolean | number>;
  /**
   * 原始输入
   */
  raw: string;
  /**
   * 子命令名称
   */
  subcommand?: string;
}

// 扩展Command接口（添加CC源码中的关键字段）
declare module './index' {
  interface Command {
    isEnabled?: () => boolean; // 条件启用
    availability?: string[]; // 可用性要求
    source?: string; // 来源
    supportsNonInteractive?: boolean; // 非交互支持
    allowedTools?: string[]; // 允许的工具
    progressMessage?: string; // 进度消息
    contentLength?: number; // 内容长度
    kind?: string; // 种类（如'workflow'）
    pluginInfo?: {
      // 插件信息
      pluginManifest: unknown;
      repository: string;
    };
  }
}
