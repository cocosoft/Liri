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
 * Bridge 命令模块入口
 * 管理远程控制桥接连接
 */
import type { Command } from '@modules/commands';

const bridgeCommand: Command = {
  type: 'local',
  name: 'bridge',
  description: '管理远程控制桥接连接',
  aliases: ['rc', 'remote-control'],
  argumentHint: '[status|config|start|stop|connect|--json|help]',
  whenToUse: '管理 Bridge 远程控制连接，查看连接状态和配置',
  isHidden: false,
  load: () => import('./Bridge.js').then((m) => m.default),
};

export { bridgeCommand };
export default bridgeCommand;
