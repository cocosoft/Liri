// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * Login命令
 * 用户登录命令
 * 参考CC源码 cc_code/backend/commands/login/index.ts 实现
 */

import type { Command } from '@modules/commands/types';

/**
 * 检查是否有API Key认证
 */
function hasApiKeyAuth(): boolean {
  return !!process.env.ANTHROPIC_API_KEY || !!process.env.Liri_API_KEY;
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
  description: hasApiKeyAuth() ? '切换Liri账户' : '登录您的Liri账户',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
  load: async () => {
    const { executeLogin } = await import('./login.js');
    return {
      execute: executeLogin,
    };
  },
});
