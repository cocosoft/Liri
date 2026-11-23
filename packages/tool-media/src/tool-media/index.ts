// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-media` 公共出口 —— media 域工具。
 *
 * - 15 个 `media_*` 纯对象工具（image / video / qr / pdf + 删除）；
 * - A 档（2026-11-22）由 app 迁入的模型面媒体工具：`image` / `image_svg` /
 *   `image_generate` / `image_analysis` / `video` / `video_analysis` /
 *   `video_generate` / `music` / `music_generate` / `tts` / `voice_input` /
 *   `voice_output` / `audio_play` / `image_display` / `video_display`。
 *
 * 注册动作（`globalToolManager.registerTool`）留在 app 的 `tools/media/MediaModule.ts`：
 * 本包只提供工具实现，不触碰全局单例与模块生命周期。
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

// ── A 档（2026-11-22）：模型面媒体编辑 / 分析工具（由 app 迁入） ──
export { MusicTool, createMusicTool } from './MusicTool';
export { VideoTool, createVideoTool } from './VideoTool';
export { VideoAnalysisTool } from './VideoAnalysisTool';
export {
  MusicGenerateTool,
  createMusicGenerateTool,
} from './MusicGenerateTool';
export { ImageTool } from './ImageTool';
export { ImageSvgTool } from './ImageSvgTool';
export { TTSTool, createTTSTool } from './TTSTool';
export {
  VoiceInputTool,
  voiceInputTool,
} from './VoiceInputTool/VoiceInputTool';
export { VoiceInputOutputSchema } from './VoiceInputTool/schemas';
export {
  VoiceOutputTool,
  voiceOutputTool,
} from './VoiceOutputTool/VoiceOutputTool';
export {
  VoiceOutputOutputSchema,
  VoiceOutputOutputJsonSchema,
} from './VoiceOutputTool/schemas';
export { AudioPlayTool } from './AudioPlayTool';
export { ImageDisplayTool } from './ImageDisplayTool';
export { VideoDisplayTool } from './VideoDisplayTool';
export { CanvasTool, createCanvasTool } from './CanvasTool';
export type { CanvasOperation, CanvasResult } from './CanvasTool';
export { ImageAnalysisTool } from './ImageAnalysisTool';
export { ImageGenerateTool } from './ImageGenerateTool/ImageGenerateTool';
export {
  VideoGenerateTool,
  createVideoGenerateTool,
} from './VideoGenerateTool/VideoGenerateTool';
export { getVideoTaskPersistence } from './VideoGenerateTool/VideoTaskPersistence';
export { getMediaTemplates } from './VideoGenerateTool/MediaTemplates';
