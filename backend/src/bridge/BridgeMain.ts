/**
 * Bridge主逻辑
 * 负责协调各个组件的工作
 */

import { randomUUID } from 'crypto';
import { hostname } from 'os';
import {
  BridgeConfig,
  BridgeApiClient,
  WorkResponse,
  SessionSpawner,
  BridgeLogger,
  BackoffConfig,
  PollConfig,
} from './types';
import { createBridgeApiClient } from './api/BridgeApi';
import { createPollManager } from './managers/PollManager';
import { createSessionManager } from './managers/SessionManager';
import { createHeartbeatManager } from './managers/HeartbeatManager';
import { createWorktreeManager } from './managers/WorktreeManager';
import { createTokenRefreshScheduler } from './utils/jwtUtils';
import {
  decodeWorkSecret,
  buildSdkUrl,
  buildCCRv2SdkUrl,
  registerWorker,
  sameSessionId,
} from './utils/workSecret';

/**
 * 默认退避配置
 */
const DEFAULT_BACKOFF: BackoffConfig = {
  connInitialMs: 2_000,
  connCapMs: 120_000, // 2分钟
  connGiveUpMs: 600_000, // 10分钟
  generalInitialMs: 500,
  generalCapMs: 30_000,
  generalGiveUpMs: 600_000, // 10分钟
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
 * Bridge主逻辑选项
 */
interface BridgeMainOptions {
  /** Bridge配置 */
  config: BridgeConfig;
  /** 会话生成器 */
  spawner: SessionSpawner;
  /** 日志器 */
  logger: BridgeLogger;
  /** 获取访问令牌的函数 */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  /** 退避配置 */
  backoffConfig?: BackoffConfig;
  /** 轮询配置 */
  pollConfig?: PollConfig;
  /** 初始会话ID */
  initialSessionId?: string;
}

/**
 * Bridge主逻辑
 */
export class BridgeMain {
  private readonly config: BridgeConfig;
  private readonly spawner: SessionSpawner;
  private readonly logger: BridgeLogger;
  private readonly getAccessToken?: () =>
    | string
    | undefined
    | Promise<string | undefined>;
  private readonly backoffConfig: BackoffConfig;
  private readonly pollConfig: PollConfig;
  private readonly initialSessionId?: string;
  private api: BridgeApiClient | null = null;
  private environmentId: string | null = null;
  private environmentSecret: string | null = null;
  private pollManager: ReturnType<typeof createPollManager> | null = null;
  private sessionManager: ReturnType<typeof createSessionManager> | null = null;
  private heartbeatManager: ReturnType<typeof createHeartbeatManager> | null =
    null;
  private worktreeManager: ReturnType<typeof createWorktreeManager> | null =
    null;
  private tokenRefreshScheduler: ReturnType<
    typeof createTokenRefreshScheduler
  > | null = null;
  private abortController: AbortController | null = null;
  private pendingCleanups: Set<Promise<unknown>> = new Set();

  constructor(options: BridgeMainOptions) {
    this.config = options.config;
    this.spawner = options.spawner;
    this.logger = options.logger;
    this.getAccessToken = options.getAccessToken;
    this.backoffConfig = options.backoffConfig || DEFAULT_BACKOFF;
    this.pollConfig = options.pollConfig || DEFAULT_POLL_CONFIG;
    this.initialSessionId = options.initialSessionId;
  }

  /**
   * 运行Bridge循环
   */
  async run(): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      // 初始化API客户端
      this.api = createBridgeApiClient({
        baseUrl: this.config.apiBaseUrl,
        getAccessToken: () => {
          const token = this.getAccessToken
            ? this.getAccessToken()
            : this.environmentSecret;
          if (typeof token === 'string') {
            return token;
          }
          return undefined;
        },
        runnerVersion: '1.0.0',
        onDebug: (msg) => console.log(msg),
      });

      // 注册环境
      const envInfo = await this.api.registerBridgeEnvironment(this.config);
      this.environmentId = envInfo.environment_id;
      this.environmentSecret = envInfo.environment_secret;

      // 初始化管理器
      this.sessionManager = createSessionManager({
        spawner: this.spawner,
        maxSessions: this.config.maxSessions,
        sessionTimeoutMs: 30 * 60 * 1000,
        onSessionDone: (sessionId, status) =>
          this.onSessionDone(sessionId, status),
      });

      this.heartbeatManager = createHeartbeatManager({
        api: this.api,
        environmentId: this.environmentId,
        heartbeatIntervalMs:
          this.pollConfig.non_exclusive_heartbeat_interval_ms,
        onError: (error) =>
          this.logger.logError(`Heartbeat error: ${error.message}`),
        signal,
      });

      this.worktreeManager = createWorktreeManager({
        baseDir: this.config.dir,
      });

      // 初始化令牌刷新调度器
      if (this.getAccessToken) {
        this.tokenRefreshScheduler = createTokenRefreshScheduler({
          getAccessToken: this.getAccessToken,
          onRefresh: (sessionId, token) =>
            this.onTokenRefresh(sessionId, token),
          label: 'bridge',
        });
      }

      // 打印横幅
      this.logger.printBanner(this.config, this.environmentId);

      // 如果有初始会话，显示其URL
      if (this.initialSessionId) {
        this.logger.setAttached(this.initialSessionId);
      }

      // 启动心跳管理器
      this.heartbeatManager.start();

      // 启动轮询管理器
      this.pollManager = createPollManager({
        api: this.api,
        environmentId: this.environmentId,
        environmentSecret: this.environmentSecret,
        pollConfig: this.pollConfig,
        onPoll: (work) => this.handleWork(work),
        onError: (error) =>
          this.logger.logError(`Poll error: ${error.message}`),
        signal,
      });

      await this.pollManager.start();
    } catch (error) {
      this.logger.logError(
        `Bridge error: ${error instanceof Error ? error.message : String(error)}`
      );
      await this.shutdown();
      throw error;
    }
  }

  /**
   * 处理工作任务
   */
  private async handleWork(work: WorkResponse | null): Promise<void> {
    if (!work) {
      // 没有工作任务
      return;
    }

    try {
      // 解码工作密钥
      const secret = decodeWorkSecret(work.secret);

      switch (work.data.type) {
        case 'healthcheck':
          // 处理健康检查
          await this.api!.acknowledgeWork(
            this.environmentId!,
            work.id,
            secret.session_ingress_token
          );
          this.logger.logVerbose('Healthcheck received');
          break;

        case 'session':
          // 处理会话任务
          await this.handleSessionWork(work, secret);
          break;
      }
    } catch (error) {
      this.logger.logError(
        `Error handling work: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 处理会话工作任务
   */
  private async handleSessionWork(
    work: WorkResponse,
    secret: any
  ): Promise<void> {
    const sessionId =
      work.data.type === 'session' ? (work.data as any).id : undefined;

    if (!sessionId) {
      this.logger.logError('Session work without session ID');
      return;
    }

    // 检查是否已有会话
    if (this.sessionManager!.hasSession(sessionId)) {
      // 更新现有会话的令牌
      const sessionInfo = this.sessionManager!.getSession(sessionId);
      if (sessionInfo) {
        sessionInfo.handle.updateAccessToken(secret.session_ingress_token);
        this.heartbeatManager!.addSession(
          sessionId,
          work.id,
          secret.session_ingress_token
        );
        this.tokenRefreshScheduler?.schedule(
          sessionId,
          secret.session_ingress_token
        );
      }
      await this.api!.acknowledgeWork(
        this.environmentId!,
        work.id,
        secret.session_ingress_token
      );
      return;
    }

    // 检查是否达到最大会话数
    if (
      this.sessionManager!.getActiveSessionCount() >= this.config.maxSessions
    ) {
      this.logger.logError(
        `At capacity, cannot spawn new session for workId=${work.id}`
      );
      return;
    }

    // 确认工作任务
    await this.api!.acknowledgeWork(
      this.environmentId!,
      work.id,
      secret.session_ingress_token
    );

    // 确定SDK URL
    let sdkUrl: string;
    let useCcrV2 = false;

    if (secret.use_code_sessions === true) {
      // CCR v2路径
      sdkUrl = buildCCRv2SdkUrl(this.config.apiBaseUrl, sessionId);
      try {
        await registerWorker(sdkUrl, secret.session_ingress_token);
        useCcrV2 = true;
      } catch (error) {
        this.logger.logError(
          `CCR v2 worker registration failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }
    } else {
      // v1路径
      sdkUrl = buildSdkUrl(this.config.sessionIngressUrl, sessionId);
    }

    // 确定会话目录
    let sessionDir = this.config.dir;

    if (
      this.config.spawnMode === 'worktree' &&
      (this.initialSessionId === undefined ||
        !sameSessionId(sessionId, this.initialSessionId))
    ) {
      try {
        const worktreeInfo =
          await this.worktreeManager!.createWorktree(sessionId);
        sessionDir = worktreeInfo.worktreePath;
      } catch (error) {
        this.logger.logError(
          `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }
    }

    // 创建会话
    try {
      const handle = this.sessionManager!.createSession(
        sessionId,
        sdkUrl,
        secret.session_ingress_token,
        work.id,
        sessionDir
      );

      // 添加到心跳管理器
      this.heartbeatManager!.addSession(
        sessionId,
        work.id,
        secret.session_ingress_token
      );

      // 调度令牌刷新
      this.tokenRefreshScheduler?.schedule(
        sessionId,
        secret.session_ingress_token
      );

      this.logger.logVerbose(`Spawned session ${sessionId}`);
    } catch (error) {
      this.logger.logError(
        `Failed to spawn session: ${error instanceof Error ? error.message : String(error)}`
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
    // 从心跳管理器中移除
    this.heartbeatManager!.removeSession(sessionId);

    // 清理工作树
    await this.worktreeManager!.removeWorktree(sessionId);

    // 取消令牌刷新
    this.tokenRefreshScheduler?.cancel(sessionId);

    this.logger.logVerbose(
      `Session ${sessionId} completed with status: ${status}`
    );
  }

  /**
   * 处理令牌刷新
   */
  private onTokenRefresh(sessionId: string, token: string): void {
    const sessionInfo = this.sessionManager!.getSession(sessionId);
    if (sessionInfo) {
      sessionInfo.handle.updateAccessToken(token);
    }
  }

  /**
   * 关闭Bridge
   */
  async shutdown(): Promise<void> {
    this.logger.logVerbose('Shutting down Bridge...');

    // 中止轮询
    this.abortController?.abort();

    // 停止心跳
    this.heartbeatManager?.stop();

    // 清理所有会话
    if (this.sessionManager) {
      await this.sessionManager.clearAllSessions();
    }

    // 清理所有工作树
    if (this.worktreeManager) {
      await this.worktreeManager.clearAllWorktrees();
    }

    // 等待所有清理操作完成
    await Promise.all(this.pendingCleanups);

    // 注销环境
    if (this.api && this.environmentId) {
      try {
        await this.api.deregisterEnvironment(this.environmentId);
      } catch (error) {
        this.logger.logError(
          `Failed to deregister environment: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    this.logger.logVerbose('Bridge shutdown complete');
  }

  /**
   * 跟踪清理操作
   */
  private trackCleanup(p: Promise<unknown>): void {
    this.pendingCleanups.add(p);
    void p.finally(() => this.pendingCleanups.delete(p));
  }
}

/**
 * 创建Bridge主逻辑
 */
export function createBridgeMain(options: BridgeMainOptions): BridgeMain {
  return new BridgeMain(options);
}
