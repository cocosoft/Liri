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
 * 编排状态快照类型（core 层自持，零依赖）
 *
 * H5-② 收口（台账 D-203，子批 C `infrastructure -> app`）：原定义于
 * `agent/events/OrchestrationEvents.ts`（app 层），而
 * `infrastructure/http/handlers/orchestration-handlers.ts` 需要其**类型位**
 * ⇒ 静态 `import type { OrchestrationSnapshot } from '@modules/agent'`
 * ⇒ `infrastructure -> app` 倒挂（门禁连类型导入也计）。定义下沉至 core 层 types 模块，
 * 由 `agent/events/OrchestrationEvents.ts` **转出**（app → core 合法）。
 *
 * **纯类型、零出向依赖**（仅引用本文件内的 `OrchestrationStatus`）⇒ 满足 types 模块约束。
 */

/** 编排状态枚举 */
export type OrchestrationStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'checking'
  | 'completed'
  | 'failed';

/** 编排状态快照 */
export interface OrchestrationSnapshot {
  /** 工作项 ID */
  workItemId: string;
  /** 编排状态 */
  status: OrchestrationStatus;
  /** 任务进度 */
  tasks: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    dependsOn: string[];
    progress: number;
    result?: string;
    error?: string;
    durationMs?: number;
  }>;
  /** 规则检查结果 */
  ruleChecks: Array<{
    ruleId: string;
    ruleName: string;
    passed: boolean;
    needsReview: boolean;
  }>;
  /** 执行层级 */
  layers: string[][];
  /** 当前层级 */
  currentLayer: number;
  /** 开始时间 */
  startTime: string;
  /** 更新时间 */
  updatedAt: string;
}
