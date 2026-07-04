/**
 * toolRegistry — 图像工具集中注册表
 *
 * 所有工具定义集中于此，ImageToolPanel / ToolParamForm / imageService 只需引用此文件。
 * 添加新工具仅改此处即可。
 */

import type { ToolParam } from "./ToolParamForm";

/** 工具条目（UI 展示用） */
export interface ToolEntry {
  name: string;
  icon: string;
  labelKey: string;
  /** 工具分类 */
  category?: "generate" | "analyze" | "edit" | "other";
  /** 是否禁用（未实现功能） */
  disabled?: boolean;
  /** 禁用原因（悬浮提示） */
  disabledReason?: string;
}

/** 参数 schema（表单渲染用） */
export interface ToolSchema {
  titleKey: string;
  params: ToolParam[];
}

/** 完整的注册表条目 */
export interface ToolRegistration {
  entry: ToolEntry;
  schema: ToolSchema;
}

// ============================================================
// 注册表
// ============================================================

export const TOOL_REGISTRY: Record<string, ToolRegistration> = {
  image_generate: {
    entry: { name: "image_generate", icon: "🖼", labelKey: "image.generate", category: "generate" },
    schema: {
      titleKey: "image.generateImage",
      params: [
        { name: "prompt", type: "string", descriptionKey: "image.prompt", required: true },
        { name: "negativePrompt", type: "string", descriptionKey: "image.negativePrompt", required: false },
        { name: "aspectRatio", type: "string", enum: ["1:1", "4:3", "3:2", "16:9", "21:9"], descriptionKey: "image.aspectRatio", required: false },
        { name: "size", type: "string", descriptionKey: "image.size", required: false, default: "1024x1024" },
        { name: "quality", type: "string", enum: ["standard", "hd"], descriptionKey: "image.quality", required: false, default: "standard" },
        { name: "style", type: "string", enum: ["vivid", "natural"], descriptionKey: "image.style", required: false, default: "vivid" },
        { name: "n", type: "number", descriptionKey: "image.numberOfImages", required: false, default: 1 },
        { name: "format", type: "string", enum: ["png", "jpeg", "webp"], descriptionKey: "image.outputFormat", required: false, default: "png" },
      ],
    },
  },
  image_analysis: {
    entry: { name: "image_analysis", icon: "🔍", labelKey: "image.analyze", category: "analyze" },
    schema: {
      titleKey: "image.analyzeImage",
      params: [
        { name: "action", type: "string", enum: ["metadata", "colors", "content", "compare", "full", "vision", "ocr", "objects", "similarity"], descriptionKey: "image.action", required: true },
        { name: "inputPath", type: "string", descriptionKey: "image.inputPath", required: true },
        { name: "comparePath", type: "string", descriptionKey: "image.comparePath", required: false, dependsOn: { field: "action", value: "compare" } },
        { name: "samplePrecision", type: "number", descriptionKey: "image.samplePrecision", required: false, default: 3 },
        { name: "prompt", type: "string", descriptionKey: "image.visionPrompt", required: false, dependsOn: { field: "action", value: "vision" } },
        { name: "languages", type: "array", descriptionKey: "image.ocrLanguages", required: false, dependsOn: { field: "action", value: "ocr" } },
        { name: "labels", type: "array", descriptionKey: "image.similarityLabels", required: false, dependsOn: { field: "action", value: "similarity" } },
      ],
    },
  },
  image: {
    entry: { name: "image", icon: "✂", labelKey: "image.edit", category: "edit" },
    schema: {
      titleKey: "image.editImage",
      params: [
        { name: "action", type: "string", enum: ["resize", "crop", "rotate", "flip", "watermark", "adjust", "convert", "grayscale", "info", "batch"], descriptionKey: "image.action", required: true },
        { name: "inputPath", type: "string", descriptionKey: "image.inputPath", required: true },
        { name: "outputPath", type: "string", descriptionKey: "image.outputPath", required: false },
        { name: "width", type: "number", descriptionKey: "image.targetWidth", required: false, dependsOn: { field: "action", value: "resize" } },
        { name: "height", type: "number", descriptionKey: "image.targetHeight", required: false, dependsOn: { field: "action", value: "resize" } },
        { name: "cropX", type: "number", descriptionKey: "image.cropX", required: false, dependsOn: { field: "action", value: "crop" } },
        { name: "cropY", type: "number", descriptionKey: "image.cropY", required: false, dependsOn: { field: "action", value: "crop" } },
        { name: "format", type: "string", enum: ["png", "jpeg", "webp"], descriptionKey: "image.outputFormat", required: false },
        { name: "quality", type: "number", descriptionKey: "image.quality", required: false, default: 90 },
        { name: "degrees", type: "number", descriptionKey: "image.rotationDegrees", required: false, dependsOn: { field: "action", value: "rotate" } },
        { name: "direction", type: "string", enum: ["horizontal", "vertical", "both"], descriptionKey: "image.flipDirection", required: false, dependsOn: { field: "action", value: "flip" } },
        { name: "watermarkText", type: "string", descriptionKey: "image.watermarkText", required: false, dependsOn: { field: "action", value: "watermark" } },
        { name: "watermarkPosition", type: "string", enum: ["center", "topLeft", "topRight", "bottomLeft", "bottomRight"], descriptionKey: "image.watermarkPosition", required: false, dependsOn: { field: "action", value: "watermark" } },
        { name: "brightness", type: "number", descriptionKey: "image.brightness", required: false, dependsOn: { field: "action", value: "adjust" } },
        { name: "contrast", type: "number", descriptionKey: "image.contrast", required: false, dependsOn: { field: "action", value: "adjust" } },
        { name: "saturation", type: "number", descriptionKey: "image.saturation", required: false, dependsOn: { field: "action", value: "adjust" } },
        { name: "operations", type: "array", descriptionKey: "image.batchOperations", required: false, dependsOn: { field: "action", value: "batch" } },
      ],
    },
  },
  image_svg_generate: {
    entry: { name: "image_svg_generate", icon: "📐", labelKey: "image.svg", category: "generate" },
    schema: {
      titleKey: "image.generateSvg",
      params: [
        { name: "prompt", type: "string", descriptionKey: "image.prompt", required: true },
        { name: "size", type: "string", descriptionKey: "image.svgSize", required: false, default: "64x64" },
        { name: "style", type: "string", enum: ["flat", "line", "solid", "colorful"], descriptionKey: "image.svgStyle", required: false },
        { name: "color", type: "string", descriptionKey: "image.primaryColor", required: false },
        { name: "backgroundColor", type: "string", descriptionKey: "image.backgroundColor", required: false },
        { name: "savePath", type: "string", descriptionKey: "image.savePath", required: false },
        { name: "validate", type: "boolean", descriptionKey: "image.validateSvg", required: false, default: false },
      ],
    },
  },
  canvas: {
    entry: { name: "canvas", icon: "🎨", labelKey: "image.canvas", category: "other" },
    schema: {
      titleKey: "image.canvasOp",
      params: [
        { name: "action", type: "string", enum: ["create", "draw", "text", "clear", "export"], descriptionKey: "image.action", required: true },
        { name: "canvasId", type: "string", descriptionKey: "image.canvasId", required: false },
        { name: "width", type: "number", descriptionKey: "image.canvasWidth", required: false, default: 800 },
        { name: "height", type: "number", descriptionKey: "image.canvasHeight", required: false, default: 600 },
        { name: "backgroundColor", type: "string", descriptionKey: "image.backgroundColor", required: false, default: "#ffffff" },
        { name: "format", type: "string", enum: ["png", "jpeg", "webp", "svg"], descriptionKey: "image.outputFormat", required: false, default: "png" },
        { name: "quality", type: "number", descriptionKey: "image.qualityRange", required: false, default: 90 },
      ],
    },
  },
};

