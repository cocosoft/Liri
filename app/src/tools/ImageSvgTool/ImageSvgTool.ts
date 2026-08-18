/**
 * ImageSvgTool
 * 通过 LLM 生成 SVG 矢量图 + 语法校验
 * 适用于图标、流程图、图表、UI 元素等场景
 * 比调用 DALL-E 等图片 API 更经济（仅消耗文本 token）
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import aiService from '../../ai/index';
import type { AIMessage } from '../../ai/models/types';
import { AIMessageRole } from '../../ai/models/types';
import { modelManager } from '../../ai/models/ModelManager.js';
import fs from 'fs';
import path from 'path';
import { resolveOutputDir, resolveDownloadsDir } from '@modules/core/paths';
import { sanitizeFileName } from '@modules/services/file/fileNaming';

const logger = getLogger('tools:imageSvg');

export interface ImageSvgInput {
  /** SVG 内容描述 */
  prompt: string;
  /** 保存路径（可选），不指定则仅返回代码 */
  savePath?: string;
  /** SVG viewBox 尺寸，如 "64x64"、"24x24"，默认 "64x64" */
  size?: string;
  /** 视觉风格：flat / line / solid / colorful */
  style?: string;
  /** 主色，如 "#4A90D9" */
  color?: string;
  /** 背景色（可选） */
  backgroundColor?: string;
  /** 使用的模型（可选） */
  model?: string;
  /** 是否进行 SVG 语法校验（默认 true） */
  validate?: boolean;
}

