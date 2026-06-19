/**
 * ImageSvgTool
 * 通过 LLM 生成 SVG 矢量图
 * 适用于图标、流程图、图表、UI 元素等场景
 * 比调用 DALL-E 等图片 API 更经济（仅消耗文本 token）
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import aiService from '../../ai/index';
import type { AIMessage } from '../../ai/models/types';
import { AIMessageRole } from '../../ai/models/types';
import fs from 'node:fs';
import path from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

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
  /** 使用的模型（可选），默认使用 AI 服务默认模型 */
  model?: string;
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

export class ImageSvgTool extends BaseTool<ImageSvgInput, ImageSvgOutput> {
  name = 'image_svg_generate';

  description =
    'Generate SVG vector graphics using LLM. Ideal for icons, diagrams, logos, charts, UI elements, and simple illustrations. Much cheaper than image generation APIs (text tokens only).';

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
      description:
        'LLM model to use for SVG generation. Default uses AI service default.',
      required: false,
    },
  ];

  async execute(
    input: ImageSvgInput,
    _context: ToolUseContext
  ): Promise<ToolResult<ImageSvgOutput>> {
    const size = input.size ?? '64x64';
    const [width, height] = size.split('x').map(Number);

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
      const response = await aiService.generate(messages);

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

      let filePath: string | undefined;

      if (input.savePath) {
        const resolvedPath = path.resolve(input.savePath);
        const dir = path.dirname(resolvedPath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (!resolvedPath.endsWith('.svg')) {
          filePath = resolvedPath + '.svg';
        } else {
          filePath = resolvedPath;
        }

        fs.writeFileSync(filePath, svgCode, 'utf-8');
      }

      logger.info('ImageSvgTool · SVG 生成完成', {
        elapsed,
        hasFile: !!filePath,
        size,
      });
      return {
        success: true,
        data: {
          svg: svgCode,
          filePath,
          model: response.model || 'default',
          size,
        },
        output: filePath
          ? `已生成 SVG 文件：${filePath}\n\n\`\`\`svg\n${svgCode}\n\`\`\``
          : `\`\`\`svg\n${svgCode}\n\`\`\``,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ImageSvgTool · 生成失败', { error: errorMsg });
      return {
        success: false,
        error: `SVG 生成失败：${errorMsg}`,
      };
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
      if (match) {
        return match[0];
      }
    }

    // 如果没有任何包裹格式，但内容以 <svg 开头，直接返回
    if (svg.startsWith('<svg')) {
      return svg;
    }

    return null;
  }
}

export function createImageSvgTool(): ImageSvgTool {
  return new ImageSvgTool();
}
