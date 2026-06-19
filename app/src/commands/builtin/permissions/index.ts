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
 * Permissions命令模块入口
 * 支持快速权限操作、权限模式切换、会话规则管理与细粒度权限控制
 */
import type { Command } from '@modules/commands';

const permissionsCommand: Command = {
  type: 'local',
  name: 'permissions',
  description: '权限管理（权限模式切换、规则管理、细粒度控制）',
  aliases: ['perm', 'auth', 'permission'],
  argumentHint:
    '[list|show|grant|revoke|status|mode|rules|add|remove|resource|role|user|help]',
  load: () => import('./Permissions.js').then((m) => m.default),
};

export { permissionsCommand };