/** 工具名列表（供枚举遍历） */
export const TOOL_NAMES = Object.keys(TOOL_REGISTRY) as readonly string[];

/** 工具入口列表（供 UI 渲染） */
export const TOOL_ENTRIES = Object.values(TOOL_REGISTRY).map((r) => r.entry);

/** 按名称获取 schema */
export function getToolSchema(name: string): ToolSchema | null {
  return TOOL_REGISTRY[name]?.schema ?? null;
}

// ============================================================
// 工具名 → 结果渲染类型映射（供 ImagePage 和 ImageToolResult 使用）
// ============================================================

/** 工具结果渲染类型 */
export type ToolResultType =
  | "gallery_images"   // 需要注入图库的图片列表（image_generate）
  | "gallery_svg"      // SVG 转 data URL 注入图库（image_svg_generate）
  | "analysis"         // 分析结果文本（image_analysis）
  | "edit_preview"     // 编辑预览图（image）
  | "canvas"           // 画布（未实现）
  | "unknown";         // 兜底

/** 工具 → 结果类型映射 */
export const TOOL_RESULT_TYPE_MAP: Record<string, ToolResultType> = {
  image_generate: "gallery_images",
  image_analysis: "analysis",
  image: "edit_preview",
  image_svg_generate: "gallery_svg",
  canvas: "canvas",
};
