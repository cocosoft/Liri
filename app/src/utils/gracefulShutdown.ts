/**
 * 优雅关闭工具
 * 处理应用的优雅关闭流程
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO, module: 'gracefulShutdown' });

let shutdownHandlers: any[] = [];
let isShuttingDown = false;

/**
 * 注册关闭处理函数
 * @param {Function} handler - 关闭处理函数
 */
export function registerShutdownHandler(handler: any) {
  shutdownHandlers.push(handler);
}

/**
 * 执行关闭处理
 */
async function executeShutdownHandlers() {
  if (isShuttingDown) return;

  isShuttingDown = true;
  logger.info('开始优雅关闭...');

  try {
    // 执行所有注册的关闭处理函数
    for (const handler of shutdownHandlers) {
      try {
        await handler();
      } catch (error) {
        logger.error('关闭处理函数执行失败:', error as Error);
      }
    }

    logger.info('优雅关闭完成');
  } catch (error) {
    logger.error('优雅关闭失败:', error as Error);
  } finally {
    process.exit(0);
  }
}

/**
 * 设置优雅关闭
 */
export function setupGracefulShutdown() {
  // 监听SIGINT信号（Ctrl+C）
  process.on('SIGINT', () => {
    logger.info('收到 SIGINT 信号，开始优雅关闭...');
    executeShutdownHandlers();
  });

  // 监听SIGTERM信号
  process.on('SIGTERM', () => {
    logger.info('收到 SIGTERM 信号，开始优雅关闭...');
    executeShutdownHandlers();
  });

  // 监听未捕获的异常
  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常:', error);
    executeShutdownHandlers();
  });

  // 监听未处理的Promise拒绝
  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的Promise拒绝:', reason as Error);
    executeShutdownHandlers();
  });
}

/**
 * 执行优雅关闭
 */
export async function gracefulShutdown() {
  await executeShutdownHandlers();
}
