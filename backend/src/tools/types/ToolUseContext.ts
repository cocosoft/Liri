/**
 * 工具使用上下文类型
 * 参考CC_CODE的ToolUseContext设计，适应backend现有架构
 */
import type { Tools } from './Tool';
import type { ToolPermissionContext } from './PermissionContext';
import type { Message } from '../../core/types';

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
  /**
   * 选项
   */
  options: {
    /** 命令列表 */
    commands: any[];
    /** 调试模式 */
    debug: boolean;
    /** 主循环模型 */
    mainLoopModel: string;
    /** 工具列表 */
    tools: Tools;
    /** 详细模式 */
    verbose: boolean;
    /** 思考配置 */
    thinkingConfig: any;
    /** MCP客户端列表 */
    mcpClients: any[];
    /** MCP资源 */
    mcpResources: Record<string, any[]>;
    /** 是否非交互式会话 */
    isNonInteractiveSession: boolean;
    /** 代理定义 */
    agentDefinitions: any;
    /** 最大预算（美元） */
    maxBudgetUsd?: number;
    /** 自定义系统提示 */
    customSystemPrompt?: string;
    /** 附加系统提示 */
    appendSystemPrompt?: string;
    /** 查询来源 */
    querySource?: string;
    /** 刷新工具的回调 */
    refreshTools?: () => Tools;
    /** 当前工作目录 */
    cwd?: string;
    /** 环境变量 */
    environment?: Record<string, string>;
  };

  /**
   * 中止控制器
   */
  abortController: AbortController;

  /**
   * 读取文件状态
   */
  readFileState: any;

  /**
   * 获取应用状态
   */
  getAppState(): any;

  /**
   * 设置应用状态
   */
  setAppState(f: (prev: any) => any): void;

  /**
   * 任务的应用状态设置
   */
  setAppStateForTasks?: (f: (prev: any) => any) => void;

  /**
   * 处理URL诱导
   */
  handleElicitation?: (
    serverName: string,
    params: any,
    signal: AbortSignal
  ) => Promise<any>;

  /**
   * 设置工具JSX
   */
  setToolJSX?: (
    args: {
      jsx: any | null;
      shouldHidePromptInput: boolean;
      shouldContinueAnimation?: true;
      showSpinner?: boolean;
      isLocalJSXCommand?: boolean;
      isImmediate?: boolean;
      clearLocalJSX?: boolean;
    } | null
  ) => void;

  /**
   * 添加通知
   */
  addNotification?: (notif: any) => void;

  /**
   * 追加系统消息
   */
  appendSystemMessage?: (msg: any) => void;

  /**
   * 发送OS通知
   */
  sendOSNotification?: (opts: {
    message: string;
    notificationType: string;
  }) => void;

  /**
   * 嵌套内存附件触发器
   */
  nestedMemoryAttachmentTriggers?: Set<string>;

  /**
   * 已加载的嵌套内存路径
   */
  loadedNestedMemoryPaths?: Set<string>;

  /**
   * 动态技能目录触发器
   */
  dynamicSkillDirTriggers?: Set<string>;

  /**
   * 发现的技能名称
   */
  discoveredSkillNames?: Set<string>;

  /**
   * 用户是否修改
   */
  userModified?: boolean;

  /**
   * 设置进行中的工具使用ID
   */
  setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => void;

  /**
   * 设置是否有可中断的工具在进行中
   */
  setHasInterruptibleToolInProgress?: (v: boolean) => void;

  /**
   * 设置响应长度
   */
  setResponseLength: (f: (prev: number) => number) => void;

  /**
   * 推送API指标条目
   */
  pushApiMetricsEntry?: (ttftMs: number) => void;

  /**
   * 设置流模式
   */
  setStreamMode?: (mode: string) => void;

  /**
   * 紧凑进度事件处理
   */
  onCompactProgress?: (event: CompactProgressEvent) => void;

  /**
   * 设置SDK状态
   */
  setSDKStatus?: (status: any) => void;

  /**
   * 打开消息选择器
   */
  openMessageSelector?: () => void;

  /**
   * 更新文件历史状态
   */
  updateFileHistoryState: (updater: (prev: any) => any) => void;

  /**
   * 更新归因状态
   */
  updateAttributionState: (updater: (prev: any) => any) => void;

  /**
   * 设置会话ID
   */
  setConversationId?: (id: string) => void;

  /**
   * 代理ID
   */
  agentId?: string;

  /**
   * 代理类型
   */
  agentType?: string;

  /**
   * 是否需要工具使用权限
   */
  requireCanUseTool?: boolean;

  /**
   * 消息列表
   */
  messages: Message[];

  /**
   * 文件读取限制
   */
  fileReadingLimits?: {
    maxTokens?: number;
    maxSizeBytes?: number;
  };

  /**
   * 全局限制
   */
  globLimits?: {
    maxResults?: number;
  };

  /**
   * 工具决策
   */
  toolDecisions?: Map<
    string,
    {
      source: string;
      decision: 'accept' | 'reject';
      timestamp: number;
    }
  >;

  /**
   * 查询跟踪
   */
  queryTracking?: {
    chainId: string;
    depth: number;
  };

  /**
   * 请求提示
   */
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null
  ) => (request: any) => Promise<any>;

  /**
   * 工具使用ID
   */
  toolUseId?: string;

  /**
   * 关键系统提醒
   */
  criticalSystemReminder_EXPERIMENTAL?: string;

  /**
   * 是否保留工具使用结果
   */
  preserveToolUseResults?: boolean;

  /**
   * 本地拒绝跟踪
   */
  localDenialTracking?: any;

  /**
   * 内容替换状态
   */
  contentReplacementState?: any;

  /**
   * 渲染的系统提示
   */
  renderedSystemPrompt?: any;

  /**
   * 工具权限上下文
   */
  toolPermissionContext?: ToolPermissionContext;
}

/**
 * 获取空工具使用上下文
 */
export function getEmptyToolUseContext(): Partial<ToolUseContext> {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: '',
      tools: [],
      verbose: false,
      thinkingConfig: {},
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: {},
    },
    abortController: new AbortController(),
    readFileState: {},
    getAppState: () => ({}),
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  };
}
