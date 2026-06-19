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
 * Provider 命令入口
 * 管理 AI 供应商（API Provider）
 */

import type { Command } from '@modules/commands';

const providerCommand: Command = {
  type: 'local',
  name: 'provider',
  get description() {
    return '管理 AI 供应商（添加/删除/列表/编辑 API 提供商）';
  },
  aliases: ['providers', 'pv'],
  argumentHint:
    '[list|add|edit|delete|toggle|seed|sync|export|import|test|models|help]',
  whenToUse: '当你需要添加、删除或管理 API 提供商时',
  load: () => import('./provider.js').then((m) => m.default),
};

export default providerCommand;
export { providerCommand };
