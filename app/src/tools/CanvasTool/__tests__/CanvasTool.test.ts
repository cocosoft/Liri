/**
 * CanvasTool 核心功能测试
 * 验证执行逻辑、类型安全、UI 渲染方法
 */
import { describe, it, expect } from 'bun:test';
import { CanvasTool, createCanvasTool } from '../CanvasTool';
import type { CanvasOperation } from '../CanvasTool';

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