export interface ImageSvgOutput {
  /** SVG 代码 */
  svg: string;
  /** 保存文件路径（仅当指定了 savePath 时） */
  filePath?: string;
  /** 使用的模型 */
  model: string;
  /** SVG 尺寸 */
  size: string;
  /** 校验结果 */
  validation?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

const DEFAULT_SYSTEM_PROMPT = `你是一个 SVG 代码生成专家。根据用户的描述生成简洁、语义化的 SVG 代码。

规则：
1. 只输出纯 SVG 代码，不要包含 \`\`\`svg ... \`\`\` 或 \`\`\`xml ... \`\`\` 等标记块
2. SVG 代码必须以 <svg 开头，以 </svg> 结尾
3. 使用语义化的 SVG 元素（path、circle、rect、g 等）
4. 遵循用户指定的尺寸（viewBox）、风格、颜色
5. 代码要简洁高效，避免冗余
6. 图标应居中对齐，合理利用 viewBox 空间
7. 对于复杂图形，尽量使用 path 组合而非多个零散元素
8. 输出内容必须是一个可独立渲染的完整 SVG 文档`;

/**
 * SVG 模板库：常用图形模板
 */
const SVG_TEMPLATES: Record<string, string> = {
  /** 向右箭头 */
  arrow_right: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 12h16M14 6l6 6-6 6" stroke="{color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
  /** 流程图矩形节点 */
  flow_rect: `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="120" height="60" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="2"/>
  <text x="60" y="34" text-anchor="middle" font-size="14" font-family="sans-serif" fill="{textColor}">{text}</text>
</svg>`,
  /** 流程图菱形节点 */
  flow_diamond: `<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
  <polygon points="60,0 120,40 60,80 0,40" fill="{fill}" stroke="{stroke}" stroke-width="2"/>
  <text x="60" y="44" text-anchor="middle" font-size="14" font-family="sans-serif" fill="{textColor}">{text}</text>
</svg>`,
  /** 柱状图基架 */
  bar_chart: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
  <line x1="40" y1="160" x2="380" y2="160" stroke="#333" stroke-width="2"/>
  <line x1="40" y1="10" x2="40" y2="160" stroke="#333" stroke-width="2"/>
</svg>`,
  /** 折线图基架 */
  line_chart: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
  <line x1="40" y1="160" x2="380" y2="160" stroke="#ccc" stroke-width="1"/>
  <line x1="40" y1="10" x2="40" y2="160" stroke="#ccc" stroke-width="1"/>
</svg>`,
};

export class ImageSvgTool extends BaseTool<ImageSvgInput, ImageSvgOutput> {
  name = 'image_svg_generate';

  description =
    'Generate SVG vector graphics using LLM. Use when the user asks for icons, ' +
    'diagrams, logos, charts, UI elements, or simple illustrations. Supports ' +
    'multiple visual styles (flat, line, solid, colorful), custom colors, and ' +
    'background colors. Includes SVG syntax validation. Much cheaper than image ' +
    'generation APIs (text tokens only).';

  params: ToolParam[] = [
    {
      name: 'prompt',
      type: 'string',
      description: 'Description of the SVG graphic to generate',
      required: true,
    },
    {
      name: 'savePath',
      type: 'string',
      description:
        'File path to save the SVG. If not provided, only returns the code.',
      required: false,
    },
    {
      name: 'size',
      type: 'string',
      description: 'SVG viewBox size, e.g. "64x64", "24x24". Default: "64x64"',
      required: false,
      default: '64x64',
    },
    {
      name: 'style',
      type: 'string',
      enum: ['flat', 'line', 'solid', 'colorful'],
      description: 'Visual style: flat, line, solid, or colorful',
      required: false,
    },
    {
      name: 'color',
      type: 'string',
      description: 'Primary color, e.g. "#4A90D9"',
      required: false,
    },
    {
      name: 'backgroundColor',
      type: 'string',
      description: 'Background color, e.g. "#F0F0F0" or "transparent"',
      required: false,
    },
    {
      name: 'model',
      type: 'string',
      description: 'LLM model to use for SVG generation',
      required: false,
    },
    {
      name: 'validate',
      type: 'boolean',
      description: 'Enable SVG syntax validation (default true)',
      required: false,
      default: true,
    },
  ];

  async execute(
    input: ImageSvgInput,
    _context: ToolUseContext
  ): Promise<ToolResult<ImageSvgOutput>> {
    const size = input.size ?? '64x64';
    const [width, height] = size.split('x').map(Number);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      return {
        success: false,
        error: `Invalid size: "${input.size}". Expected format: WxH (e.g. "256x256")`,
      };
    }

    const styleHint = input.style ? `风格：${input.style}。` : '';
    const colorHint = input.color ? `主色：${input.color}。` : '';
    const bgHint = input.backgroundColor
      ? `背景色：${input.backgroundColor}。`
      : '';

    const userPrompt = `生成一个 ${size}（viewBox="0 0 ${width} ${height}"）的 SVG。${styleHint}${colorHint}${bgHint}描述：${input.prompt}`;

    const messages: AIMessage[] = [
      { role: AIMessageRole.SYSTEM, content: DEFAULT_SYSTEM_PROMPT },
      { role: AIMessageRole.USER, content: userPrompt },
    ];

    const startTime = Date.now();

    try {
      logger.info('ImageSvgTool · 开始生成 SVG', {
        prompt: input.prompt.slice(0, 80),
        size,
        style: input.style,
      });

      // SVG 生成是文本 LLM 任务（LLM 输出 SVG 代码），不需要 image_generation 能力。
      // 校验仅排除 embedding/reranker 等非文本模型，避免把可用的 chat 模型误判回退。
      // 回退时按 chat 任务路由解析（复用 modelRouter），而非空模型走全局默认 Provider
      // fallback（可能解析到 reranker 等模型导致 400）。
      const NON_TEXT_CAPS = [
        'image_generation',
        'video_generation',
        'embedding',
        'text_to_speech',
        'speech_recognition',
        'reranking',
        'moderation',
        'image_editing',
      ];
      let model: string | undefined = input.model;
      let modelFallbackNote = '';
      try {
        if (model) {
          const cfg = modelManager.getModelRegistry().getModel(model);
          const isTextModel = (cfg?.capabilities ?? []).some(
            (c) => !NON_TEXT_CAPS.includes(c)
          );
          if (!isTextModel) {
            logger.warn(
              'ImageSvgTool · 指定模型为非文本模型，回退 chat 任务模型',
              { model, capabilities: cfg?.capabilities ?? [] }
            );
            // 在工具结果中明确提示，避免 AI 误以为指定模型生效
            modelFallbackNote = `（指定模型 "${model}" 为非文本模型，已回退 chat 任务模型）`;
            model = undefined;
          }
        }
        if (!model) {
          const { modelRouter } = await import('../../ai/modelRouter');
          // 用 default 任务（当前指向可用文本模型 deepseek-v4-flash），
          // chat 任务可能指向 enabled=0 的模型
          const routed = await modelRouter.resolveAsync('default');
          if (routed) {
            model = routed;
            modelFallbackNote = `（已按 default 任务路由到模型 "${routed}"）`;
          }
        }
      } catch {
        // @ignore-catch 模型校验/路由失败时保持空模型，由 Provider 默认路径处理
        model = undefined;
      }

      const response = await aiService.generate(messages, model);
      const elapsed = Date.now() - startTime;
      const rawContent = response.content.trim();
      const svgCode = this.extractSvg(rawContent);

      if (!svgCode) {
        logger.warn('ImageSvgTool · 未生成有效 SVG 代码', {
          rawContent: rawContent.slice(0, 200),
        });
        return {
          success: false,
          error: 'LLM 未能生成有效的 SVG 代码。请尝试更明确的描述。',
          output: `原始响应：${rawContent.substring(0, 500)}`,
        };
      }

      // SVG 语法校验
      const shouldValidate = input.validate !== false;
      const validation = shouldValidate ? this.validateSvg(svgCode) : undefined;

      if (validation && !validation.valid) {
        logger.warn('ImageSvgTool · SVG 校验发现问题', {
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }

      let filePath: string | undefined;

      if (input.savePath) {
        // 路径安全检查 + 文件名清理
        // 1. 相对路径默认基于 output 目录解析
        // 2. 绝对路径必须在 output 或 downloads 目录下
        // 3. 对文件名部分调用 sanitizeFileName 清理非法字符（含全角符号）
        const outputDir = resolveOutputDir();
        const downloadsDir = resolveDownloadsDir();

        const resolvedPath = path.isAbsolute(input.savePath)
          ? path.resolve(input.savePath)
          : path.resolve(outputDir, input.savePath);

        // 路径白名单检查：只允许保存到 output 或 downloads 目录
        // 使用 path.sep 分隔符避免前缀误匹配（如 /a/output 误匹配 /a/output2）
        const isInsideAllowed =
          resolvedPath === outputDir ||
          resolvedPath === downloadsDir ||
          resolvedPath.startsWith(outputDir + path.sep) ||
          resolvedPath.startsWith(downloadsDir + path.sep);

        if (!isInsideAllowed) {
          logger.warn('ImageSvgTool · 拒绝非白名单路径', {
            savePath: input.savePath,
            resolvedPath,
            outputDir,
            downloadsDir,
          });
          return {
            success: false,
            error: `保存路径必须在 output 或 downloads 目录下，当前路径不在允许范围: ${resolvedPath}`,
          };
        }

        // 对文件名部分做清理（保留目录结构）
        const parsedPath = path.parse(resolvedPath);
        const safeName = sanitizeFileName(parsedPath.name);
        const safeExt =
          parsedPath.ext === '.svg' ? '.svg' : parsedPath.ext || '.svg';
        filePath = path.join(parsedPath.dir, safeName + safeExt);
        if (!filePath.endsWith('.svg')) {
          filePath = filePath + '.svg';
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, svgCode, 'utf-8');
      }

      logger.info('ImageSvgTool · SVG 生成完成', {
        elapsed,
        hasFile: !!filePath,
        size,
        valid: validation?.valid,
      });

      return {
        success: true,
        data: {
          svg: svgCode,
          filePath,
          model: response.model || 'default',
          size,
          validation,
        },
        output: `${
          filePath
            ? `已生成 SVG 文件：${filePath}\n\n\`\`\`svg\n${svgCode}\n\`\`\``
            : `\`\`\`svg\n${svgCode}\n\`\`\``
        }${modelFallbackNote}`,
      };
    } catch (error) {
      await handleError(error, {
        module: 'tools:imageSvg',
        action: 'generate',
      });
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `SVG 生成失败：${errorMsg}` };
    }
  }

  /**
   * 从 LLM 响应中提取纯 SVG 代码
   * 处理各种可能的包裹格式（markdown 代码块、xml 代码块、纯文本等）
   */
  private extractSvg(content: string): string | null {
    let svg = content;

    // 尝试提取 markdown 代码块中的 SVG
    const svgBlockMatch = svg.match(/```svg\n?([\s\S]*?)```/);
    if (svgBlockMatch) {
      svg = svgBlockMatch[1].trim();
    } else {
      const xmlBlockMatch = svg.match(/```xml\n?([\s\S]*?)```/);
      if (xmlBlockMatch) {
        svg = xmlBlockMatch[1].trim();
      } else {
        const genericBlockMatch = svg.match(/```\n?([\s\S]*?)```/);
        if (genericBlockMatch) {
          svg = genericBlockMatch[1].trim();
        }
      }
    }

    // 验证是否包含有效的 <svg> 标签
    if (/<svg[\s\S]*?<\/svg>/i.test(svg)) {
      const match = svg.match(/<svg[\s\S]*?<\/svg>/i);
      if (match) return match[0];
    }

    // 如果没有任何包裹格式，但内容以 <svg 开头，直接返回
    if (svg.startsWith('<svg')) return svg;

    return null;
  }

  /**
   * SVG 语法校验
   * 进行基础的结构性检查，不依赖外部库
   */
  private validateSvg(svgCode: string): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. 检查是否有 <svg> 根元素
    if (!/<svg[\s\S]*?<\/svg>/i.test(svgCode)) {
      errors.push('缺少 <svg> 根元素或未正确闭合');
      return { valid: false, errors, warnings };
    }

    // 2. 检查 viewBox 属性
    if (!/viewBox\s*=/i.test(svgCode)) {
      warnings.push('缺少 viewBox 属性，SVG 可能无法正确缩放');
    }

    // 3. 检查 xmlns 命名空间
    if (!/xmlns\s*=/i.test(svgCode)) {
      warnings.push('缺少 xmlns 命名空间声明');
    }

    // 4. 检查基本标签闭合（简单计数）
    const openTags = svgCode.match(/<(?!!)(\w+)[\s>]/g) || [];
    const closeTags = svgCode.match(/<\/\w+>/g) || [];
    const selfCloseTags = svgCode.match(/<(\w+)[^>]*\/>/g) || [];

    const selfClosingSet = new Set([
      'path',
      'circle',
      'rect',
      'line',
      'ellipse',
      'polygon',
      'polyline',
      'image',
      'use',
      'stop',
      'animate',
      'animateTransform',
    ]);

    const openCount = new Map<string, number>();
    const closeCount = new Map<string, number>();

    for (const tag of openTags) {
      const name = tag.match(/<(\w+)/)?.[1];
      if (name && !selfClosingSet.has(name)) {
        openCount.set(name, (openCount.get(name) || 0) + 1);
      }
    }

    for (const tag of closeTags) {
      const name = tag.match(/<\/(\w+)>/)?.[1];
      if (name) {
        closeCount.set(name, (closeCount.get(name) || 0) + 1);
      }
    }

    for (const [name, count] of openCount) {
      const closed = closeCount.get(name) || 0;
      if (count !== closed) {
        warnings.push(`标签 <${name}> 打开 ${count} 次，关闭 ${closed} 次`);
      }
    }

    // 5. 检查是否注入了不安全的脚本
    if (/<script/i.test(svgCode)) {
      errors.push('SVG 包含 <script> 标签，已拒绝');
    }
    if (/on\w+\s*=/i.test(svgCode) && !/onclick|onerror/i.test(svgCode)) {
      warnings.push('SVG 包含事件处理器属性，可能存在 XSS 风险');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 获取模板库中的 SVG 模板
   * @param templateName 模板名称
   * @param params 替换参数（如 color, fill, stroke, text 等）
   */
  getTemplate(
    templateName: string,
    params?: Record<string, string>
  ): string | null {
    const template = SVG_TEMPLATES[templateName];
    if (!template) return null;

    if (params) {
      let result = template;
      for (const [key, value] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
      return result;
    }

    return template;
  }

  /** 获取所有可用模板名称 */
  getTemplateNames(): string[] {
    return Object.keys(SVG_TEMPLATES);
  }
}

export function createImageSvgTool(): ImageSvgTool {
  return new ImageSvgTool();
}
