/**
 * Native Installer模块
 * 占位符实现
 */

import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('NativeInstaller');

export async function cleanupOldVersions(): Promise<void> {
  logger.info('旧版本清理（占位符）');
}
