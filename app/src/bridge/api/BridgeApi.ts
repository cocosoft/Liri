/**
 * Bridge API实现
 * 负责与远程服务器的通信
 */

import axios, { AxiosError } from 'axios';
import {
  BridgeConfig,
  BridgeApiClient,
  WorkResponse,
  PermissionResponseEvent,
} from '../types';
import { debugBody, extractErrorDetail } from '../utils/debugUtils';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'bridge\api\BridgeApi',
  level: LogLevel.INFO,
});

/**
 * 指数退避配置
 */
interface BackoffConfig {
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
const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  initialMs: 1000,
  maxMs: 30000,
  multiplier: 2,
  maxRetries: 5,
};

/**
 * 执行指数退避等待
 */
async function backoffWait(
  retryCount: number,
  config: BackoffConfig
): Promise<void> {
  const delay = Math.min(
    config.initialMs * Math.pow(config.multiplier, retryCount),
    config.maxMs
  );
  // 添加抖动（0-100ms）
  const jitter = Math.random() * 100;
  await new Promise((resolve) => setTimeout(resolve, delay + jitter));
}

/**
 * 检查是否应该重试请求
 */
function shouldRetry(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    // 网络错误或5xx错误应该重试
    if (!axiosError.response) {
      return true; // 网络错误
    }
    const status = axiosError.response.status;
    // 5xx服务器错误或429限流错误应该重试
    return status >= 500 || status === 429;
  }
  return false;
}

/**
 * Bridge API依赖
 */
interface BridgeApiDeps {
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
  /** 退避配置（可选） */
  backoffConfig?: BackoffConfig;
}

/**
 * Bridge致命错误
 */
export class BridgeFatalError extends AppError {
  readonly status: number;
  /** 服务器提供的错误类型 */
  readonly errorType: string | undefined;
  constructor(message: string, status: number, errorType?: string) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.HIGH, String(status));
    this.name = 'BridgeFatalError';
    this.status = status;
    this.errorType = errorType;
  }
}

/**
 * 验证Bridge ID
 */
