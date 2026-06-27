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
    entry: { name: "image_generate", icon: "🖼", labelKey: "image.generate" },
    schema: {
      titleKey: "image.generateImage",
      params: [
        { name: "prompt", type: "string", descriptionKey: "image.prompt", required: true },
        { name: "negativePrompt", type: "string", descriptionKey: "image.negativePrompt", required: false },
        { name: "size", type: "string", enum: ["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"], descriptionKey: "image.size", required: false, default: "1024x1024" },
        { name: "quality", type: "string", enum: ["standard", "hd"], descriptionKey: "image.quality", required: false, default: "standard" },
        { name: "style", type: "string", enum: ["vivid", "natural"], descriptionKey: "image.style", required: false, default: "vivid" },
        { name: "n", type: "number", descriptionKey: "image.numberOfImages", required: false, default: 1 },
        { name: "format", type: "string", enum: ["png", "jpeg", "webp"], descriptionKey: "image.outputFormat", required: false, default: "png" },
      ],
    },
  },
  image_analysis: {
    entry: { name: "image_analysis", icon: "🔍", labelKey: "image.analyze" },
    schema: {
      titleKey: "image.analyzeImage",
      params: [
        { name: "action", type: "string", enum: ["metadata", "colors", "content", "compare", "full", "vision", "ocr", "objects", "similarity"], descriptionKey: "image.action", required: true },
        { name: "inputPath", type: "string", descriptionKey: "image.inputPath", required: true },
        { name: "samplePrecision", type: "number", descriptionKey: "image.samplePrecision", required: false, default: 3 },
        { name: "prompt", type: "string", descriptionKey: "image.visionPrompt", required: false },
      ],
    },
  },
  image: {
    entry: { name: "image", icon: "✂", labelKey: "image.edit" },
    schema: {
      titleKey: "image.editImage",
      params: [
        { name: "action", type: "string", enum: ["resize", "crop", "rotate", "flip", "watermark", "adjust", "convert", "grayscale", "info", "batch"], descriptionKey: "image.action", required: true },
        { name: "inputPath", type: "string", descriptionKey: "image.inputPath", required: true },
        { name: "width", type: "number", descriptionKey: "image.targetWidth", required: false },
        { name: "height", type: "number", descriptionKey: "image.targetHeight", required: false },
        { name: "format", type: "string", enum: ["png", "jpeg", "webp"], descriptionKey: "image.outputFormat", required: false },
        { name: "degrees", type: "number", descriptionKey: "image.rotationDegrees", required: false },
        { name: "direction", type: "string", enum: ["horizontal", "vertical", "both"], descriptionKey: "image.flipDirection", required: false },
        { name: "watermarkText", type: "string", descriptionKey: "image.watermarkText", required: false },
      ],
    },
  },
  image_svg_generate: {
    entry: { name: "image_svg_generate", icon: "📐", labelKey: "image.svg" },
    schema: {
      titleKey: "image.generateSvg",
      params: [
        { name: "prompt", type: "string", descriptionKey: "image.prompt", required: true },
        { name: "size", type: "string", descriptionKey: "image.svgSize", required: false, default: "64x64" },
        { name: "style", type: "string", enum: ["flat", "line", "solid", "colorful"], descriptionKey: "image.svgStyle", required: false },
        { name: "color", type: "string", descriptionKey: "image.primaryColor", required: false },
      ],
    },
  },
  canvas: {
    entry: { name: "canvas", icon: "🎨", labelKey: "image.canvas" },
    schema: {
      titleKey: "image.canvasOp",
      params: [
        { name: "action", type: "string", enum: ["create", "draw", "text", "clear", "export"], descriptionKey: "image.action", required: true },
        { name: "width", type: "number", descriptionKey: "image.canvasWidth", required: false, default: 800 },
        { name: "height", type: "number", descriptionKey: "image.canvasHeight", required: false, default: 600 },
        { name: "format", type: "string", enum: ["png", "jpeg", "webp", "svg"], descriptionKey: "image.outputFormat", required: false, default: "png" },
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
