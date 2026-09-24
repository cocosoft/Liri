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
 * workflow 模块公共 API（R06-010：外部只经本入口导入）
 */

export { WorkflowEngine } from './WorkflowEngine';
export type { WorkflowProvider } from './WorkflowEngine';
export { WorkflowModule, getWorkflowEngine } from './WorkflowModule';
export { createRunRecordCollector } from './runRecordCollector';
export type { RunRecordCollector } from './runRecordCollector';
export { WorkflowError, isFatalWorkflowError } from './WorkflowError';
export type { WorkflowErrorOptions } from './WorkflowError';
export type {
  WorkflowDefinition,
  WorkflowExecuteOptions,
  WorkflowRunEndInfo,
  WorkflowRunObserver,
  WorkflowRunRecord,
  WorkflowRunResult,
  WorkflowRunStartInfo,
  WorkflowStepEndInfo,
  WorkflowStepEndReport,
  WorkflowStepObserver,
  WorkflowStepOutcome,
  WorkflowStepRecord,
  WorkflowStepReporter,
  WorkflowStepSpec,
  WorkflowStepStartInfo,
  WorkflowStepStartReport,
  WorkflowStopReason,
  WorkflowSummary,
} from './types';
