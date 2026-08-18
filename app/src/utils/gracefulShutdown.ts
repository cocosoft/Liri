/**
 * 优雅关闭工具
 * 处理应用的优雅关闭流程
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('gracefulShutdown');

let shutdownHandlers: any[] = [];
let isShuttingDown = false;

/**
 * 注册关闭处理函数
 * @param {Function} handler - 关闭处理函数
 */
export function registerShutdownHandler(handler: () => void | Promise<void>) {
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
        void handleError(error, {
          module: 'utils:shutdown',
          action: 'handler',
        });
        logger.error('关闭处理函数执行失败:', error as Error);
      }
    }

    logger.info('优雅关闭完成');
  } catch (error) {
    void handleError(error, { module: 'utils:shutdown', action: 'shutdown' });
    logger.error('优雅关闭失败:', error as Error);
  } finally {
    process.exit(0);
  }
}

/**
 * 设置优雅关闭
 *
 * 仅监听 SIGINT / SIGTERM / uncaughtException 触发关闭流程。
 * unhandledRejection 由 main.ts 的全局处理器接管（记录 + crash dump，不退出进程），
 * 避免重复注册导致策略冲突（曾出现 gracefulShutdown 强制 exit 覆盖 main.ts "不退出"策略）。
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

  // 监听未捕获的异常（不可恢复，需关闭进程）
  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常:', error);
    executeShutdownHandlers();
  });

  // 注意：unhandledRejection 不在此注册——由 main.ts 全局处理器接管，
  // 策略为"记录 + 不退出"（unhandledRejection 可能是非致命的，如 Provider 超时）。
}

/**
 * 执行优雅关闭
 */
export async function gracefulShutdown() {
  await executeShutdownHandlers();
}
