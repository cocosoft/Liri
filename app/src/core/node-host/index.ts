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
import { warnDeprecatedCoreModule } from '../deprecationNotice.js';

/**
 * 节点执行宿主（NodeInvoke / NodeRunner / ExecPolicy）。
 *
 * @deprecated（2026-10-23，C 档观察期）本目录三重零引用（深路径/符号/路径串均为 0）。
 * 其中 `ExecPolicy` 属 CD07 关键域（执行策略），**不得**凭零引用删除。
 * 见 `dev_docs/20261023/core-减重盘点清单.md` §3。
 */
warnDeprecatedCoreModule(
  'node-host',
  '三重零引用；ExecPolicy 属 CD07 关键域，须运行时取证'
);

export { NodeInvoke, nodeInvoke } from './NodeInvoke.js';
export { NodeRunner } from './NodeRunner.js';
export { ExecPolicy, execPolicy } from './ExecPolicy.js';
export type {
  NodeDefinition,
  NodeStatus,
  NodeType,
  InvokeRequest,
  InvokeResponse,
  ExecPolicyConfig,
  NodeSession,
  NodeMetrics,
} from './types.js';
export type { NodeInvokeHandler } from './NodeInvoke.js';
