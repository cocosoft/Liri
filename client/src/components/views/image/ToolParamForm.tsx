/**
 * ToolParamForm
 * 通用工具参数表单 — 根据工具名动态渲染参数控件（全 i18n）
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface ToolParam {
  name: string;
  type: "string" | "number";
  enum?: string[];
  descriptionKey: string;
  required: boolean;
  default?: unknown;
}

/** 5 个图像工具的参数 schema（仅定义结构和 i18n 键，不包含显示文本） */
const TOOL_SCHEMAS: Record<string, { titleKey: string; params: ToolParam[] }> = {
  image_generate: {
    titleKey: "image.generateImage",
    params: [
      { name: "prompt",          type: "string", descriptionKey: "image.prompt",            required: true },
      { name: "negativePrompt",  type: "string", descriptionKey: "image.negativePrompt",    required: false },
      { name: "size",            type: "string", enum: ["256x256","512x512","1024x1024","1024x1792","1792x1024"], descriptionKey: "image.size",  required: false, default: "1024x1024" },
      { name: "quality",         type: "string", enum: ["standard","hd"],                   descriptionKey: "image.quality",         required: false, default: "standard" },
      { name: "style",           type: "string", enum: ["vivid","natural"],                 descriptionKey: "image.style",           required: false, default: "vivid" },
      { name: "n",               type: "number", descriptionKey: "image.numberOfImages",    required: false, default: 1 },
      { name: "format",          type: "string", enum: ["png","jpeg","webp"],               descriptionKey: "image.outputFormat",    required: false, default: "png" },
    ],
  },
  image_analysis: {
    titleKey: "image.analyzeImage",
    params: [
      { name: "action",          type: "string", enum: ["metadata","colors","content","compare","full","vision","ocr","objects","similarity"], descriptionKey: "image.action", required: true },
      { name: "inputPath",       type: "string", descriptionKey: "image.inputPath",                required: true },
      { name: "samplePrecision", type: "number", descriptionKey: "image.samplePrecision",          required: false, default: 3 },
      { name: "prompt",          type: "string", descriptionKey: "image.visionPrompt",             required: false },
    ],
  },
  image: {
    titleKey: "image.editImage",
    params: [
      { name: "action",        type: "string", enum: ["resize","crop","rotate","flip","watermark","adjust","convert","grayscale","info","batch"], descriptionKey: "image.action", required: true },
      { name: "inputPath",     type: "string", descriptionKey: "image.inputPath",       required: true },
      { name: "width",         type: "number", descriptionKey: "image.targetWidth",      required: false },
      { name: "height",        type: "number", descriptionKey: "image.targetHeight",     required: false },
      { name: "format",        type: "string", enum: ["png","jpeg","webp"],              descriptionKey: "image.outputFormat",      required: false },
      { name: "degrees",       type: "number", descriptionKey: "image.rotationDegrees",  required: false },
      { name: "direction",     type: "string", enum: ["horizontal","vertical","both"],   descriptionKey: "image.flipDirection",     required: false },
      { name: "watermarkText", type: "string", descriptionKey: "image.watermarkText",    required: false },
    ],
  },
  image_svg_generate: {
    titleKey: "image.generateSvg",
    params: [
      { name: "prompt", type: "string", descriptionKey: "image.prompt",  required: true },
      { name: "size",   type: "string", descriptionKey: "image.svgSize", required: false, default: "64x64" },
      { name: "style",  type: "string", enum: ["flat","line","solid","colorful"], descriptionKey: "image.svgStyle",      required: false },
      { name: "color",  type: "string", descriptionKey: "image.primaryColor",    required: false },
    ],
  },
  canvas: {
    titleKey: "image.canvasOp",
    params: [
      { name: "action", type: "string", enum: ["create","draw","text","clear","export"], descriptionKey: "image.action",        required: true },
      { name: "width",  type: "number", descriptionKey: "image.canvasWidth",             required: false, default: 800 },
      { name: "height", type: "number", descriptionKey: "image.canvasHeight",            required: false, default: 600 },
      { name: "format", type: "string", enum: ["png","jpeg","webp","svg"],               descriptionKey: "image.outputFormat",   required: false, default: "png" },
    ],
  },
};

interface Props {
  toolName: string;
  onSubmit: (args: Record<string, unknown>) => void;
  loading?: boolean;
}

export default function ToolParamForm({ toolName, onSubmit, loading }: Props) {
  const { t } = useTranslation();
  const schema = TOOL_SCHEMAS[toolName];
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    if (schema) {
      for (const p of schema.params) {
        if (p.default !== undefined) initial[p.name] = p.default;
      }
    }
    return initial;
  });

  const handleChange = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(values)) {
      if (val !== "" && val !== undefined && val !== null) cleaned[key] = val;
    }
    onSubmit(cleaned);
  };

  if (!schema) {
    return <div className="text-xs text-gray-500">{t("common.error")}</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-sm font-medium text-gray-200">{t(schema.titleKey)}</h3>

      {schema.params.map((param) => {
        const value = values[param.name];

        return (
          <div key={param.name} className="space-y-1">
            <label className="text-[10px] text-gray-400 flex items-center gap-1">
              {t(param.descriptionKey)}
              {param.required && <span className="text-red-500">*</span>}
            </label>

            {param.enum ? (
              <select
                value={String(value ?? param.default ?? "")}
                onChange={(e) => handleChange(param.name, e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
              >
                {param.enum.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : param.type === "number" ? (
              <input
                type="number"
                value={value !== undefined ? String(value) : ""}
                onChange={(e) => handleChange(param.name, e.target.value ? Number(e.target.value) : undefined)}
                placeholder={t(param.descriptionKey)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
              />
            ) : (
              <input
                type="text"
                value={value !== undefined ? String(value) : ""}
                onChange={(e) => handleChange(param.name, e.target.value)}
                placeholder={t(param.descriptionKey)}
                required={param.required}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
              />
            )}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded px-3 py-1.5 text-xs cursor-pointer transition-colors border-0"
      >
        {loading ? t("image.executing") : t("image.run")}
      </button>
    </form>
  );
}
