/**
 * CanvasTool 核心功能测试
 * 验证执行逻辑、类型安全、UI 渲染方法
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasTool, createCanvasTool } from '@openliri/tool-media';
import type { CanvasOperation } from '@openliri/tool-media';

describe('CanvasTool', () => {
  it('应正确创建实例', () => {
    const tool = new CanvasTool();
    expect(tool).toBeInstanceOf(CanvasTool);
    expect(tool.name).toBe('canvas');
    expect(tool.description).toBeTruthy();
  });

  it('createCanvasTool 应返回 CanvasTool 实例', () => {
    const tool = createCanvasTool();
    expect(tool).toBeInstanceOf(CanvasTool);
  });

  it('应暴露正确的参数定义', () => {
    const tool = new CanvasTool();
    expect(tool.params).toBeDefined();
    expect(tool.params!.length).toBeGreaterThan(0);
    const actionParam = tool.params!.find((p) => p.name === 'action');
    expect(actionParam).toBeDefined();
    expect(actionParam!.required).toBe(true);
    expect(actionParam!.enum).toContain('create');
  });

  describe('execute', () => {
    it('create 操作应返回画布 ID', async () => {
      const tool = new CanvasTool();
      const input: CanvasOperation = {
        action: 'create',
        width: 800,
        height: 600,
      };
      const result = await tool.execute(input, {} as any);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as any).canvasId).toMatch(/^canvas_/);
      expect((result.data as any).width).toBe(800);
      expect((result.data as any).height).toBe(600);
      expect((result.data as any).elementCount).toBe(0);
    });

    it('应正确处理带元素的绘制操作', async () => {
      const tool = new CanvasTool();
      // 先创建画布获取 canvasId
      const createRes = await tool.execute({ action: 'create' }, {} as any);
      const canvasId = (createRes.data as any).canvasId;
      const input: CanvasOperation = {
        action: 'draw',
        canvasId,
        width: 1024,
        height: 768,
        elements: [
          {
            type: 'rect',
            x: 10,
            y: 10,
            width: 100,
            height: 100,
            color: '#ff0000',
          },
          {
            type: 'text',
            x: 50,
            y: 50,
            text: 'Hello',
            fontSize: 24,
          },
        ],
      };
      const result = await tool.execute(input, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any).elementCount).toBe(2);
    });

    it('应支持导出格式参数', async () => {
      const tool = new CanvasTool();
      const createRes = await tool.execute({ action: 'create' }, {} as any);
      const canvasId = (createRes.data as any).canvasId;
      const input: CanvasOperation = {
        action: 'export',
        canvasId,
        format: 'svg',
      };
      const result = await tool.execute(input, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any).format).toBe('svg');
    });

    it('import 操作缺少 elements 应返回失败', async () => {
      const tool = new CanvasTool();
      const input: CanvasOperation = {
        action: 'import' as any,
      };
      const result = await tool.execute(input, {} as any);
      expect(result.success).toBe(false);
      // P1-3（2026-11-28）：错误必须点明"只吃位图 + 正路"，否则模型只会换写法重试
      expect(String(result.error ?? '')).toContain('raster only');
      expect(String(result.error ?? '')).toContain('image_svg_generate');
    });

    /**
     * 2026-11-28 真机（`tools:canvas [export] Input buffer contains unsupported image format`，
     * `context.originalType: "object"`）：模型把 `image` 元素的 `src` 传成对象时，
     * 渲染层 `escapeXml(src)` 直接抛错、sharp 也会把坏输入带到 `pipeline.toBuffer()`，
     * 结果**整张画布导出失败**。现在非字符串 src 一律按"无图"处理（跳过该元素）。
     */
    it('图片元素 src 非字符串 ⇒ 导出成功且不写入 [object Object]', async () => {
      const tool = new CanvasTool();
      const createRes = await tool.execute({ action: 'create' }, {} as any);
      const canvasId = (createRes.data as any).canvasId;
      await tool.execute(
        {
          action: 'draw',
          canvasId,
          elements: [
            {
              type: 'rect',
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              color: '#000000',
            },
            {
              type: 'image',
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              src: { bad: true },
            },
          ],
        } as unknown as CanvasOperation,
        {} as any
      );

      const out = await tool.execute(
        { action: 'export', canvasId, format: 'svg' } as CanvasOperation,
        {} as any
      );
      expect(out.success).toBe(true);
      const svg = readFileSync((out.data as any).outputPath, 'utf8');
      expect(svg).not.toContain('[object Object]');
      expect(svg).toContain('<rect');
    });

    it('描述声明 SVG 能力边界（P1-3）', () => {
      const tool = new CanvasTool();
      expect(tool.description).toMatch(/RASTER/i);
      expect(tool.description).toContain('image_svg_generate');
    });

    /**
     * 2026-11-28：`sharp().toBuffer()` **不带输出格式**时返回的是原始像素缓冲，
     * 再喂回 sharp（composite / 格式转换）就会报 `Input buffer contains unsupported image format`
     * ⇒ canvas 的**位图导出与图片合成此前一直整体失败**（空画布也失败）。
     * 本用例用像素级断言锁死"图片元素真的被画进去"。
     */
    it('图片元素应真正合成进导出结果', async () => {
      const sharp = (await import('sharp')).default;
      const srcPath = join(tmpdir(), `canvas-src-${Date.now()}.png`);
      await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toFile(srcPath);

      const tool = new CanvasTool();
      const createRes = await tool.execute(
        { action: 'create', width: 40, height: 40 } as CanvasOperation,
        {} as any
      );
      const canvasId = (createRes.data as any).canvasId;
      await tool.execute(
        {
          action: 'draw',
          canvasId,
          elements: [
            { type: 'image', x: 0, y: 0, width: 40, height: 40, src: srcPath },
          ],
        } as unknown as CanvasOperation,
        {} as any
      );

      const out = await tool.execute(
        { action: 'export', canvasId, format: 'png' } as CanvasOperation,
        {} as any
      );
      expect(out.success).toBe(true);

      const { data, info } = await sharp((out.data as any).outputPath)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const center = (20 * info.width + 20) * info.channels;
      expect(data[center]).toBeGreaterThan(200); // R
      expect(data[center + 1]).toBeLessThan(60); // G
    });

    it('默认宽高应为 800x600', async () => {
      const tool = new CanvasTool();
      const input: CanvasOperation = { action: 'create' };
      const result = await tool.execute(input, {} as any);
      expect((result.data as any).width).toBe(800);
      expect((result.data as any).height).toBe(600);
    });
  });

  describe('UI 渲染方法', () => {
    it('renderToolUseMessage 应返回格式化的消息', () => {
      const tool = new CanvasTool();
      const input: CanvasOperation = {
        action: 'create',
        width: 800,
        height: 600,
      };
      const message = tool.renderToolUseMessage!(input, { verbose: false });
      expect(message).toContain('Canvas');
      expect(message).toContain('action=create');
      expect(message).toContain('width=800');
    });

    it('renderToolResultMessage 应在成功时返回画布摘要', () => {
      const tool = new CanvasTool();
      const result = {
        success: true,
        data: {
          canvasId: 'canvas_test_001',
          width: 800,
          height: 600,
          elementCount: 3,
          format: 'png',
        },
        output: 'Canvas create completed',
      };
      const message = tool.renderToolResultMessage!(result, [], {
        verbose: false,
      });
      expect(message).toContain('canvas_test_001');
      expect(message).toContain('3 elements');
    });

    it('renderToolResultMessage 应在失败时返回错误信息', () => {
      const tool = new CanvasTool();
      const result = { success: false, error: 'Something went wrong' };
      const message = tool.renderToolResultMessage!(result, [], {
        verbose: false,
      });
      expect(message).toContain('failed');
    });
  });
});
