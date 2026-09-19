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
 * 工作流 seam 的错误类型
 *
 * 语义边界（对齐 deepseek-harness 的 `WorkflowError`）：
 * - `fatal = true`：**约定义/编程错误**（未知步骤依赖、依赖成环、步骤 id 重复、
 *   Provider 重复注册、参数非法）→ 必须向上抛，禁止被降级为空结果。
 * - `fatal = false`：**运行期失败**（步骤执行失败）→ 归入
 *   `WorkflowRunResult.stopReason = 'error'`，不作为异常抛出。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/** 构造选项 */
export interface WorkflowErrorOptions {
  /** 机器可路由的错误码 */
  code?: string;
  /** 是否致命（默认 true：致命错误不得消融为 null/空结果） */
  fatal?: boolean;
  /** 诊断上下文 */
  context?: Record<string, unknown>;
}

/**
 * 工作流错误：唯一入口为 `AppError`（project_rules §1.9）
 */
export class WorkflowError extends AppError {
  /** 是否必须向上抛（禁止降级） */
  readonly fatal: boolean;

  constructor(message: string, options: WorkflowErrorOptions = {}) {
    super(
      message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.HIGH,
      options.code,
      options.context
    );
    this.name = 'WorkflowError';
    this.fatal = options.fatal ?? true;
  }
}

/**
 * 判定是否为"致命"工作流错误。
 *
 * 使用 `instanceof`（进程内不可伪造），供组合逻辑决定是 re-throw 还是降级为运行期错误。
 */
export function isFatalWorkflowError(error: unknown): boolean {
  return error instanceof WorkflowError && error.fatal;
}
