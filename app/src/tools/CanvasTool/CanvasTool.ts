/**
 * CanvasTool
 * 画布操作工具 — 支持创建画布、绘制图形/文字/图片、导出多格式
 *
 * 渲染管线：Sharp (基础 + 格式转换) + SVG 层 (图形/文字/路径)
 * 实例生命周期：canvasId → CanvasInstance 注册表，15 分钟无操作自动清理
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { resolveOutputDir, resolvePyappHome } from '@modules/core/paths';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types';
import { CanvasInstance } from './CanvasInstance';
import type { CanvasElement, ExportOptions } from './CanvasInstance';

const logger = new Logger({ level: LogLevel.INFO, module: 'tools:canvas' });

/** 画布实例自动清理间隔 (ms) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/** 画布实例空闲 TTL (ms) — 15 分钟无操作则销毁 */
const INSTANCE_IDLE_TTL_MS = 15 * 60 * 1000;

/**
 * 路径白名单验证
 * 仅允许访问 ~/.pyapp/ 和项目目录下的路径，防止任意文件读取
 */
function isValidImagePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const pyappHome = resolvePyappHome();
  const projectDir = process.env.PYAPP_PROJECT_DIR || process.cwd();

  // 允许 ~/.pyapp/ 下的路径
  if (resolved.startsWith(pyappHome)) return true;

  // 允许项目目录下的路径
  if (resolved.startsWith(projectDir)) return true;

  // 允许系统临时目录（用于跨工具传递中间产物）
  if (resolved.startsWith(os.tmpdir())) return true;

  return false;
}

/** 支持的画布操作 */
export interface CanvasOperation {
  action: 'create' | 'draw' | 'text' | 'clear' | 'export' | 'import';
  canvasId?: string;
  width?: number;
  height?: number;
  backgroundColor?: string;
  elements?: CanvasElement[];
  format?: 'png' | 'jpeg' | 'webp' | 'svg';
  quality?: number;
}

/** 画布操作结果 */
export interface CanvasResult {
  canvasId: string;
  width: number;
  height: number;
  elementCount: number;
  outputPath?: string;
  format: string;
}

/** 全局画布实例注册表 (canvasId → CanvasInstance) */
const canvasRegistry = new Map<string, CanvasInstance>();

/** 定时清理器句柄 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动定时清理器
 * 每 5 分钟扫描注册表，销毁空闲超过 15 分钟的实例
 */
function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, instance] of canvasRegistry) {
      if (now - instance['lastAccessedAt'] > INSTANCE_IDLE_TTL_MS) {
        canvasRegistry.delete(id);
        cleaned += 1;
      }
    }
    if (cleaned > 0) {
      logger.info('CanvasTool · 自动清理空闲实例', {
        cleaned,
        remaining: canvasRegistry.size,
      });
    }
  }, CLEANUP_INTERVAL_MS);
  // 允许进程退出（不阻止事件循环）
  if (
    cleanupTimer &&
    typeof cleanupTimer === 'object' &&
    'unref' in cleanupTimer
  ) {
    (
      cleanupTimer as ReturnType<typeof setInterval> & { unref(): void }
    ).unref();
  }
}

/**
 * 输出图片的持久化路径
 * @param canvasId 画布 ID
 * @param format 文件格式
 */
function resolveOutputPath(canvasId: string, format: string): string {
  const ext = format === 'jpeg' ? 'jpg' : format;
  const outputDir = resolveOutputDir();
  const imagesDir = path.join(outputDir, 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }
  return path.join(imagesDir, `${canvasId}_${Date.now()}.${ext}`);
}

export class CanvasTool extends BaseTool {
  name = 'canvas';

