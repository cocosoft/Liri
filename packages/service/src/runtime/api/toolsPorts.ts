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
 * 工具运行时 —— **服务层端口**（C1「口径 C」：`tools` 域；2026-09-30 台账 D-93）
 *
 * **为什么需要**：`infrastructure/http/handlers/` 下 **4 个文件**动态导入 app 层 `@modules/tools`
 * （`getVideoTaskPersistence` / `getConverterEngine` / `createVideoGenerateTool` / `VideoGenerateTool`
 * —— `service → app` 跨层引用，仅 `R00-003` 可见），共 **8 个方法面**。按 D-89/D-92 先例：
 * **服务层声明端口（本文件）+ `CoreAPI` 只加 1 个取用方法**（`getToolsPort()`），app 引用内聚 `CoreAPIImpl`。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）。⚠️ `Buffer` 属 Node 内置类型，不在限制内。
 */

/**
 * 视频任务条目（**最小投影 DTO** —— 聚合两处消费方的字段读取面：
 * `video-handlers.ts` 的 12 字段输出映射 + `image-handlers.ts` 的过滤/更新）。
 * 除 `id` 外一律**可选**（原代码对它们均有 `|| null` / 真值判断回退）。
 */
export interface VideoTaskDto {
  /** **必填**：原代码 `persistence.update(task.id, …)` 直接传入、无回退 */
  id: string;
  status?: string | undefined;
  mode?: string | undefined;
  prompt?: string | undefined;
  model?: string | undefined | null;
  sourceImageUrl?: string | undefined | null;
  sourceImagePath?: string | undefined | null;
  resultVideoUrl?: string | undefined | null;
  progress?: unknown;
  createdAt?: unknown;
  completedAt?: unknown | null;
  /** 仅作为 `update` 的 patch 写入，原代码未读取 */
  sourceImageId?: string | undefined;
}

/** 工具运行时端口（8 个方法 = 4 个 handler 文件的**实际调用面**） */
export interface ToolsPort {
  // ---- 视频任务持久化（`getVideoTaskPersistence()`）----
  listVideoTasksBySourceImagePath(imagePath: string): Promise<VideoTaskDto[]>;
  listVideoTasksByStatus(
    statuses: Array<'pending' | 'queued' | 'running' | 'completed'>,
    limit: number
  ): Promise<VideoTaskDto[]>;
  updateVideoTask(
    id: string,
    patch: {
      sourceImageUrl?: string | undefined;
      sourceImageId?: string | undefined;
      /** D-197：`video-task-handlers.ts:101-104` 写入 mode（**联合字面量**，与 `VideoTaskRecord` 对齐） */
      mode?: 'text-to-video' | 'image-to-video' | undefined;
    }
  ): Promise<void>;
  /** D-197：`video-task-handlers.ts:137` 按 id 取任务（无则 null） */
  getVideoTask(id: string): Promise<VideoTaskDto | null>;
  /** D-197：`video-task-handlers.ts:205` 分页列举 */
  listVideoTasks(limit: number): Promise<VideoTaskDto[]>;
  /** D-197：`video-task-handlers.ts:195` 清理过期任务（原调用点即无 `await` ⇒ 同步、fire-and-forget） */
  cleanupStaleTasks(): void;

  // ---- 文档转换引擎（`getConverterEngine()`）----
  /** 探测文件类型（结果作为**不透明句柄**回传给 `convertContent`） */
  detectFileInfo(fileName: string, size: number): Promise<unknown>;
  convertContent(
    fileInfo: unknown,
    buffer: Buffer
  ): Promise<{ markdown: string }>;
  convertFile(filePath: string): Promise<{ markdown: string }>;

  // ---- 视频生成工具（`createVideoGenerateTool()` / `VideoGenerateTool`）----
  /**
   * 异步模式生成视频（原实现传 `async: true` + `{} as unknown as ToolUseContext`，
   * 该 cast 保留在 `CoreAPIImpl` 内 —— 端口不引用 app 的 `ToolUseContext`）。
   */
  executeVideoGenerateTool(args: {
    /**
     * ⚠️ 各字段定 `unknown`：**原 handler 的实参本身就是松散类型**
     * （`prompt` 为 `unknown`、`imageUrl` 等为 `{} | undefined`，直接取自请求体），
     * 且原实现是把它们原样交给 app 侧 `execute()`（其形参同样宽松）⇒ 收窄会**凭空制造**类型错误。
     */
    prompt: unknown;
    imageUrl?: unknown;
    imagePath?: unknown;
    duration?: unknown;
    aspectRatio?: unknown;
    model?: unknown;
  }): Promise<{ data?: unknown }>;
  cancelVideoTask(taskId: string): Promise<void>;

  // ---- 媒体模板（`getMediaTemplates()`；2026-10-01 D-192 tools 域取用面收敛）----
  listMediaTemplates(): Promise<MediaTemplateDto[]>;

  // ---- 工具 schema 刷新（2026-10-01 D-194）----
  /** 刷新「可用子代理类型名」快照并重算工具 schema（原 `agent-role-handlers` 静态导入） */
  refreshAvailableSubagentTypeNames(): Promise<void>;

  // ---- 子代理控制（`agent-control-handlers.ts`；2026-10-01 D-199）----
  /** 原 `getSpawnPauseState()`（同步）。⚠️ 实测返回**不透明状态对象**（原样进 JSON）⇒ `unknown` */
  getSpawnPauseState(): unknown;
  /** 原 `setSpawnPaused(paused, reason?)`（同步；返回值为不透明状态，直接进 JSON） */
  setSpawnPaused(paused: boolean, reason?: string | undefined): unknown;
  /** 原 `getAgentRunStore().listRuns()`（磁盘台账，按 started_at 升序） */
  listAgentRuns(): Promise<AgentRunDto[]>;
  /** 原 `resolveAgentToolInstance()?.getActiveAgents()`（结果直接进 JSON ⇒ 不建 DTO） */
  getActiveAgents(): unknown[];
  /** 原 `resolveAgentToolInstance()?.stopAgent(agentId, { requesterSessionId })`（仅用于判断 ⇒ 不建 DTO） */
  stopAgent(
    agentId: string,
    opts: {
      requesterSessionId?: string | undefined;
      /** O14：未带会话标识时**显式**声明特权（原调用点即传此字段） */
      privileged?: boolean | undefined;
    }
  ): unknown;
  /**
   * Agent 工具是否可用（`resolveAgentToolInstance()` 非 null）。
   * **存在理由**：保留原 `agent-control-handlers` 的 **503 分支**语义 —— 端口若只暴露
   * `stopAgent`，调用方无法区分"工具未注册"与"停止操作本身返回空"，会**悄悄改变** HTTP 语义。
   */
  isAgentToolAvailable(): boolean;
}

/** 子代理运行台账条目（**最小投影 DTO** —— `agent-control-handlers.ts:111-125` 的读取面） */
export interface AgentRunDto {
  /** 以下 5 个字段原代码**无 `?? null` 回退** ⇒ 必填 */
  toolCallId: string;
  agentId: string;
  name: string;
  agentType: string;
  status: string;
  descriptorSource?: unknown;
  batchId?: unknown;
  taskKey?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  error?: unknown;
  attribution?: unknown;
}

/**
 * 媒体模板条目（**最小投影 DTO** —— `media-template-handlers.ts:39-48` 的实际读取面）
 */
export interface MediaTemplateDto {
  templateId: unknown;
  name: unknown;
  type: unknown;
  category: unknown;
  thumbnailUrl: unknown;
  promptTemplate: unknown;
  requiresImage: unknown;
  sortOrder: unknown;
}
