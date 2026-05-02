/**
 * Login命令
 * 用户登录命令
 * 参考CC源码 cc_code/backend/commands/login/index.ts 实现
 */

import type { Command } from '../types/index.js';

/**
 * 检查是否有API Key认证
 */
function hasApiKeyAuth(): boolean {
  return !!process.env.ANTHROPIC_API_KEY || !!process.env.PY_APP_API_KEY;
}

/**
 * 检查环境变量是否为真值
 */
function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * Login命令实现
 */
export default (): Command => ({
  type: 'local',
  name: 'login',
  description: hasApiKeyAuth()
    ? '切换PY_APP账户'
    : '登录您的PY_APP账户',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
  load: async () => {
    const { executeLogin } = await import('./login.js');
    return {
      execute: executeLogin,
    };
  },
});
