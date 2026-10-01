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
    }
  ): Promise<void>;

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
