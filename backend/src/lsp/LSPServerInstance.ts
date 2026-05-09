//
import { pathToFileURL } from 'url';
import * as path from 'path';

import type { LspServerState, ScopedLspServerConfig } from './types.js';

const LSP_ERROR_CONTENT_MODIFIED = -32801;
const MAX_RETRIES_FOR_TRANSIENT_ERRORS = 3;
const RETRY_BASE_DELAY_MS = 500;

export type LSPServerInstance = {
  readonly name: string;
  readonly config: ScopedLspServerConfig;
  readonly state: LspServerState;
  readonly startTime: Date | undefined;
  readonly lastError: Error | undefined;
  readonly restartCount: number;

  start(workspaceFolder?: string): Promise<void>;
  stop(): Promise<void>;
  restart(workspaceFolder?: string): Promise<void>;
  isHealthy(): boolean;
  sendRequest<T>(method: string, params: unknown): Promise<T>;
  sendNotification(method: string, params: unknown): Promise<void>;
  onNotification(method: string, handler: (params: unknown) => void): void;
  onRequest<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>
  ): void;
};

export function createLSPServerInstance(
  name: string,
  config: ScopedLspServerConfig
): LSPServerInstance {
  const { createLSPClient } = require('./LSPClient.js') as {
    createLSPClient: typeof import('./LSPClient.js').createLSPClient;
  };

  let state: LspServerState = 'stopped';
  let startTime: Date | undefined;
  let lastError: Error | undefined;
  let restartCount = 0;
  let crashRecoveryCount = 0;
  let client: ReturnType<typeof createLSPClient> | undefined;

  function recreateClient(): void {
    client = createLSPClient(name, (error: Error) => {
      state = 'error';
      lastError = error;
      crashRecoveryCount++;
    });
  }

  recreateClient();

  async function start(workspaceFolder?: string): Promise<void> {
    if (state === 'running' || state === 'starting') return;

    const maxRestarts = config.maxRestarts ?? 3;
    if (state === 'error' && crashRecoveryCount > maxRestarts) {
      const error = new Error(
        `LSP server '${name}' exceeded max crash recovery attempts (${maxRestarts})`
      );
      lastError = error;
      throw error;
    }

    try {
      state = 'starting';

      if (!client) recreateClient();

      await client!.start(config.command, config.args || [], {
        env: config.env,
        cwd: workspaceFolder,
      });

      const wsFolder = workspaceFolder || process.cwd();
      const wsUri = pathToFileURL(wsFolder).href;

      await client!.initialize(wsUri, wsFolder);

      state = 'running';
      startTime = new Date();
      restartCount++;
      crashRecoveryCount = 0;
      lastError = undefined;
    } catch (error) {
      state = 'error';
      lastError = error instanceof Error ? error : new Error(String(error));
      throw lastError;
    }
  }

  async function stop(): Promise<void> {
    if (state === 'stopped') return;

    const prevState = state;
    state = 'stopping';

    try {
      if (client) {
        await client.stop();
      }
    } catch {
      // Errors during stop are ignored
    }

    client = undefined;
    recreateClient();
    state = 'stopped';
    startTime = undefined;
  }

  async function restart(workspaceFolder?: string): Promise<void> {
    await stop();
    await start(workspaceFolder);
  }

  function isHealthy(): boolean {
    return state === 'running' && client?.isInitialized === true;
  }

  async function sendRequest<T>(method: string, params: unknown): Promise<T> {
    if (!client || state !== 'running') {
      throw new Error(`LSP server '${name}' is not running (state: ${state})`);
    }

    let lastError: Error | undefined;

    for (
      let attempt = 0;
      attempt <= MAX_RETRIES_FOR_TRANSIENT_ERRORS;
      attempt++
    ) {
      try {
        const result = await (client as any).sendRequest(method, params);
        return result as T;
      } catch (error) {
        const err = error as Error & { code?: number };
        if (
          err.code === LSP_ERROR_CONTENT_MODIFIED &&
          attempt < MAX_RETRIES_FOR_TRANSIENT_ERRORS
        ) {
          lastError = err;
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }

    throw (
      lastError ||
      new Error(
        `Request failed after ${MAX_RETRIES_FOR_TRANSIENT_ERRORS} retries`
      )
    );
  }

  function sendNotification(method: string, params: unknown): Promise<void> {
    if (!client || state !== 'running') {
      return Promise.reject(
        new Error(`LSP server '${name}' is not running (state: ${state})`)
      );
    }
    return (client as any).sendNotification(method, params);
  }

  function onNotification(
    method: string,
    handler: (params: unknown) => void
  ): void {
    if (client) {
      client.onNotification(method, handler);
    }
  }

  function onRequest<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>
  ): void {
    if (client) {
      client.onRequest(method, handler as (params: unknown) => unknown);
    }
  }

  return {
    get name(): string {
      return name;
    },
    get config(): ScopedLspServerConfig {
      return config;
    },
    get state(): LspServerState {
      return state;
    },
    get startTime(): Date | undefined {
      return startTime;
    },
    get lastError(): Error | undefined {
      return lastError;
    },
    get restartCount(): number {
      return restartCount;
    },
    start,
    stop,
    restart,
    isHealthy,
    sendRequest,
    sendNotification,
    onNotification,
    onRequest,
  };
}
