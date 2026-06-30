/**
 * Bridge 主逻辑
 * 负责协调轮询、会话、心跳等管理器的工作
 */

import type {
  BridgeConfig,
  BridgeApiClient,
  WorkResponse,
  SessionSpawner,
  BackoffConfig,
  PollConfig,
  SessionActivity,
} from './types/index.js';
import { createBridgeApiClient } from './api/BridgeApi.js';
import { createSimulatedBridgeApi } from './api/SimulatedBridgeApi.js';
import { createPollManager } from './managers/PollManager.js';
import { createSessionManager } from './managers/SessionManager.js';
import { createHeartbeatManager } from './managers/HeartbeatManager.js';
import { createWorkspaceGit } from '@modules/workspaces/WorkspaceGit.js';
import { bridgeStateStore } from './state/BridgeStateStore.js';

/**
 * 默认退避配置
 */
const DEFAULT_BACKOFF: BackoffConfig = {
  connInitialMs: 2_000,
  connCapMs: 120_000,
  connGiveUpMs: 600_000,
  generalInitialMs: 500,
  generalCapMs: 30_000,
  generalGiveUpMs: 600_000,
  shutdownGraceMs: 30_000,
  stopWorkBaseDelayMs: 1000,
};

/**
 * 默认轮询配置
 */
const DEFAULT_POLL_CONFIG: PollConfig = {
  non_exclusive_heartbeat_interval_ms: 30000,
  multisession_poll_interval_ms_at_capacity: 60000,
  multisession_poll_interval_ms_partial_capacity: 5000,
  multisession_poll_interval_ms_not_at_capacity: 2000,
  reclaim_older_than_ms: 300000,
};

/**
 * Bridge 主逻辑选项
 */
export interface BridgeMainOptions {
  /** Bridge 配置 */
  config: BridgeConfig;
  /** 会话生成器 */
  spawner: SessionSpawner;
  /** 日志器 */
  logger: {
    logError: (msg: string) => void;
    logVerbose: (msg: string) => void;
    logInfo?: (msg: string) => void;
    printBanner?: (config: BridgeConfig, envId: string) => void;
    setAttached?: (sessionId: string) => void;
  };
  /** 获取访问令牌的函数 */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  /** 退避配置 */
  backoffConfig?: BackoffConfig;
  /** 轮询配置 */
  pollConfig?: PollConfig;
  /** 初始会话ID */
  initialSessionId?: string;
  /** 使用模拟模式（不需要网络） */
  useSimulatedApi?: boolean;
  /** 模拟模式下的轮询回调（用于注入本地工作） */
  onSimulatedPoll?: (pollCount: number) => WorkResponse | null;
}

/**
 * Bridge 主逻辑
 * 管理完整的 Bridge 生命周期：注册、轮询、会话管理、心跳、清理
 */
export class BridgeMain {
  private readonly config: BridgeConfig;
  private readonly spawner: SessionSpawner;
  private readonly logger: BridgeMainOptions['logger'];
  private readonly getAccessToken?: () =>
    | string
    | undefined
    | Promise<string | undefined>;
  private readonly backoffConfig: BackoffConfig;
  private readonly pollConfig: PollConfig;
  private readonly initialSessionId?: string;
  private readonly useSimulatedApi: boolean;
  private readonly onSimulatedPoll?: (pollCount: number) => WorkResponse | null;

  private api: BridgeApiClient | null = null;
  private environmentId: string | null = null;
  private environmentSecret: string | null = null;
  private pollManager: ReturnType<typeof createPollManager> | null = null;
  private sessionManager: ReturnType<typeof createSessionManager> | null = null;
  private heartbeatManager: ReturnType<typeof createHeartbeatManager> | null =
    null;
  private worktreeManager: ReturnType<typeof createWorkspaceGit> | null = null;
  private abortController: AbortController | null = null;
  private isRunning = false;

  constructor(options: BridgeMainOptions) {
    this.config = options.config;
    this.spawner = options.spawner;
    this.logger = options.logger;
    this.getAccessToken = options.getAccessToken;
    this.backoffConfig = options.backoffConfig || DEFAULT_BACKOFF;
    this.pollConfig = options.pollConfig || DEFAULT_POLL_CONFIG;
    this.initialSessionId = options.initialSessionId;
    this.useSimulatedApi = options.useSimulatedApi ?? false;
    this.onSimulatedPoll = options.onSimulatedPoll;
  }

  /**
   * 运行 Bridge 循环
   */
  async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      this.api = this.useSimulatedApi
        ? createSimulatedBridgeApi({
            onPoll: this.onSimulatedPoll,
            onDebug: (msg) => this.logger.logVerbose(msg),
          })
        : createBridgeApiClient({
            baseUrl: this.config.apiBaseUrl,
            getAccessToken: () => {
              const token = this.getAccessToken
                ? this.getAccessToken()
                : this.environmentSecret;
              return typeof token === 'string' ? token : undefined;
            },
            runnerVersion: '1.0.0',
            onDebug: (msg) => this.logger.logVerbose(msg),
          });

      const envInfo = await this.api.registerBridgeEnvironment(this.config);
      this.environmentId = envInfo.environment_id;
      this.environmentSecret = envInfo.environment_secret;

      bridgeStateStore.setEnvironmentId(this.environmentId);
      bridgeStateStore.setBridgeState('connected');

      this.sessionManager = createSessionManager({
        spawner: this.spawner,
        maxSessions: this.config.maxSessions,
        sessionTimeoutMs: 30 * 60 * 1000,
        onSessionDone: (sessionId, status) => {
          void this.onSessionDone(sessionId, status);
        },
      });

