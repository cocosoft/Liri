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
 * 评测题集入口（D2 第 3 批）
 *
 * - `smoke.ts`：4 条冒烟（含 1 条控制任务，用于判分器自检）
 * - `liri-core.ts`：自研核心链路（含 L2 过程断言）
 *
 * 公开题集（SWE-bench Verified / τ-bench / AgentDojo）需本地下载，按计划另行接入。
 */

import type { EvalTask } from '../types.js';
import { smokeTasks } from './smoke.js';
import { liriCoreTasks } from './liri-core.js';
import { securityTasks } from './security-injection.js';

export const allTasks: EvalTask[] = [
  ...smokeTasks,
  ...liriCoreTasks,
  ...securityTasks,
];
