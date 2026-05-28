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
 * Model 命令模块入口
 * 设置 AI 模型
 * 对标 CC 源码 cc_code/backend/commands/model/index.ts 实现
 * 使用 ModelManager 作为唯一数据源
 */
import type { Command } from '@modules/commands/types';
import { modelManager } from '@modules/ai/models/ModelManager.js';

const modelCommand: Command = {
  type: 'local',
  name: 'model',
  get description() {
    return `设置 PY_APP 的 AI 模型 (当前: ${modelManager.getCurrentModel()})`;
  },
  aliases: ['models', 'ml', 'list-models'],
  argumentHint: '[model|info|all|--json|help]',
  whenToUse: '当你需要查看或切换 AI 模型时',
  load: () => import('./model.js').then((m) => m.default),
};

export default modelCommand;
export { modelCommand };
