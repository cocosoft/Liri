/**
 * Native Installer模块
 * 占位符实现
 */

import { getLogger } from '@modules/monitoring/logs/Logger';

const logger = getLogger('NativeInstaller');

export async function cleanupOldVersions(): Promise<void> {
  logger.info('旧版本清理（占位符）');
}
