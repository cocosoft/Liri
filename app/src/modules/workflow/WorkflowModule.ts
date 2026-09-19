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
 * workflow 模块主类：持有 seam 单例
 *
 * 本模块只提供契约与注册表，不承载任何具体编排实现；
 * 具体能力由各领域模块（如 doc）以 Provider 形式注册。
 */

import { WorkflowEngine } from './WorkflowEngine';

/** workflow 模块单例 */
let workflowModuleInstance: WorkflowModule | null = null;

export class WorkflowModule {
  /** seam 单例（Provider 注册表） */
  readonly engine = new WorkflowEngine();

  static getInstance(): WorkflowModule {
    if (!workflowModuleInstance) {
      workflowModuleInstance = new WorkflowModule();
    }
    return workflowModuleInstance;
  }
}

/** 获取工作流 seam（消费方唯一入口） */
export function getWorkflowEngine(): WorkflowEngine {
  return WorkflowModule.getInstance().engine;
}