  description =
    'Create and manipulate visual canvases. Supports drawing shapes (rect, circle, line, path), ' +
    'text, image import, and exporting to PNG/JPEG/WebP/SVG. Use when the user asks to create ' +
    'a diagram, draw on an image, add text annotations, or build a visual composition. ' +
    'Use create to start, then chain draw/text, and export to produce the final image.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['create', 'draw', 'text', 'clear', 'export', 'import'],
      description: 'Canvas operation: create(canvas) → draw/text → export',
      required: true,
    },
    {
      name: 'canvasId',
      type: 'string',
      description:
        'Canvas instance ID. Required for draw/text/clear/export, returned by create.',
      required: false,
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
      description: 'Background color (hex, e.g. #ffffff)',
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

  async execute(
    input: CanvasOperation,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      ensureCleanupTimer();

      switch (input.action) {
        case 'create':
          return await this.handleCreate(input);
        case 'draw':
          return this.handleDraw(input);
        case 'text':
          return this.handleText(input);
        case 'clear':
          return this.handleClear(input);
        case 'export':
          return await this.handleExport(input);
        case 'import':
          return await this.handleImport(input);
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error) {
      await handleError(error, {
        module: 'tools:canvas',
        action: input.action,
      });
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Canvas operation failed: ${msg}` };
    }
  }

  /** 创建新画布实例 */
  private async handleCreate(input: CanvasOperation): Promise<ToolResult> {
    const width = input.width ?? 800;
    const height = input.height ?? 600;
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      return { success: false, error: 'Width and height must be 1-8192' };
    }

    const instance = new CanvasInstance({
      width,
      height,
      backgroundColor: input.backgroundColor,
    });
    canvasRegistry.set(instance.canvasId, instance);
    instance.touch();

    logger.info('CanvasTool · 创建画布', {
      canvasId: instance.canvasId,
      width,
      height,
    });

    const result: CanvasResult = {
      canvasId: instance.canvasId,
      width,
      height,
      elementCount: 0,
      format: 'png',
    };
    return {
      success: true,
      data: result,
      output: `Canvas created: ${result.canvasId} (${width}x${height}). Use this canvasId for subsequent draw/text/export operations.`,
    };
  }

  /** 在画布上绘制图形元素 */
  private handleDraw(input: CanvasOperation): ToolResult {
    const instance = this.getOrError(input.canvasId);
    if (!instance) return this.noInstanceError(input.canvasId);

    const elements = input.elements ?? [];
    instance.addElements(elements);

    const result: CanvasResult = {
      canvasId: instance.canvasId,
      width: instance.width,
      height: instance.height,
      elementCount: instance.elementCount,
      format: 'png',
    };
    return {
      success: true,
      data: result,
      output: `Drew ${elements.length} element(s) on canvas ${instance.canvasId} (total: ${instance.elementCount})`,
    };
  }

  /** 在画布上绘制文字（便捷方法，等价于 draw + text element） */
  private handleText(input: CanvasOperation): ToolResult {
    const instance = this.getOrError(input.canvasId);
    if (!instance) return this.noInstanceError(input.canvasId);

    // 从 elements 中提取 text 类型元素，其余作为普通图形添加
    const elements = input.elements ?? [];
    const textElements = elements.filter((e) => e.type === 'text');
    const nonTextElements = elements.filter((e) => e.type !== 'text');

    if (textElements.length > 0) {
      instance.addElements(textElements);
    }
    if (nonTextElements.length > 0) {
      instance.addElements(nonTextElements);
    }

    const result: CanvasResult = {
      canvasId: instance.canvasId,
      width: instance.width,
      height: instance.height,
      elementCount: instance.elementCount,
      format: 'png',
    };
    return {
      success: true,
      data: result,
      output: `Added text to canvas ${instance.canvasId} (total elements: ${instance.elementCount})`,
    };
  }

  /** 清空画布上的所有元素 */
  private handleClear(input: CanvasOperation): ToolResult {
    const instance = this.getOrError(input.canvasId);
    if (!instance) return this.noInstanceError(input.canvasId);

    // 重新创建实例替换旧的
    const newInstance = new CanvasInstance({
      width: instance.width,
      height: instance.height,
    });
    // 保留原 canvasId
    (newInstance as unknown as Record<string, unknown>)['canvasId'] =
      instance.canvasId;
    canvasRegistry.set(instance.canvasId, newInstance);

    const result: CanvasResult = {
      canvasId: newInstance.canvasId,
      width: newInstance.width,
      height: newInstance.height,
      elementCount: 0,
      format: 'png',
    };
    return {
      success: true,
      data: result,
      output: `Canvas ${instance.canvasId} cleared`,
    };
  }

  /** 导出画布为图片文件 */
  private async handleExport(input: CanvasOperation): Promise<ToolResult> {
    const instance = this.getOrError(input.canvasId);
    if (!instance) return this.noInstanceError(input.canvasId);

    const format = input.format ?? 'png';
    const quality = input.quality ?? 90;

    try {
      const buffer = await instance.export({
        format,
        quality,
      } as ExportOptions);
      const outputPath = resolveOutputPath(instance.canvasId, format);
      fs.writeFileSync(outputPath, buffer);

      const result: CanvasResult = {
        canvasId: instance.canvasId,
        width: instance.width,
        height: instance.height,
        elementCount: instance.elementCount,
        outputPath,
        format,
      };

      logger.info('CanvasTool · 导出画布', {
        canvasId: instance.canvasId,
        format,
        path: outputPath,
        size: buffer.length,
      });

      const sizeKB = (buffer.length / 1024).toFixed(1);
      return {
        success: true,
        data: result,
        output: `Canvas ${instance.canvasId} exported as ${format} (${sizeKB} KB, ${instance.elementCount} elements)\nPath: ${outputPath}`,
      };
    } catch (error) {
      await handleError(error, {
        module: 'tools:canvas',
        action: 'export',
      });
      logger.error('CanvasTool · 导出失败', {
        canvasId: instance.canvasId,
        error: String(error),
      });
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Export failed: ${msg}` };
    }
  }

  /** 导入外部图片作为新画布 */
  private async handleImport(input: CanvasOperation): Promise<ToolResult> {
    if (!input.elements || input.elements.length === 0) {
      return {
        success: false,
        error: 'Import requires at least one image element with src',
      };
    }

    const imgElem = input.elements[0];
    if (!imgElem.src) {
      return {
        success: false,
        error: 'Import requires element.src (file path)',
      };
    }

    // 路径白名单安全检查
    if (!isValidImagePath(imgElem.src)) {
      logger.warn('CanvasTool · 导入路径不在白名单中', { src: imgElem.src });
      return {
        success: false,
        error: `Access denied: image path is not in the allowed directories. Only paths under ~/.pyapp/, project directory, and temp are allowed.`,
      };
    }

    try {
      // 读取图片尺寸
      const meta = await import('sharp').then((m) =>
        m.default(imgElem.src).metadata()
      );

      const width = meta.width ?? 800;
      const height = meta.height ?? 600;

      const instance = new CanvasInstance({
        width,
        height,
        backgroundColor: input.backgroundColor,
      });
      canvasRegistry.set(instance.canvasId, instance);

      // 将导入图片作为底层元素
      instance.addElements([
        {
          type: 'image',
          x: 0,
          y: 0,
          width,
          height,
          src: imgElem.src,
        },
      ]);

      const result: CanvasResult = {
        canvasId: instance.canvasId,
        width,
        height,
        elementCount: instance.elementCount,
        format: 'png',
      };
      return {
        success: true,
        data: result,
        output: `Image imported as canvas ${instance.canvasId} (${width}x${height})`,
      };
    } catch (error) {
      await handleError(error, { module: 'tools:canvas', action: 'import' });
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Import failed: ${msg}` };
    }
  }

  /** 获取画布实例或返回错误 */
  private getOrError(canvasId?: string): CanvasInstance | null {
    if (!canvasId) return null;
    return canvasRegistry.get(canvasId) ?? null;
  }

  /** 画布实例不存在的错误响应 */
  private noInstanceError(canvasId?: string): ToolResult {
    return {
      success: false,
      error: `Canvas instance not found: canvasId="${canvasId ?? 'undefined'}". Did you call 'create' first?`,
    };
  }

  // ---- 渲染方法 ----

  override renderToolUseMessage(
    input: CanvasOperation,
    _options: { verbose: boolean }
  ): unknown {
    const parts = ['🎨 Canvas'];
    parts.push(`action=${input.action}`);
    if (input.canvasId)
      parts.push(`canvasId=${input.canvasId.slice(0, 16)}...`);
    if (input.width) parts.push(`width=${input.width}`);
    if (input.height) parts.push(`height=${input.height}`);
    if (input.format) parts.push(`format=${input.format}`);
    if (input.elements?.length) parts.push(`elements=${input.elements.length}`);
    return parts.join(' ');
  }

  override renderToolResultMessage(
    output: ToolResult,
    _progressMessages: unknown[],
    _options: { verbose: boolean }
  ): unknown {
    if (!output.success) return `❌ Canvas failed: ${output.error}`;
    const data = output.data as CanvasResult | undefined;
    if (!data) return '✅ Canvas completed';
    const pathInfo = data.outputPath ? ` → ${data.outputPath}` : '';
    return `✅ Canvas ${data.canvasId} (${data.width}x${data.height}, ${data.elementCount} elements, ${data.format})${pathInfo}`;
  }
}

export function createCanvasTool(): CanvasTool {
  return new CanvasTool();
}
