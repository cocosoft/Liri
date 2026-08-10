/**
 * 上下文管理
 * 提供系统和用户上下文信息
 */

/**
 * 获取系统上下文
 * @returns {Promise<Object>} 系统上下文信息
 */
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('context:context');

export async function getSystemContext() {
  try {
    // 系统信息
    const systemInfo: Record<string, any> = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cwd: process.cwd(),
      env: Object.keys(process.env).filter(
        (key) =>
          !key.includes('PASSWORD') &&
          !key.includes('TOKEN') &&
          !key.includes('SECRET')
      ),
    };

    // 尝试获取Git信息
    try {
      const { execSync } = await import('child_process');
      const gitBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      const gitCommit = execSync('git rev-parse HEAD', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      systemInfo.git = {
        branch: gitBranch,
        commit: gitCommit,
      };
    } catch (error) {
      // Git信息获取失败，忽略
      await handleError(error, {
        module: 'context:context',
        action: 'git_info',
      });
    }

    return systemInfo;
  } catch (error) {
    await handleError(error, {
      module: 'context:context',
      action: 'system_context',
    });
    return {};
  }
}

/**
 * 获取用户上下文
 * @returns {Promise<Object>} 用户上下文信息
 */
export async function getUserContext() {
  try {
    // 用户信息
    const userInfo = {
      username: process.env.USER || process.env.USERNAME || 'unknown',
      homeDir: process.env.HOME || process.env.USERPROFILE || 'unknown',
      shell: process.env.SHELL || process.env.COMSPEC || 'unknown',
    };

    return userInfo;
  } catch (error) {
    await handleError(error, {
      module: 'context:context',
      action: 'user_context',
    });
    return {};
  }
}
