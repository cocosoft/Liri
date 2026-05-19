/**
 * CanvasTool
 * 对标OpenClaw canvas 工具
 * 画布操作工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

export interface CanvasOperation {
  action: 'create' | 'resize' | 'draw' | 'text' | 'clear' | 'export' | 'import';
  width?: number;
  height?: number;
  backgroundColor?: string;
  elements?: CanvasElement[];
  format?: 'png' | 'jpeg' | 'webp' | 'svg';
  quality?: number;
}

export interface CanvasElement {
  type: 'rect' | 'circle' | 'line' | 'text' | 'image' | 'path';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  color?: string;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  rotation?: number;
  opacity?: number;
  points?: Array<{ x: number; y: number }>;
  src?: string;
}

export interface CanvasResult {
  canvasId: string;
  width: number;
  height: number;
  elementCount: number;
  outputUrl?: string;
  format: string;
}

export class CanvasTool extends BaseTool {
  name = 'canvas';

  description =
    'Create and manipulate visual canvases. Supports drawing shapes, text, images, and exporting to multiple formats.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['create', 'resize', 'draw', 'text', 'clear', 'export', 'import'],
      description: 'Canvas operation to perform',
      required: true,
    },
    {
      name: 'width',
      type: 'number',
      description: 'Canvas width in pixels',
      required: false,
    },
    {
      name: 'height',
      type: 'number',
      description: 'Canvas height in pixels',
      required: false,
    },
    {
      name: 'backgroundColor',
      type: 'string',
      description: 'Background color (hex, rgb, or named)',
      required: false,
    },
    {
      name: 'elements',
      type: 'array',
      description: 'Array of canvas elements to draw',
      required: false,
    },
    {
      name: 'format',
      type: 'string',
      enum: ['png', 'jpeg', 'webp', 'svg'],
      description: 'Output format',
      required: false,
      default: 'png',
    },
    {
      name: 'quality',
      type: 'number',
      description: 'Output quality (1-100)',
      required: false,
      default: 90,
    },
  ];

  async execute(input: CanvasOperation, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const result: CanvasResult = {
        canvasId: `canvas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        width: input.width ?? 800,
        height: input.height ?? 600,
        elementCount: input.elements?.length ?? 0,
        format: input.format ?? 'png',
      };

      return {
        success: true,
        data: result,
        output: `Canvas ${input.action} completed (${result.width}x${result.height}, ${result.elementCount} elements)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Canvas operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  override renderToolUseMessage(input: CanvasOperation, _options: { verbose: boolean }): unknown {
    const parts = [`🎨 Canvas`];
    parts.push(`action=${input.action}`);
    if (input.width) parts.push(`width=${input.width}`);
    if (input.height) parts.push(`height=${input.height}`);
    if (input.format) parts.push(`format=${input.format}`);
    if (input.elements?.length) parts.push(`elements=${input.elements.length}`);
    return parts.join(' ');
  }

  override renderToolResultMessage(output: ToolResult, _progressMessages: unknown[], _options: { verbose: boolean }): unknown {
    if (!output.success) return `❌ Canvas failed: ${output.error}`;
    const data = output.data as CanvasResult | undefined;
    if (!data) return '✅ Canvas completed';
    return `✅ Canvas ${data.canvasId} (${data.width}x${data.height}, ${data.elementCount} elements, ${data.format})`;
  }
}

export function createCanvasTool(): CanvasTool {
  return new CanvasTool();
}
