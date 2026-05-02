/**
 * 核心类型定义
 */

/**
 * 工具上下文
 */
export interface ToolContext {
  sessionId: string;
  userId?: string;
  permissions: PermissionContext;
  toolManager: ToolManager;
  config: AppConfig;
}

/**
 * 工具结果
 */
export interface ToolResult<T = any> {
  success: boolean;
  output?: T;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * 命令上下文
 */
export interface CommandContext {
  args: string[];
  flags: Record<string, any>;
  toolManager: ToolManager;
  sessionManager: SessionManager;
}

/**
 * 权限上下文
 */
export interface PermissionContext {
  mode: 'default' | 'bypass' | 'auto';
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>;
  alwaysAllowRules: ToolPermissionRulesBySource;
  alwaysDenyRules: ToolPermissionRulesBySource;
  alwaysAskRules: ToolPermissionRulesBySource;
}

/**
 * 附加工作目录
 */
export interface AdditionalWorkingDirectory {
  path: string;
  writable: boolean;
}

/**
 * 工具权限规则
 */
export interface ToolPermissionRulesBySource {
  [source: string]: string[];
}

/**
 * 工具管理器
 */
export interface ToolManager {
  getAllTools(): Tool[];
  getTool(name: string): Tool | undefined;
  registerTool(tool: Tool): void;
}

/**
 * 会话管理器
 */
export interface SessionManager {
  getSession(sessionId: string): Session | undefined;
  createSession(): Session;
  deleteSession(sessionId: string): void;
}

/**
 * 会话
 */
export interface Session {
  id: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 消息
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | any[];
  createdAt: Date;
}

/**
 * 工具
 */
export interface Tool {
  name: string;
  description: string;
  execute(input: any, context: ToolContext): Promise<ToolResult>;
  isEnabled(): boolean;
  isReadOnly(input: any): boolean;
}

/**
 * 应用配置
 */
export interface AppConfig {
  [key: string]: any;
}