export function validateBridgeId(id: string, label: string): string {
  const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new AppError(
      `Invalid ${label}: contains unsafe characters`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return id;
}

/**
 * 创建Bridge API客户端
 */
export function createBridgeApiClient(deps: BridgeApiDeps): BridgeApiClient {
  function debug(msg: string): void {
    deps.onDebug?.(msg);
  }

  let consecutiveEmptyPolls = 0;
  const EMPTY_POLL_LOG_INTERVAL = 100;
  const BETA_HEADER = 'environments-2025-11-01';
  const backoffConfig = deps.backoffConfig || DEFAULT_BACKOFF_CONFIG;

  function getHeaders(accessToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'x-environment-runner-version': deps.runnerVersion,
    };
    const deviceToken = deps.getTrustedDeviceToken?.();
    if (deviceToken) {
      headers['X-Trusted-Device-Token'] = deviceToken;
    }
    return headers;
  }

  function resolveAuth(): string {
    const accessToken = deps.getAccessToken();
    if (!accessToken) {
      throw new AppError(
        'Please log in first with `Liri login`',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return accessToken;
  }

  /**
   * 带指数退避重试的请求包装函数
   */
  async function withRetry<T>(
    fn: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: unknown;
    for (
      let retryCount = 0;
      retryCount <= backoffConfig.maxRetries;
      retryCount++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!shouldRetry(error)) {
          throw error;
        }
        if (retryCount >= backoffConfig.maxRetries) {
          debug(
            `[bridge:api] ${context}: Max retries (${backoffConfig.maxRetries}) exceeded`
          );
          throw error;
        }
        debug(
          `[bridge:api] ${context}: Retry ${retryCount + 1}/${backoffConfig.maxRetries} due to error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        await backoffWait(retryCount, backoffConfig);
      }
    }
    throw lastError ?? new Error(`${context}: Unknown error`);
  }

  /**
   * 执行带OAuth重试的请求
   */
  async function withOAuthRetry<T>(
    fn: (accessToken: string) => Promise<{ status: number; data: T }>,
    context: string
  ): Promise<{ status: number; data: T }> {
    const accessToken = resolveAuth();
    const response = await fn(accessToken);

    if (response.status !== 401) {
      return response;
    }

    if (!deps.onAuth401) {
      debug(`[bridge:api] ${context}: 401 received, no refresh handler`);
      return response;
    }

    // 尝试令牌刷新
    debug(`[bridge:api] ${context}: 401 received, attempting token refresh`);
    const refreshed = await deps.onAuth401(accessToken);
    if (refreshed) {
      debug(`[bridge:api] ${context}: Token refreshed, retrying request`);
      const newToken = resolveAuth();
      const retryResponse = await fn(newToken);
      if (retryResponse.status !== 401) {
        return retryResponse;
      }
      debug(`[bridge:api] ${context}: Retry after refresh also got 401`);
    } else {
      debug(`[bridge:api] ${context}: Token refresh failed`);
    }

    // 刷新失败 — 返回401
    return response;
  }

  /**
   * 处理错误状态
   */
  function handleErrorStatus(
    status: number,
    data: unknown,
    context: string
  ): void {
    if (status === 200 || status === 204) {
      return;
    }
    const detail = extractErrorDetail(data);
    const errorType = extractErrorTypeFromData(data);
    switch (status) {
      case 401:
        throw new BridgeFatalError(
          `${context}: Authentication failed (401)${detail ? `: ${detail}` : ''}. Please log in first with \`Liri login\``,
          401,
          errorType
        );
      case 403:
        throw new BridgeFatalError(
          isExpiredErrorType(errorType)
            ? 'Remote Control session has expired. Please restart with `Liri bridge start`.'
            : `${context}: Access denied (403)${detail ? `: ${detail}` : ''}. Check your organization permissions.`,
          403,
          errorType
        );
      case 404:
        throw new BridgeFatalError(
          detail ??
            `${context}: Not found (404). Remote Control may not be available for this organization.`,
          404,
          errorType
        );
      case 410:
        throw new BridgeFatalError(
          detail ??
            'Remote Control session has expired. Please restart with `Liri bridge start`.',
          410,
          errorType ?? 'environment_expired'
        );
      case 429:
        throw new AppError(
          `${context}: Rate limited (429). Polling too frequently.`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      default:
        throw new AppError(
          `${context}: Failed with status ${status}${detail ? `: ${detail}` : ''}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
    }
  }

  /**
   * 从数据中提取错误类型
   */
  function extractErrorTypeFromData(data: unknown): string | undefined {
    if (data && typeof data === 'object') {
      if (
        'error' in data &&
        data.error &&
        typeof data.error === 'object' &&
        'type' in data.error &&
        typeof data.error.type === 'string'
      ) {
        return data.error.type;
      }
    }
    return undefined;
  }

  return {
    async registerBridgeEnvironment(
      config: BridgeConfig
    ): Promise<{ environment_id: string; environment_secret: string }> {
      debug(
        `[bridge:api] POST /v1/environments/bridge bridgeId=${config.bridgeId}`
      );

      const response = await withRetry(
        () =>
          withOAuthRetry(
            (token: string) =>
              axios.post<{
                environment_id: string;
                environment_secret: string;
              }>(
                `${deps.baseUrl}/v1/environments/bridge`,
                {
                  machine_name: config.machineName,
                  directory: config.dir,
                  branch: config.branch,
                  git_repo_url: config.gitRepoUrl,
                  max_sessions: config.maxSessions,
                  metadata: { worker_type: config.workerType },
                  ...(config.reuseEnvironmentId && {
                    environment_id: config.reuseEnvironmentId,
                  }),
                },
                {
                  headers: getHeaders(token),
                  timeout: 15_000,
                  validateStatus: (status) => status < 500,
                }
              ),
            'Registration'
          ),
        'Registration'
      );

      handleErrorStatus(response.status, response.data, 'Registration');
      debug(
        `[bridge:api] POST /v1/environments/bridge -> ${response.status} environment_id=${response.data.environment_id}`
      );
      return response.data;
    },

    async pollForWork(
      environmentId: string,
      environmentSecret: string,
      signal?: AbortSignal,
      reclaimOlderThanMs?: number
    ): Promise<WorkResponse | null> {
      validateBridgeId(environmentId, 'environmentId');

      // 保存并重置连续空轮询计数
      const prevEmptyPolls = consecutiveEmptyPolls;
      consecutiveEmptyPolls = 0;

      const response = await withRetry(
        () =>
          axios.get<WorkResponse | null>(
            `${deps.baseUrl}/v1/environments/${environmentId}/work/poll`,
            {
              headers: getHeaders(environmentSecret),
              params:
                reclaimOlderThanMs !== undefined
                  ? { reclaim_older_than_ms: reclaimOlderThanMs }
                  : undefined,
              timeout: 10_000,
              signal,
              validateStatus: (status) => status < 500,
            }
          ),
        'Poll'
      );

      handleErrorStatus(response.status, response.data, 'Poll');

      // 空响应 = 没有可用工作
      if (!response.data) {
        consecutiveEmptyPolls = prevEmptyPolls + 1;
        if (
          consecutiveEmptyPolls === 1 ||
          consecutiveEmptyPolls % EMPTY_POLL_LOG_INTERVAL === 0
        ) {
          debug(
            `[bridge:api] GET .../work/poll -> ${response.status} (no work, ${consecutiveEmptyPolls} consecutive empty polls)`
          );
        }
        return null;
      }

      const workId = response.data.id;
      const workType = response.data.data?.type;
      const sessionId =
        response.data.data?.type === 'session'
          ? (response.data.data as unknown as Record<string, unknown>).id
          : undefined;
      debug(
        `[bridge:api] GET .../work/poll -> ${response.status} workId=${workId} type=${workType}${sessionId ? ` sessionId=${sessionId}` : ''}`
      );
      return response.data;
    },

    async acknowledgeWork(
      environmentId: string,
      workId: string,
      sessionToken: string
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId');
      validateBridgeId(workId, 'workId');

      debug(`[bridge:api] POST .../work/${workId}/ack`);

      const response = await withRetry(
        () =>
          axios.post(
            `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/ack`,
            {},
            {
              headers: getHeaders(sessionToken),
              timeout: 10_000,
              validateStatus: (s) => s < 500,
            }
          ),
        'Acknowledge'
      );

      handleErrorStatus(response.status, response.data, 'Acknowledge');
      debug(`[bridge:api] POST .../work/${workId}/ack -> ${response.status}`);
    },

    async stopWork(
      environmentId: string,
      workId: string,
      force: boolean
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId');
      validateBridgeId(workId, 'workId');

      debug(`[bridge:api] POST .../work/${workId}/stop force=${force}`);

      const response = await withRetry(
        () =>
          withOAuthRetry(
            (token: string) =>
              axios.post(
                `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/stop`,
                { force },
                {
                  headers: getHeaders(token),
                  timeout: 10_000,
                  validateStatus: (s) => s < 500,
                }
              ),
            'StopWork'
          ),
        'StopWork'
      );

      handleErrorStatus(response.status, response.data, 'StopWork');
      debug(`[bridge:api] POST .../work/${workId}/stop -> ${response.status}`);
    },

    async deregisterEnvironment(environmentId: string): Promise<void> {
      validateBridgeId(environmentId, 'environmentId');

      debug(`[bridge:api] DELETE /v1/environments/bridge/${environmentId}`);

      const response = await withRetry(
        () =>
          withOAuthRetry(
            (token: string) =>
              axios.delete(
                `${deps.baseUrl}/v1/environments/bridge/${environmentId}`,
                {
                  headers: getHeaders(token),
                  timeout: 10_000,
                  validateStatus: (s) => s < 500,
                }
              ),
            'Deregister'
          ),
        'Deregister'
      );

      handleErrorStatus(response.status, response.data, 'Deregister');
      debug(
        `[bridge:api] DELETE /v1/environments/bridge/${environmentId} -> ${response.status}`
      );
    },

    async archiveSession(sessionId: string): Promise<void> {
      validateBridgeId(sessionId, 'sessionId');

      debug(`[bridge:api] POST /v1/sessions/${sessionId}/archive`);

      const response = await withRetry(
        () =>
          withOAuthRetry(
            (token: string) =>
              axios.post(
                `${deps.baseUrl}/v1/sessions/${sessionId}/archive`,
                {},
                {
                  headers: getHeaders(token),
                  timeout: 10_000,
                  validateStatus: (s) => s < 500,
                }
              ),
            'ArchiveSession'
          ),
        'ArchiveSession'
      );

      // 409 = 已经归档（幂等，不是错误）
      if (response.status === 409) {
        debug(
          `[bridge:api] POST /v1/sessions/${sessionId}/archive -> 409 (already archived)`
        );
        return;
      }

      handleErrorStatus(response.status, response.data, 'ArchiveSession');
      debug(
        `[bridge:api] POST /v1/sessions/${sessionId}/archive -> ${response.status}`
      );
    },

    async reconnectSession(
      environmentId: string,
      sessionId: string
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId');
      validateBridgeId(sessionId, 'sessionId');

      debug(
        `[bridge:api] POST /v1/environments/${environmentId}/bridge/reconnect session_id=${sessionId}`
      );

      const response = await withRetry(
        () =>
          withOAuthRetry(
            (token: string) =>
              axios.post(
                `${deps.baseUrl}/v1/environments/${environmentId}/bridge/reconnect`,
                { session_id: sessionId },
                {
                  headers: getHeaders(token),
                  timeout: 10_000,
                  validateStatus: (s) => s < 500,
                }
              ),
            'ReconnectSession'
          ),
        'ReconnectSession'
      );

      handleErrorStatus(response.status, response.data, 'ReconnectSession');
      debug(`[bridge:api] POST .../bridge/reconnect -> ${response.status}`);
    },

    async heartbeatWork(
      environmentId: string,
      workId: string,
      sessionToken: string
    ): Promise<{ lease_extended: boolean; state: string }> {
      validateBridgeId(environmentId, 'environmentId');
      validateBridgeId(workId, 'workId');

      debug(`[bridge:api] POST .../work/${workId}/heartbeat`);

      const response = await withRetry(
        () =>
          axios.post<{
            lease_extended: boolean;
            state: string;
            last_heartbeat: string;
            ttl_seconds: number;
          }>(
            `${deps.baseUrl}/v1/environments/${environmentId}/work/${workId}/heartbeat`,
            {},
            {
              headers: getHeaders(sessionToken),
              timeout: 10_000,
              validateStatus: (s) => s < 500,
            }
          ),
        'Heartbeat'
      );

      handleErrorStatus(response.status, response.data, 'Heartbeat');
      debug(
        `[bridge:api] POST .../work/${workId}/heartbeat -> ${response.status} lease_extended=${response.data.lease_extended} state=${response.data.state}`
      );
      return response.data;
    },

    async sendPermissionResponseEvent(
      sessionId: string,
      event: PermissionResponseEvent,
      sessionToken: string
    ): Promise<void> {
      validateBridgeId(sessionId, 'sessionId');

      debug(
        `[bridge:api] POST /v1/sessions/${sessionId}/events type=${event.type}`
      );

      const response = await withRetry(
        () =>
          axios.post(
            `${deps.baseUrl}/v1/sessions/${sessionId}/events`,
            { events: [event] },
            {
              headers: getHeaders(sessionToken),
              timeout: 10_000,
              validateStatus: (s) => s < 500,
            }
          ),
        'SendPermissionResponseEvent'
      );

      handleErrorStatus(
        response.status,
        response.data,
        'SendPermissionResponseEvent'
      );
      debug(
        `[bridge:api] POST /v1/sessions/${sessionId}/events -> ${response.status}`
      );
    },
  };
}

/**
 * 检查错误类型是否表示会话/环境过期
 */
export function isExpiredErrorType(errorType: string | undefined): boolean {
  if (!errorType) {
    return false;
  }
  return errorType.includes('expired') || errorType.includes('lifetime');
}

/**
 * 检查BridgeFatalError是否是可抑制的403权限错误
 */
export function isSuppressible403(err: BridgeFatalError): boolean {
  if (err.status !== 403) {
    return false;
  }
  return (
    err.message.includes('external_poll_sessions') ||
    err.message.includes('environments:manage')
  );
}
