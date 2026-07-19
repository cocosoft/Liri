/**
 * 模拟 Bridge API 客户端
 * 提供本地模拟的 API 实现，无需网络通信即可让整个 Bridge 系统运行
 */

import { randomUUID } from 'crypto';
import type {
  BridgeConfig,
  BridgeApiClient,
  WorkResponse,
  WorkSecret,
  PollConfig,
} from '../types/index.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'bridge\api\SimulatedBridgeApi',
  level: LogLevel.INFO,
});

/**
 * 模拟 API 客户端选项
 */
export interface SimulatedBridgeApiOptions {
  /** 是否模拟注册失败 */
  simulateRegisterFailure?: boolean;
  /** 是否模拟轮询失败 */
  simulatePollFailure?: boolean;
  /** 注册延迟（毫秒） */
  registerDelayMs?: number;
  /** 轮询延迟（毫秒） */
  pollDelayMs?: number;
  /** 自定义回调：每次轮询时调用，可返回模拟的工作任务 */
  onPoll?: (pollCount: number) => WorkResponse | null;
  /** 调试日志回调 */
  onDebug?: (msg: string) => void;
}

/**
 * 创建模拟 Bridge API 客户端
 */
export function createSimulatedBridgeApi(
  options?: SimulatedBridgeApiOptions
): BridgeApiClient {
  const {
    simulateRegisterFailure = false,
    simulatePollFailure = false,
    registerDelayMs = 100,
    pollDelayMs = 500,
    onPoll,
    onDebug,
  } = options ?? {};

  let environmentId: string | null = null;
  let environmentSecret: string | null = null;
  let pollCount = 0;

  function debug(msg: string): void {
    onDebug?.(msg);
  }

  return {
    async registerBridgeEnvironment(
      _config: BridgeConfig
    ): Promise<{ environment_id: string; environment_secret: string }> {
      debug('[sim-api] 注册环境...（模拟）');

      if (simulateRegisterFailure) {
        throw new AppError(
          '[sim-api] 模拟注册失败',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      await new Promise((resolve) => setTimeout(resolve, registerDelayMs));

      environmentId = `sim-env-${randomUUID().slice(0, 8)}`;
      environmentSecret = `sim-secret-${randomUUID().slice(0, 16)}`;

      debug(`[sim-api] 环境注册成功: ${environmentId}`);
      return {
        environment_id: environmentId,
        environment_secret: environmentSecret,
      };
    },

    async pollForWork(
      _envId: string,
      _envSecret: string,
      _signal?: AbortSignal,
      _reclaimOlderThanMs?: number
    ): Promise<WorkResponse | null> {
      pollCount++;

      if (simulatePollFailure) {
        throw new AppError(
          '[sim-api] 模拟轮询失败',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));

      // 如果设置了自定义轮询回调，使用它返回工作任务
      if (onPoll) {
        const work = onPoll(pollCount);
        if (work) {
          debug(`[sim-api] 轮询 #${pollCount}: 返回工作任务 ${work.id}`);
          return work;
        }
      }

      // 默认返回 null（无工作任务）
      return null;
    },

    async acknowledgeWork(
      _envId: string,
      workId: string,
      _sessionToken: string
    ): Promise<void> {
      debug(`[sim-api] 确认工作任务: ${workId}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    },

    async stopWork(
      _envId: string,
      workId: string,
      _force: boolean
    ): Promise<void> {
      debug(`[sim-api] 停止工作任务: ${workId}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    },

    async deregisterEnvironment(envId: string): Promise<void> {
      debug(`[sim-api] 注销环境: ${envId}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      environmentId = null;
      environmentSecret = null;
    },

    async archiveSession(sessionId: string): Promise<void> {
      debug(`[sim-api] 归档会话: ${sessionId}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    },

    async reconnectSession(_envId: string, sessionId: string): Promise<void> {
      debug(`[sim-api] 重新连接会话: ${sessionId}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    },

    async heartbeatWork(
      _envId: string,
      workId: string,
      _sessionToken: string
    ): Promise<{ lease_extended: boolean; state: string }> {
      debug(`[sim-api] 发送心跳: ${workId}`);
      return { lease_extended: true, state: 'active' };
    },

    async sendPermissionResponseEvent(
      _sessionId: string,
      _event: any,
      _sessionToken: string
    ): Promise<void> {
      debug('[sim-api] 发送权限响应事件');
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}
