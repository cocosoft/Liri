/**
 * Bridge API客户端
 * 提供与Bridge服务通信的客户端接口
 */

import axios, { AxiosError } from 'axios';
import {
  type IBridgeApiClient,
  type BridgeApiConfig,
  type BridgeEnvironmentInfo,
  type WorkItem,
  type HeartbeatResult,
  type PermissionEvent,
  type BackoffConfig,
  DEFAULT_BACKOFF_CONFIG,
} from '../types/BridgeApiTypes';

/**
 * Bridge API客户端工厂函数
 */
export function createBridgeApiClient(deps: {
  baseUrl: string;
  getAccessToken: () => string | undefined;
  runnerVersion: string;
  onDebug?: (msg: string) => void;
  onAuth401?: (staleAccessToken: string) => Promise<boolean>;
  getTrustedDeviceToken?: () => string | undefined;
  backoffConfig?: BackoffConfig;
}): IBridgeApiClient {
  const backoffConfig = deps.backoffConfig || DEFAULT_BACKOFF_CONFIG;
  let consecutiveEmptyPolls = 0;
  const EMPTY_POLL_LOG_INTERVAL = 100;

  function debug(msg: string): void {
    deps.onDebug?.(msg);
  }

  function getHeaders(accessToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'environments-2025-11-01',
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
      throw new AppError('Please log in first with `PY_APP login`', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }
    return accessToken;
  }

  async function backoffWait(retryCount: number): Promise<void> {
    const delay = Math.min(
      backoffConfig.initialMs * Math.pow(backoffConfig.multiplier, retryCount),
      backoffConfig.maxMs
    );
    const jitter = Math.random() * 100;
    await new Promise((resolve) => setTimeout(resolve, delay + jitter));
  }

  function shouldRetry(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (!axiosError.response) {
        return true;
      }
      const status = axiosError.response.status;
      return status >= 500 || status === 429;
    }
    return false;
  }

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
          debug(`[bridge:api] ${context}: Max retries exceeded`);
          throw error;
        }
        debug(
          `[bridge:api] ${context}: Retry ${retryCount + 1}/${backoffConfig.maxRetries}`
        );
        await backoffWait(retryCount);
      }
    }
    throw lastError;
  }

  async function withOAuthRetry<T>(
    fn: (token: string) => Promise<{ status: number; data: T }>,
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

    debug(`[bridge:api] ${context}: 401 received, attempting token refresh`);
    const refreshed = await deps.onAuth401(accessToken);
    if (refreshed) {
      debug(`[bridge:api] ${context}: Token refreshed, retrying request`);
      const newToken = resolveAuth();
      const retryResponse = await fn(newToken);
      if (retryResponse.status !== 401) {
        return retryResponse;
      }
    }

    return response;
  }

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
        throw new AppError(
          `${context}: Authentication failed (401)${detail ? `: ${detail}` : ''}`
        , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      case 403:
        throw new AppError(
          `${context}: Access denied (403)${detail ? `: ${detail}` : ''}`
        , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      case 404:
        throw new AppError(
          `${context}: Not found (404)${detail ? `: ${detail}` : ''}`
        , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      case 410:
        throw new AppError(
          `${context}: Resource expired (410)${detail ? `: ${detail}` : ''}`
        , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      case 429:
        throw new AppError(`${context}: Rate limited (429)`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      default:
        throw new AppError(
          `${context}: Failed with status ${status}${detail ? `: ${detail}` : ''}`
        , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }
  }

  function extractErrorDetail(data: unknown): string | undefined {
    if (data && typeof data === 'object') {
      if ('error' in data && data.error) {
        if (typeof data.error === 'string') {
          return data.error;
        } else if (typeof data.error === 'object' && 'message' in data.error) {
          return String((data.error as any).message);
        }
      } else if ('message' in data) {
        return String((data as any).message);
      }
    }
    return undefined;
  }

  function extractErrorTypeFromData(data: unknown): string | undefined {
    if (data && typeof data === 'object') {
      if (
        'error' in data &&
        data.error &&
        typeof data.error === 'object' &&
        'type' in data.error &&
        typeof (data.error as any).type === 'string'
      ) {
        return (data.error as any).type;
      }
    }
    return undefined;
  }

  function validateBridgeId(id: string, label: string): string {
    const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
    if (!id || !SAFE_ID_PATTERN.test(id)) {
      throw new AppError(`Invalid ${label}: contains unsafe characters`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }
    return id;
  }

  return {
    async registerBridgeEnvironment(
      config: BridgeApiConfig
    ): Promise<BridgeEnvironmentInfo> {
      debug(`[bridge:api] POST /v1/environments/bridge`);

      const response = await withRetry(
        () =>
          withOAuthRetry(
            (token: string) =>
              axios.post<BridgeEnvironmentInfo>(
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
      return response.data;
    },

    async pollForWork(
      environmentId: string,
      environmentSecret: string,
      signal?: AbortSignal,
      reclaimOlderThanMs?: number
    ): Promise<WorkItem | null> {
      validateBridgeId(environmentId, 'environmentId');

      const prevEmptyPolls = consecutiveEmptyPolls;
      consecutiveEmptyPolls = 0;

      const response = await withRetry(
        () =>
          axios.get<WorkItem | null>(
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

      if (!response.data) {
        consecutiveEmptyPolls = prevEmptyPolls + 1;
        if (
          consecutiveEmptyPolls === 1 ||
          consecutiveEmptyPolls % EMPTY_POLL_LOG_INTERVAL === 0
        ) {
          debug(
            `[bridge:api] Poll: no work, ${consecutiveEmptyPolls} consecutive empty polls`
          );
        }
        return null;
      }

      debug(
        `[bridge:api] Poll: workId=${response.data.id} type=${response.data.data?.type}`
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
    },

    async stopWork(
      environmentId: string,
      workId: string,
      force: boolean
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId');
      validateBridgeId(workId, 'workId');

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
    },

    async deregisterEnvironment(environmentId: string): Promise<void> {
      validateBridgeId(environmentId, 'environmentId');

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
    },

    async archiveSession(sessionId: string): Promise<void> {
      validateBridgeId(sessionId, 'sessionId');

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

      if (response.status === 409) {
        debug(`[bridge:api] ArchiveSession: already archived`);
        return;
      }

      handleErrorStatus(response.status, response.data, 'ArchiveSession');
    },

    async reconnectSession(
      environmentId: string,
      sessionId: string
    ): Promise<void> {
      validateBridgeId(environmentId, 'environmentId');
      validateBridgeId(sessionId, 'sessionId');

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
    },

    async heartbeatWork(
      environmentId: string,
      workId: string,
      sessionToken: string
    ): Promise<HeartbeatResult> {
      validateBridgeId(environmentId, 'environmentId');
      validateBridgeId(workId, 'workId');

      const response = await withRetry(
        () =>
          axios.post<HeartbeatResult>(
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
      return response.data;
    },

    async sendPermissionResponseEvent(
      sessionId: string,
      event: PermissionEvent,
      sessionToken: string
    ): Promise<void> {
      validateBridgeId(sessionId, 'sessionId');

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
    },
  };
}

/**
 * 导出类型
 */
export type {
  IBridgeApiClient,
  BridgeApiConfig,
  BridgeEnvironmentInfo,
  WorkItem,
  HeartbeatResult,
  PermissionEvent,
  BackoffConfig,
} from '../types/BridgeApiTypes';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
