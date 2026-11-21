// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-media` 公共出口 —— 15 个 media 工具的 creator。
 *
 * 注册动作（`globalToolManager.registerTool`）留在 app 的 `tools/media/MediaModule.ts`：
 * 本包只提供纯对象工具实现，不触碰全局单例与模块生命周期。
 */

export { createImageConvertTool } from './ImageConvertTool';
export { createImageResizeTool } from './ImageResizeTool';
export { createImageCropTool } from './ImageCropTool';
export { createImageRotateTool } from './ImageRotateTool';
export { createImageWatermarkTool } from './ImageWatermarkTool';
export { createImageAdjustTool } from './ImageAdjustTool';
export { createMediaInfoTool } from './MediaInfoTool';
export { createMediaDeleteTool } from './MediaDeleteTool';
export { createMediaDeleteBatchTool } from './MediaDeleteBatchTool';
export { createVideoCompressTool } from './VideoCompressTool';
export { createVideoExtractAudioTool } from './VideoExtractAudioTool';
export { createVideoExtractThumbnailTool } from './VideoExtractThumbnailTool';
export { createQRGenerateTool } from './QRGenerateTool';
export { createQRDecodeTool } from './QRDecodeTool';
export { createPdfExtractTool } from './PdfExtractTool';
