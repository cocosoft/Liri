/**
 * 工具输出类型（契约落点）
 *
 * 2026-10-19（CI 循环依赖断环）：原定义在 `ClipboardTool.ts` / `ImageTool.ts`，
 * 而 `tools/types/index.ts` 反向重导出它们 ⇒ `BaseTool → types/index → 工具实现 → BaseTool`。
 * 纯类型下沉到契约层后，`tools/types/*` 保持"只转发"（G8 守卫），环消失、零运行时变化。
 */

/** 剪贴板操作结果 */
export interface ClipboardOutput {
  action: 'read' | 'write';
  content: string;
  truncated: boolean;
  length: number;
}

/** 图片编辑结果 */
export interface ImageEditOutput {
  action: string;
  inputPath: string;
  outputPath?: string;
  originalSize?: number;
  processedSize?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  format?: string;
  /** 批量操作结果 */
  batchResults?: ImageEditOutput[];
}