      this.heartbeatManager = createHeartbeatManager({
        api: this.api,
        environmentId: this.environmentId,
        heartbeatIntervalMs:
          this.pollConfig.non_exclusive_heartbeat_interval_ms,
        onError: (error) => this.logger.logError(`心跳错误: ${error.message}`),
        onSessionExpired: (sessionId, workId) => {
          this.logger.logError(`会话 ${sessionId} (工作 ${workId}) 心跳过期`);
          bridgeStateStore.removeSession(sessionId);
        },
        signal,
      });

      this.worktreeManager = createWorkspaceGit({
        baseDir: this.config.dir,
      });

      if (this.logger.printBanner) {
        this.logger.printBanner(this.config, this.environmentId);
      }

      if (this.initialSessionId && this.logger.setAttached) {
        this.logger.setAttached(this.initialSessionId);
      }

      this.heartbeatManager.start();

      this.pollManager = createPollManager({
        api: this.api,
        environmentId: this.environmentId,
        environmentSecret: this.environmentSecret,
        pollConfig: this.pollConfig,
        getActiveSessionCount: () =>
          this.sessionManager?.getActiveSessionCount() ?? 0,
        maxSessions: this.config.maxSessions,
        onWork: (work) => this.handleWork(work),
        onError: (error) => this.logger.logError(`轮询错误: ${error.message}`),
        signal,
      });

      await this.pollManager.start();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.logError(`Bridge 错误: ${msg}`);
      bridgeStateStore.setError(msg);
      await this.shutdown();
      throw error;
    }
  }

  /**
   * 关闭 Bridge
   */
  async shutdown(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    this.logger.logVerbose('正在关闭 Bridge...');

    this.abortController?.abort();

    this.heartbeatManager?.stop();

    if (this.sessionManager) {
      await this.sessionManager.clearAllSessions();
    }

    if (this.worktreeManager) {
      await this.worktreeManager.clearAllWorktrees();
    }

    if (this.api && this.environmentId) {
      try {
        await this.api.deregisterEnvironment(this.environmentId);
      } catch (error) {
        this.logger.logError(
          `注销环境失败: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    bridgeStateStore.setBridgeState('ready');
    bridgeStateStore.disable();

    this.logger.logVerbose('Bridge 关闭完成');
  }

  /**
   * 获取轮询管理器（用于注入模拟工作）
   */
  getPollManager(): ReturnType<typeof createPollManager> | null {
    return this.pollManager;
  }

  /**
   * 获取会话管理器
   */
  getSessionManager(): ReturnType<typeof createSessionManager> | null {
    return this.sessionManager;
  }

  /**
   * 获取心跳管理器
   */
  getHeartbeatManager(): ReturnType<typeof createHeartbeatManager> | null {
    return this.heartbeatManager;
  }

  /**
   * 是否正在运行
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 获取环境 ID
   */
  getEnvironmentId(): string | null {
    return this.environmentId;
  }

  /**
   * 处理工作任务
   */
  private async handleWork(work: WorkResponse): Promise<void> {
    try {
      bridgeStateStore.incrementMessageCount();

      switch (work.data.type) {
        case 'healthcheck':
          await this.api!.acknowledgeWork(
            this.environmentId!,
            work.id,
            work.secret
          );
          break;

        case 'session':
          await this.handleSessionWork(work);
          break;
      }
    } catch (error) {
      this.logger.logError(
        `处理工作失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 处理会话工作任务
   */
  private async handleSessionWork(work: WorkResponse): Promise<void> {
    if (work.data.type !== 'session') return;

    const sessionId = work.data.id;
    if (!sessionId) {
      this.logger.logError('会话工作缺少会话 ID');
      return;
    }

    if (this.sessionManager!.hasSession(sessionId)) {
      this.heartbeatManager!.addSession(sessionId, work.id, work.secret);
      await this.api!.acknowledgeWork(
        this.environmentId!,
        work.id,
        work.secret
      );
      return;
    }

    if (
      this.sessionManager!.getActiveSessionCount() >= this.config.maxSessions
    ) {
      this.logger.logError(`已达容量上限，无法为工作 ${work.id} 创建新会话`);
      return;
    }

    await this.api!.acknowledgeWork(this.environmentId!, work.id, work.secret);

    let sessionDir = this.config.dir;

    if (this.config.spawnMode === 'worktree') {
      try {
        const worktreeInfo =
          await this.worktreeManager!.createWorktree(sessionId);
        sessionDir = worktreeInfo.worktreePath;
      } catch (error) {
        this.logger.logError(
          `创建工作树失败: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }
    }

    try {
      const handle = this.sessionManager!.createSession(
        sessionId,
        this.config.sessionIngressUrl,
        work.secret,
        work.id,
        sessionDir
      );

      this.heartbeatManager!.addSession(sessionId, work.id, work.secret);

      bridgeStateStore.addSession({
        id: sessionId,
        createdAt: Date.now(),
        directory: sessionDir,
      });

      this.logger.logVerbose(`已创建会话 ${sessionId}`);
    } catch (error) {
      this.logger.logError(
        `创建会话失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 处理会话完成
   */
  private async onSessionDone(
    sessionId: string,
    status: string
  ): Promise<void> {
    this.heartbeatManager?.removeSession(sessionId);

    await this.worktreeManager?.removeWorktree(sessionId);

    bridgeStateStore.removeSession(sessionId);

    const activity: SessionActivity = {
      type: 'result',
      summary: `会话完成: ${status}`,
      timestamp: Date.now(),
    };
    this.sessionManager?.updateSessionActivity(sessionId, activity);

    this.logger.logVerbose(`会话 ${sessionId} 完成，状态: ${status}`);
  }
}

/**
 * 创建 Bridge 主逻辑
 */
export function createBridgeMain(options: BridgeMainOptions): BridgeMain {
  return new BridgeMain(options);
}
