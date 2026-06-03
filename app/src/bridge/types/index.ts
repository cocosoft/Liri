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
 * Bridge系统类型定义
 * 定义Bridge系统的核心类型
 */

/**
 * Bridge系统配置
 */
export interface BridgeConfig {
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
 * Bridge API客户端
 */
export interface BridgeApiClient {
  /**
   * 注册Bridge环境
   */
  registerBridgeEnvironment(config: BridgeConfig): Promise<{
    environment_id: string;
    environment_secret: string;
  }>;

  /**
   * 轮询工作任务
   */
  pollForWork(
    environmentId: string,
    environmentSecret: string,
    signal?: AbortSignal,
    reclaimOlderThanMs?: number
  ): Promise<WorkResponse | null>;

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
  ): Promise<{ lease_extended: boolean; state: string }>;

  /**
   * 发送权限响应事件
   */
  sendPermissionResponseEvent(
    sessionId: string,
    event: PermissionResponseEvent,
    sessionToken: string
  ): Promise<void>;
}

/**
 * 工作任务响应
 */
export interface WorkResponse {
  /** 工作任务ID */
  id: string;
  /** 工作任务数据 */
  data: WorkData;
  /** 工作任务密钥 */
  secret: string;
}

/**
 * 工作任务数据
 */
export type WorkData = HealthcheckWorkData | SessionWorkData;

/**
 * 健康检查工作任务数据
 */
export interface HealthcheckWorkData {
  /** 工作任务类型 */
  type: 'healthcheck';
}

/**
 * 会话工作任务数据
 */
export interface SessionWorkData {
  /** 工作任务类型 */
  type: 'session';
  /** 会话ID */
  id: string;
}

/**
 * 会话活动
 */
export interface SessionActivity {
  /** 活动类型 */
  type: 'tool_start' | 'tool_end' | 'result' | 'error';
  /** 活动摘要 */
  summary: string;
  /** 活动时间戳 */
  timestamp: number;
}

/**
 * 会话句柄
 */
export interface SessionHandle {
  /** 当前活动 */
  currentActivity: SessionActivity | null;
  /** 活动历史 */
  activities: SessionActivity[];
  /** 最后一次stderr输出 */
  lastStderr: string[];
  /** 更新访问令牌 */
  updateAccessToken(token: string): void;
  /** 停止会话 */
  stop(): Promise<void>;
}

/**
 * 会话生成选项
 */
export interface SessionSpawnOpts {
  /** SDK URL */
  sdkUrl: string;
  /** 访问令牌 */
  accessToken: string;
  /** 环境变量 */
  env?: Record<string, string>;
}

/**
 * 会话完成状态
 */
export type SessionDoneStatus = 'completed' | 'failed' | 'interrupted';

/**
 * 会话生成器
 */
export interface SessionSpawner {
  /**
   * 生成会话
   */
  spawn(opts: SessionSpawnOpts, dir: string): SessionHandle;
}

/**
 * 权限响应事件
 */
export interface PermissionResponseEvent {
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
 * Bridge日志器
 */
export interface BridgeLogger {
  /**
   * 打印横幅
   */
  printBanner(config: BridgeConfig, environmentId: string): void;

  /**
   * 设置附加会话
   */
  setAttached(sessionId: string): void;

  /**
   * 更新会话计数
   */
  updateSessionCount(count: number, max: number, spawnMode: SpawnMode): void;

  /**
   * 更新会话活动
   */
  updateSessionActivity(sessionId: string, activity: SessionActivity): void;

  /**
   * 更新会话状态
   */
  updateSessionStatus(
    sessionId: string,
    elapsed: string,
    activity: SessionActivity,
    trail: string[]
  ): void;

  /**
   * 更新空闲状态
   */
  updateIdleStatus(): void;

  /**
   * 移除会话
   */
  removeSession(sessionId: string): void;

  /**
   * 清除状态
   */
  clearStatus(): void;

  /**
   * 刷新显示
   */
  refreshDisplay(): void;

  /**
   * 记录会话完成
   */
  logSessionComplete(sessionId: string, durationMs: number): void;

  /**
   * 记录会话失败
   */
  logSessionFailed(sessionId: string, errorMessage: string): void;

  /**
   * 记录重新连接
   */
  logReconnected(disconnectedMs: number): void;

  /**
   * 记录错误
   */
  logError(message: string): void;

  /**
   * 记录详细信息
   */
  logVerbose(message: string): void;

  /**
   * 设置调试日志路径
   */
  setDebugLogPath(path: string): void;
}

/**
 * 退避配置
 */
export interface BackoffConfig {
  /** 连接初始退避时间（毫秒） */
  connInitialMs: number;
  /** 连接最大退避时间（毫秒） */
  connCapMs: number;
  /** 连接放弃时间（毫秒） */
  connGiveUpMs: number;
  /** 通用初始退避时间（毫秒） */
  generalInitialMs: number;
  /** 通用最大退避时间（毫秒） */
  generalCapMs: number;
  /** 通用放弃时间（毫秒） */
  generalGiveUpMs: number;
  /** 关闭优雅期（毫秒） */
  shutdownGraceMs?: number;
  /** 停止工作基础延迟（毫秒） */
  stopWorkBaseDelayMs?: number;
}

/**
 * 轮询配置
 */
export interface PollConfig {
  /** 非独占心跳间隔（毫秒） */
  non_exclusive_heartbeat_interval_ms: number;
  /** 容量满时的轮询间隔（毫秒） */
  multisession_poll_interval_ms_at_capacity: number;
  /** 部分容量时的轮询间隔（毫秒） */
  multisession_poll_interval_ms_partial_capacity: number;
  /** 未满容量时的轮询间隔（毫秒） */
  multisession_poll_interval_ms_not_at_capacity: number;
  /** 回收旧工作的时间（毫秒） */
  reclaim_older_than_ms: number;
}

/**
 * 工作密钥
 */
export interface WorkSecret {
  /** 会话入口令牌 */
  session_ingress_token: string;
  /** API基础URL */
  api_base_url: string;
  /** 是否使用代码会话 */
  use_code_sessions: boolean;
}

/**
 * Bridge登录错误
 */
export const BRIDGE_LOGIN_ERROR = 'Bridge login error';

/**
 * Bridge登录指令
 */
export const BRIDGE_LOGIN_INSTRUCTION = 'Please log in first with `Liri login`';

/**
 * 默认会话超时时间（毫秒）
 */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
