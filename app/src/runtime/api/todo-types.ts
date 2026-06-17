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
 * Todo/Task Block 系统类型定义
 *
 * 定义流式 todo chunk 的数据结构，用于三阶段（Planning/Executing/Done）渲染。
 */

/** Todo 任务项 */
export interface TodoTaskItem {
  id: string;
  name: string;
  description?: string;
  status:
    | 'pending'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'blocked'
    | 'skipped';
  dependsOn: string[];
  result?: string;
  durationMs?: number;
  error?: string;
}

/** Todo 块数据（三阶段共享结构） */
export interface TodoBlockData {
  title: string;
  tasks: TodoTaskItem[];
  phase: 'planning' | 'executing' | 'done';
  createdAt: number;
}
