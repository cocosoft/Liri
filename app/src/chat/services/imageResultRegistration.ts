// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具结果的**图像上下文登记 + 媒体交付事件**（2026-11-17，T3 复杂度清理 stage 7）。
 *
 * 从 `ToolExecutionService._executeInternal` **原样搬出**成功结果的副作用段：
 *  ① 从结果中提取图像路径并登记（供后续 `image` / `image_analysis` 定位）；
 *  ② 更新会话图像上下文；
 *  ③ `glob` / `FileSearch` 的目录清单回填（供路径纠错）；
 *  ④ 媒体交付类工具（或 `create_project`）广播 `tool:completed`（携带 images/resultData）。
 *
 * 语义约定：无结果数据、已有错误或无会话 ⇒ 全部跳过（与原实现一致）。
 */
import { eventNotificationService } from './EventNotificationService.js';
import { isMediaOutputToolName } from '@openliri/infra/utils/toolContract/toolRoles';
import type { ImageContextService } from './ImageContextService.js';

export interface ToolImageResultParams {
  toolCall: { id: string; name: string; sessionId?: string };
  args: Record<string, unknown>;
  resultData: Record<string, unknown> | undefined;
  /** 本段仅在**无错误**时执行（与原 `!error` 判据同口径） */
  hasError: boolean;
  deps: { imageContextService: ImageContextService };
}

export function registerImageToolResults(params: ToolImageResultParams): void {
  const { toolCall, args, resultData, hasError, deps } = params;
  const { imageContextService } = deps;

  if (!resultData || hasError || !toolCall.sessionId) return;

  const extractedPaths = imageContextService.extractImagePathsFromResult(
    toolCall.name,
    resultData
  );
  if (extractedPaths.length > 0) {
    imageContextService.registerImagePaths(toolCall.sessionId, extractedPaths);
  }

  imageContextService.updateImageContext(
    toolCall.sessionId,
    toolCall.name,
    args,
    resultData
  );

  if (
    (toolCall.name === 'glob' || toolCall.name === 'FileSearch') &&
    Array.isArray(resultData) &&
    toolCall.sessionId
  ) {
    const searchPath = (args?.path as string) || process.cwd();
    imageContextService.confirmedPaths.addDirectoryListing(
      searchPath,
      resultData as string[]
    );
  }

  if (
    // A-4（2026-10-18）：媒体交付类工具改走角色集合；`create_project` 是该工具**自身契约**
    // （导航建议 + 会话关联），不属角色判定，保留显式比较。
    isMediaOutputToolName(toolCall.name) ||
    toolCall.name === 'create_project'
  ) {
    eventNotificationService.emitCustomEvent('tool:completed', {
      toolName: toolCall.name,
      sessionId: toolCall.sessionId,
      toolCallId: toolCall.id,
      images: (resultData as Record<string, unknown>).images,
      resultData,
    });
  }
}
