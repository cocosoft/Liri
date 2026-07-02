/**
 * 优雅关闭管理器
 * 30 秒超时，完成进行中任务后关闭
 * 对齐 OpenClaw gateway graceful shutdown
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'daemon:gracefulShutdown',
  level: LogLevel.INFO,
});

export interface ShutdownHook {
  name: string;
  priority: number;
  shutdown: () => Promise<void> | void;
}

export interface ShutdownConfig {
  timeoutMs: number;
  signals: NodeJS.Signals[];
}

export class GracefulShutdown {
  private hooks: ShutdownHook[] = [];
  private shuttingDown = false;
  private config: ShutdownConfig;
  private onShutdownComplete?: () => void;

  constructor(config?: Partial<ShutdownConfig>) {
    this.config = {
      timeoutMs: config?.timeoutMs ?? 30000,
      signals: config?.signals ?? ['SIGTERM', 'SIGINT', 'SIGHUP'],
    };
  }

  registerHook(hook: ShutdownHook): void {
    this.hooks.push(hook);
    this.hooks.sort((a, b) => a.priority - b.priority);
    logger.debug(`注册关闭钩子: ${hook.name} (优先级: ${hook.priority})`);
  }

  unregisterHook(name: string): void {
    this.hooks = this.hooks.filter((h) => h.name !== name);
  }

  install(onComplete?: () => void): void {
    this.onShutdownComplete = onComplete;
    for (const signal of this.config.signals) {
      process.once(signal, this.handleShutdown(signal));
      logger.debug(`已注册信号处理: ${signal}`);
    }
    logger.info(`优雅关闭已安装 (超时: ${this.config.timeoutMs}ms)`);
  }

  private handleShutdown = (signal: NodeJS.Signals) => (): void => {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.warning(`收到 ${signal} 信号，开始优雅关闭...`);
    this.executeHooks().finally(() => {
      logger.info('优雅关闭完成');
      if (this.onShutdownComplete) {
        this.onShutdownComplete();
      }
      process.exit(0);
    });
  };

  private async executeHooks(): Promise<void> {
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(
        () => reject(new Error(`关闭超时 (${this.config.timeoutMs}ms)`)),
        this.config.timeoutMs
      );
    });

    try {
      await Promise.race([
        (async () => {
          for (const hook of this.hooks) {
            try {
              logger.info(`执行关闭钩子: ${hook.name}`);
              await hook.shutdown();
              logger.info(`关闭钩子完成: ${hook.name}`);
            } catch (error) {
              logger.error(`关闭钩子失败: ${hook.name}`, error as Error);
            }
          }
        })(),
        timeoutPromise,
      ]);
    } catch (error) {
      logger.warning((error as Error).message);
      logger.info('强制关闭...');
    }
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}

export const gracefulShutdown = new GracefulShutdown();
