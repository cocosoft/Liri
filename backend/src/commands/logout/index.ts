/**
 * Logout命令
 * 用户登出命令
 * 参考CC源码 cc_code/backend/commands/logout/index.ts 实现
 */

import type { Command } from '../types/index.js';

/**
 * 检查环境变量是否为真值
 */
function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * Logout命令实现
 */
const logout: Command = {
  type: 'local',
  name: 'logout',
  description: '登出您的PY_APP账户',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGOUT_COMMAND),
  load: async () => {
    const { executeLogout } = await import('./logout.js');
    return {
      execute: executeLogout,
    };
  },
};

export default logout;
