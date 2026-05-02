/**
 * 子agent接口定义
 */

/**
 * 子agent状态
 */
export enum SubAgentStatus {
  CREATED = 'created',
  INITIALIZED = 'initialized',
  RUNNING = 'running',
  PAUSED = 'paused',
  ERROR = 'error',
  TERMINATED = 'terminated',
}

/**
 * 子agent类型
 */
export enum SubAgentType {
  IN_PROCESS = 'in_process',
  PROCESS = 'process',
  TMUX = 'tmux',
  ITERM = 'iterm',
  CUSTOM = 'custom',
}

/**
 * 子agent配置
 */
export interface SubAgentConfig {
  id: string;
  name: string;
  type: SubAgentType;
  model?: string;
  systemPrompt?: string;
  tools?: string[];
  permissions?: any;
  communication?: any;
  resources?: {
    memory?: number;
    cpu?: number;
  };
  [key: string]: any;
}

/**
 * 子agent任务
 */
export interface SubAgentTask {
  id: string;
  type: string;
  content: string;
  context?: any;
  timeout?: number;
  [key: string]: any;
}

/**
 * 子agent结果
 */
export interface SubAgentResult {
  id: string;
  taskId: string;
  status: 'success' | 'failure';
  content: string;
  error?: string;
  metadata?: any;
  [key: string]: any;
}

/**
 * 子agent接口
 */
export interface SubAgent {
  id: string;
  name: string;
  type: SubAgentType;
  status: SubAgentStatus;
  config: SubAgentConfig;
  metadata?: any;

  /**
   * 启动子agent
   */
  start(): Promise<void>;

  /**
   * 停止子agent
   */
  stop(): Promise<void>;

  /**
   * 暂停子agent
   */
  pause(): Promise<void>;

  /**
   * 恢复子agent
   */
  resume(): Promise<void>;

  /**
   * 执行任务
   * @param task 任务
   */
  execute(task: SubAgentTask): Promise<SubAgentResult>;

  /**
   * 获取状态
   */
  getStatus(): SubAgentStatus;

  /**
   * 获取信息
   */
  getInfo(): any;

  /**
   * 更新配置
   * @param config 配置
   */
  updateConfig(config: Partial<SubAgentConfig>): Promise<void>;

  /**
   * 发送消息
   * @param message 消息
   */
  sendMessage(message: any): Promise<void>;

  /**
   * 接收消息
   */
  receiveMessage(): Promise<any>;
}

/**
 * 进程内子agent配置
 */
export interface InProcessSubAgentConfig extends SubAgentConfig {
  type: SubAgentType.IN_PROCESS;
  context?: any;
  memoryLimit?: number;
}

/**
 * 进程外子agent配置
 */
export interface ProcessSubAgentConfig extends SubAgentConfig {
  type: SubAgentType.PROCESS;
  executable?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Tmux子agent配置
 */
export interface TmuxSubAgentConfig extends SubAgentConfig {
  type: SubAgentType.TMUX;
  sessionName?: string;
  windowName?: string;
  paneName?: string;
}

/**
 * iTerm子agent配置
 */
export interface ITermSubAgentConfig extends SubAgentConfig {
  type: SubAgentType.ITERM;
  windowId?: string;
  tabId?: string;
  paneId?: string;
}

/**
 * 自定义子agent配置
 */
export interface CustomSubAgentConfig extends SubAgentConfig {
  type: SubAgentType.CUSTOM;
  [key: string]: any;
}
