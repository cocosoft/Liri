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
 * Logout命令
 * 用户登出命令
 * 参考CC源码 cc_code/backend/commands/logout/index.ts 实现
 */

import type { Command } from '@modules/commands';
import { configManager } from '@modules/config';

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
  description: '登出您的Liri账户',
  isEnabled: () => !isEnvTruthy(configManager.env('DISABLE_LOGOUT_COMMAND')),
  load: async () => {
    const { executeLogout } = await import('./logout.js');
    return {
      execute: executeLogout,
    };
  },
};

export default logout;
