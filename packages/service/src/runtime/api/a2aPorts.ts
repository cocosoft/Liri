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
 * A2A 对外面运行时 —— **服务层端口**（子批 C；2026-10-01 台账 D-204）
 *
 * **为什么需要**：`infrastructure/http/handlers/routes/` 下两个文件
 * （`a2a-routes.ts` · `a2a-delegator.ts`）静态 `import … from '@modules/agent'`
 * （`getAgentRegistry` / `buildAgentCard` / `computeAgentCardEtag` / `a2aTaskStore` /
 * `A2A_PROTOCOL_VERSION`）⇒ `infrastructure -> app` 倒挂（2 条边）。
 *
 * 按 §3.3 ③ 预案新增本端口；协议**类型**另行下沉 core `types/a2a.ts`（D-204）
 * ⇒ 端口可直接引用**真实类型**（core 类型不属"app 类型"，不受端口禁引约束），
 * **零 DTO 复制**。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）；此处只引 core `types/a2a`。
 */

import type {
  A2AAgentCard,
  A2AArtifact,
  A2AMessage,
  A2AStreamResponse,
  A2ATask,
  A2ATaskState,
} from '@modules/types/a2a';

/**
 * Agent Card 发布快照（**最小投影** —— `a2a-routes.ts:handleAgentCard` 的读取面：
 * `card` 进响应、`etag` 进 ETag 头/304 判定、`agentCount` 仅供日志）。
 */
export interface A2ACardSnapshotDto {
  /** Agent Card（对外契约形状，core 类型） */
  card: A2AAgentCard;
  /** 内容 ETag（`If-None-Match` 命中 ⇒ 304） */
  etag: string;
  /** 注册表条目数（仅用于日志，不参与响应） */
  agentCount: number;
}

/**
 * A2A 对外面端口（5 方法 = 2 个 handler 文件的**实际调用面**；实现侧均为**同步**）
 *
 * `buildCard()` 把"取注册表 → `buildAgentCard` → 算 etag"三步**折叠为一个投影方法**
 * （同 D-200 `getRuntimeStatus()` 的口径：一个取用面 ⇒ 一个投影方法）。
 */
export interface A2APort {
  /** 发布 Agent Card：`url` 由调用方按请求推导（`baseUrl`） */
  buildCard(baseUrl: string): A2ACardSnapshotDto;
  /** 按 `agentId` 取该 Agent 的 `systemPrompt`（A2A 委派人格）；未命中 ⇒ `undefined` */
  getAgentSystemPrompt(agentId: string): string | undefined;
  /** 新建任务（`submitted` 态）；返回含 `id` 的完整任务 */
  createTask(): A2ATask;
  /** 标记任务终态/中间态（终态不可改写由实现侧保证并抛错） */
  completeTask(
    taskId: string,
    state: A2ATaskState,
    artifacts: A2AArtifact[],
    message?: A2AMessage
  ): A2ATask;
  /** 按 id 取任务；未知 id ⇒ `undefined`（不跨重启，见 `taskStore` 头注释） */
  getTask(taskId: string): A2ATask | undefined;
  /**
   * 列出全部任务（**插入序**；过滤 / 排序 / 分页由调用方按 A2A §3.1.4 施加）。
   *
   * T4 批次 B 新增（`.trae/specs/a2a-jsonrpc-binding.md`）。
   */
  listTasks(): A2ATask[];
  /**
   * 取消任务（A2A §3.1.5）。**返回结构化结果**（不抛错、不做错误消息匹配 —— CS02）：
   * `not_found` ⇒ JSON-RPC `-32001`；`not_cancelable`（已终态）⇒ `-32002`。
   *
   * T4 批次 B 新增。
   */
  cancelTask(
    taskId: string
  ):
    | { ok: true; task: A2ATask }
    | { ok: false; reason: 'not_found' | 'not_cancelable' };
  /**
   * 订阅任务状态事件（T4 批次 C，SSE 流的唯一事件源）；
   * 返回**幂等**退订函数。无订阅者时任务推进零开销。
   */
  subscribeTask(
    taskId: string,
    listener: (event: A2AStreamResponse) => void
  ): () => void;
}
