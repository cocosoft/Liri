/**
 * Bridge API 类型定义
 * 定义Bridge API客户端的接口和类型
 */

/**
 * Bridge API客户端接口
 */
export interface IBridgeApiClient {
  /**
   * 注册Bridge环境
   */
  registerBridgeEnvironment(config: BridgeApiConfig): Promise<BridgeEnvironmentInfo>;

  /**
   * 轮询工作任务
   */
  pollForWork(
    environmentId: string,
    environmentSecret: string,
    signal?: AbortSignal,
    reclaimOlderThanMs?: number
  ): Promise<WorkItem | null>;

  /**
   * 确认工作任务
   */
  acknowledgeWork(
    environmentId: string,
    workId: string,
    sessionToken: string
  ): Promise<void>;

  /**
   * 停止工作任务
   */
  stopWork(
    environmentId: string,
    workId: string,
    force: boolean
  ): Promise<void>;

  /**
   * 注销环境
   */
  deregisterEnvironment(environmentId: string): Promise<void>;

  /**
   * 归档会话
   */
  archiveSession(sessionId: string): Promise<void>;

  /**
   * 重新连接会话
   */
  reconnectSession(environmentId: string, sessionId: string): Promise<void>;

  /**
   * 发送心跳
   */
  heartbeatWork(
    environmentId: string,
    workId: string,
    sessionToken: string
  ): Promise<HeartbeatResult>;

  /**
   * 发送权限响应事件
   */
  sendPermissionResponseEvent(
    sessionId: string,
    event: PermissionEvent,
    sessionToken: string
  ): Promise<void>;
}

/**
 * Bridge API配置
 */
export interface BridgeApiConfig {
  /** Bridge ID */
  bridgeId: string;
  /** 机器名称 */
  machineName: string;
  /** 工作目录 */
  dir: string;
  /** 分支名称 */
  branch?: string;
  /** Git仓库URL */
  gitRepoUrl?: string;
  /** 最大会话数 */
  maxSessions: number;
  /** 工作类型 */
  workerType: string;
  /** API基础URL */
  apiBaseUrl: string;
  /** 会话入口URL */
  sessionIngressUrl: string;
  /** 重用环境ID */
  reuseEnvironmentId?: string;
  /** 生成模式 */
  spawnMode: SpawnMode;
  /** 调试文件路径 */
  debugFile?: string;
}

/**
 * 生成模式
 */
export type SpawnMode = 'single-session' | 'same-dir' | 'worktree';

/**
 * Bridge环境信息
 */
export interface BridgeEnvironmentInfo {
  /** 环境ID */
  environment_id: string;
  /** 环境密钥 */
  environment_secret: string;
}

/**
 * 工作项
 */
export interface WorkItem {
  /** 工作ID */
  id: string;
  /** 工作数据 */
  data: WorkData;
  /** 工作密钥 */
  secret: string;
}

/**
 * 工作数据类型
 */
export type WorkData = HealthcheckData | SessionData;

/**
 * 健康检查数据
 */
export interface HealthcheckData {
  /** 工作类型 */
  type: 'healthcheck';
}

/**
 * 会话数据
 */
export interface SessionData {
  /** 工作类型 */
  type: 'session';
  /** 会话ID */
  id: string;
}

/**
 * 心跳结果
 */
export interface HeartbeatResult {
  /** 是否延长了租约 */
  lease_extended: boolean;
  /** 状态 */
  state: string;
}

/**
 * 权限事件
 */
export interface PermissionEvent {
  /** 事件类型 */
  type: 'permission_response';
  /** 事件数据 */
  data: {
    /** 权限请求ID */
    request_id: string;
    /** 响应 */
    response: 'allow' | 'deny';
  };
}

/**
 * API依赖项
 */
export interface BridgeApiDeps {
  /** 基础URL */
  baseUrl: string;
  /** 获取访问令牌的函数 */
  getAccessToken: () => string | undefined;
  /** 运行器版本 */
  runnerVersion: string;
  /** 调试回调 */
  onDebug?: (msg: string) => void;
  /** 认证401回调 */
  onAuth401?: (staleAccessToken: string) => Promise<boolean>;
  /** 获取可信设备令牌的函数 */
  getTrustedDeviceToken?: () => string | undefined;
  /** 退避配置 */
  backoffConfig?: BackoffConfig;
}

/**
 * 指数退避配置
 */
export interface BackoffConfig {
  /** 初始退避时间（毫秒） */
  initialMs: number;
  /** 最大退避时间（毫秒） */
  maxMs: number;
  /** 退避乘数 */
  multiplier: number;
  /** 最大重试次数 */
  maxRetries: number;
}

/**
 * 默认退避配置
 */
export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  initialMs: 1000,
  maxMs: 30000,
  multiplier: 2,
  maxRetries: 5,
};

/**
 * API错误类型
 */
export interface ApiError {
  /** 错误类型 */
  type: string;
  /** 错误消息 */
  message: string;
  /** HTTP状态码 */
  status: number;
}

/**
 * API响应结果
 */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };
