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
 * Agent 事件名词汇表（core 层自持，零依赖）
 *
 * H5-② 收口（台账 D-203，子批 C `infrastructure -> app`）：原定义于
 * `agent/events/types.ts`（app 层），而 `infrastructure/http/handlers/` 下两个文件
 * （`orchestration-handlers.ts` · `OrchestrationHistoryAdapter.ts`）需要其**枚举值**
 * 作为事件白名单 ⇒ 静态 `import { AgentEventType } from '@modules/agent'`
 * ⇒ `infrastructure -> app` 倒挂。定义下沉至 core 层 types 模块，
 * 由 `agent/events/types.ts` **转出**（app → core 合法，原导入方零改动）。
 *
 * 手法同 D-67（`types/orchestrationEvents.ts`）：**只下沉名字（词汇表），不下沉载荷** ——
 * 事件载荷 `AgentEvent` / `EventHandler` 等仍留在 app 层（core 侧不需要）。
 */

export enum AgentEventType {
  // ========== 回复生命周期 ==========

  /** AI 开始生成回复 */
  REPLY_START = 'agent:reply:start',
  /** AI 回复增量块 */
  REPLY_DELTA = 'agent:reply:delta',
  /** AI 回复结束 */
  REPLY_END = 'agent:reply:end',
  /** AI 回复出错 */
  REPLY_ERROR = 'agent:reply:error',
  /** AI 回复被中断 */
  REPLY_INTERRUPT = 'agent:reply:interrupt',

  // ========== 思考阶段 ==========

  /** Agent 开始思考 */
  THINKING_START = 'agent:thinking:start',
  /** Agent 思考增量 */
  THINKING_DELTA = 'agent:thinking:delta',
  /** Agent 思考结束 */
  THINKING_END = 'agent:thinking:end',

  // ========== 工具调用 ==========

  /** 模型请求工具调用 */
  TOOL_CALLS = 'agent:tool:calls',
  /** 单个工具开始执行 */
  TOOL_CALL_START = 'agent:tool:call:start',
  /** 工具执行增量输出 */
  TOOL_CALL_DELTA = 'agent:tool:call:delta',
  /** 单个工具执行结束 */
  TOOL_CALL_END = 'agent:tool:call:end',
  /** 所有工具结果返回 */
  TOOL_RESULTS = 'agent:tool:results',
  /** 工具执行出错 */
  TOOL_ERROR = 'agent:tool:error',

  // ========== 上下文管理 ==========

  /** 开始上下文压缩 */
  CONTEXT_COMPRESSING = 'agent:context:compressing',
  /** 上下文压缩完成 */
  CONTEXT_COMPRESSED = 'agent:context:compressed',

  // ========== Agent 执行生命周期 ==========

  /** Agent 开始执行任务 */
  EXECUTE_START = 'agent:execute:start',
  /** Agent 任务执行完成 */
  EXECUTE_END = 'agent:execute:end',
  /** Agent 任务执行出错 */
  EXECUTE_ERROR = 'agent:execute:error',

  // ========== 外部执行 ==========

  /** 请求外部执行确认 */
  EXTERNAL_EXECUTION = 'agent:external:execution',
  /** 外部执行结果返回 */
  EXTERNAL_EXECUTION_RESULT = 'agent:external:execution:result',

  // ========== 权限 ==========

  /** 权限检查 */
  PERMISSION_CHECK = 'agent:permission:check',
  /** 权限决策结果 */
  PERMISSION_DECISION = 'agent:permission:decision',

  // ========== 内存与状态 ==========

  /** Agent 状态变更 */
  STATE_CHANGE = 'agent:state:change',
  /** Agent 内存更新 */
  MEMORY_UPDATE = 'agent:memory:update',
}
