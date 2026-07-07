/**
 * ImageContextService 单元测试
 * 测试会话级图片路径注册、路径匹配、图像上下文跟踪
 */
import { describe, it, expect } from 'bun:test';
import { ImageContextService } from '../ImageContextService';

const SESSION = 'test-session-001';
const SESSION2 = 'test-session-002';

describe('ImageContextService - registerImagePaths / getKnownImagePaths', () => {
  it('空 sessionId 不注册', () => {
    const svc = new ImageContextService();
    svc.registerImagePaths('', ['/a/b.png']);
    expect(svc.getKnownImagePaths('')).toEqual([]);
  });

  it('空路径数组不注册', () => {
    const svc = new ImageContextService();
    svc.registerImagePaths(SESSION, []);
    expect(svc.getKnownImagePaths(SESSION)).toEqual([]);
  });

  it('正常注册后可通过 getKnownImagePaths 获取', () => {
    const svc = new ImageContextService();
    svc.registerImagePaths(SESSION, ['/a/b.png', '/c/d.jpg']);
    const paths = svc.getKnownImagePaths(SESSION);
    expect(paths).toHaveLength(2);
    expect(paths).toContain('/a/b.png');
    expect(paths).toContain('/c/d.jpg');
  });

  it('多次注册应追加去重', () => {
    const svc = new ImageContextService();
    svc.registerImagePaths(SESSION, ['/a/b.png']);
    svc.registerImagePaths(SESSION, ['/a/b.png', '/c/d.jpg']);
    const paths = svc.getKnownImagePaths(SESSION);
    expect(paths).toHaveLength(2);
  });

  it('不同会话独立存储', () => {
    const svc = new ImageContextService();
    svc.registerImagePaths(SESSION, ['/a/b.png']);
    svc.registerImagePaths(SESSION2, ['/c/d.jpg']);
    expect(svc.getKnownImagePaths(SESSION)).toEqual(['/a/b.png']);
    expect(svc.getKnownImagePaths(SESSION2)).toEqual(['/c/d.jpg']);
  });

  it('未注册的会话返回空数组', () => {
    const svc = new ImageContextService();
    expect(svc.getKnownImagePaths('nonexistent')).toEqual([]);
  });
});

describe('ImageContextService - findClosestPath', () => {
  it('已知路径为空时返回 null', () => {
    const svc = new ImageContextService();
    expect(svc.findClosestPath('/a/b.png', [])).toBeNull();
  });

  it('精确匹配时返回自身', () => {
    const svc = new ImageContextService();
    const known = ['/a/b.png', '/c/d.jpg'];
    expect(svc.findClosestPath('/a/b.png', known)).toBe('/a/b.png');
  });

  it('文件名相同但路径不同时返回已知路径', () => {
    const svc = new ImageContextService();
    const known = ['/real/path/b.png'];
    expect(svc.findClosestPath('/fake/path/b.png', known)).toBe(
      '/real/path/b.png'
    );
  });

  it('无匹配文件名时返回 null', () => {
    const svc = new ImageContextService();
    const known = ['/a/b.png'];
    expect(svc.findClosestPath('/a/c.jpg', known)).toBeNull();
  });
});

describe('ImageContextService - extractImagePathsFromResult', () => {
  it('image_generate 提取 images[].filePath 和 localUrl', () => {
    const svc = new ImageContextService();
    const result = {
      images: [
        { filePath: '/a/gen.png', localUrl: '/v1/images/static/gen.png' },
      ],
    };
    const paths = svc.extractImagePathsFromResult('image_generate', result);
    expect(paths).toContain('/a/gen.png');
    expect(paths).toContain('/v1/images/static/gen.png');
  });

  it('image 工具提取 outputPath', () => {
    const svc = new ImageContextService();
    const result = { outputPath: '/a/edited.png' };
    expect(svc.extractImagePathsFromResult('image', result)).toEqual([
      '/a/edited.png',
    ]);
  });

  it('image_svg_generate 提取 savePath', () => {
    const svc = new ImageContextService();
    const result = { savePath: '/a/svg_output.svg' };
    expect(
      svc.extractImagePathsFromResult('image_svg_generate', result)
    ).toEqual(['/a/svg_output.svg']);
  });

  it('canvas 提取 outputPath', () => {
    const svc = new ImageContextService();
    const result = { outputPath: '/a/canvas.png' };
    expect(svc.extractImagePathsFromResult('canvas', result)).toEqual([
      '/a/canvas.png',
    ]);
  });

  it('未知工具名返回空数组', () => {
    const svc = new ImageContextService();
    expect(svc.extractImagePathsFromResult('unknown_tool', {})).toEqual([]);
  });

  it('无相关字段返回空数组', () => {
    const svc = new ImageContextService();
    expect(svc.extractImagePathsFromResult('image_generate', {})).toEqual([]);
  });
});

describe('ImageContextService - updateImageContext / getImageContext', () => {
  it('未更新过的会话返回 undefined', () => {
    const svc = new ImageContextService();
    expect(svc.getImageContext(SESSION)).toBeUndefined();
  });

  it('image_generate 更新 lastGeneratedImage', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'image_generate',
      { prompt: 'a cat' },
      { images: [{ filePath: '/a/gen.png' }] }
    );
    const ctx = svc.getImageContext(SESSION);
    expect(ctx?.lastGeneratedImage).toEqual({
      filePath: '/a/gen.png',
      prompt: 'a cat',
    });
  });

  it('image 更新 lastEditedImage', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'image',
      { action: 'resize' },
      { outputPath: '/a/resized.png' }
    );
    const ctx = svc.getImageContext(SESSION);
    expect(ctx?.lastEditedImage).toEqual({
      filePath: '/a/resized.png',
      action: 'resize',
    });
  });

  it('image_analysis 更新 lastAnalyzedImage', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'image_analysis',
      { inputPath: '/a/analyzed.png' },
      {}
    );
    const ctx = svc.getImageContext(SESSION);
    expect(ctx?.lastAnalyzedImage).toEqual({
      filePath: '/a/analyzed.png',
      action: '',
    });
  });

  it('canvas 更新 lastEditedImage', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'canvas',
      { action: 'draw' },
      { outputPath: '/a/canvas.png' }
    );
    const ctx = svc.getImageContext(SESSION);
    expect(ctx?.lastEditedImage).toEqual({
      filePath: '/a/canvas.png',
      action: 'draw',
    });
  });

  it('canvas 无 action 时回退为 export', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'canvas',
      {},
      { outputPath: '/a/canvas.png' }
    );
    const ctx = svc.getImageContext(SESSION);
    expect(ctx?.lastEditedImage?.action).toBe('export');
  });

  it('多个工具操作累积上下文', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'image_generate',
      { prompt: 'cat' },
      {
        images: [{ filePath: '/a/gen.png' }],
      }
    );
    svc.updateImageContext(
      SESSION,
      'image',
      { action: 'resize' },
      {
        outputPath: '/a/resized.png',
      }
    );
    const ctx = svc.getImageContext(SESSION);
    expect(ctx?.lastGeneratedImage?.filePath).toBe('/a/gen.png');
    expect(ctx?.lastEditedImage?.filePath).toBe('/a/resized.png');
  });
});

describe('ImageContextService - buildImageContextPrompt', () => {
  it('无上下文时返回空字符串', () => {
    const svc = new ImageContextService();
    expect(svc.buildImageContextPrompt(SESSION)).toBe('');
  });

  it('有生成图片时包含文件路径和提示词', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'image_generate',
      { prompt: 'a cat' },
      {
        images: [{ filePath: '/a/gen.png' }],
      }
    );
    const prompt = svc.buildImageContextPrompt(SESSION);
    expect(prompt).toContain('/a/gen.png');
    expect(prompt).toContain('a cat');
    expect(prompt).toContain('最近生成的图片');
  });

  it('有编辑图片时包含操作信息', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'image',
      { action: 'resize' },
      {
        outputPath: '/a/resized.png',
      }
    );
    const prompt = svc.buildImageContextPrompt(SESSION);
    expect(prompt).toContain('/a/resized.png');
    expect(prompt).toContain('resize');
    expect(prompt).toContain('最近编辑的图片');
  });

  it('有分析图片时包含路径', () => {
    const svc = new ImageContextService();
    svc.updateImageContext(
      SESSION,
      'image_analysis',
      {
        inputPath: '/a/analyzed.png',
      },
      {}
    );
    const prompt = svc.buildImageContextPrompt(SESSION);
    expect(prompt).toContain('/a/analyzed.png');
    expect(prompt).toContain('最近分析的图片');
  });

  it('提示词超过 100 字符时截断', () => {
    const svc = new ImageContextService();
    const longPrompt = 'x'.repeat(200);
    svc.updateImageContext(
      SESSION,
      'image_generate',
      { prompt: longPrompt },
      {
        images: [{ filePath: '/a/gen.png' }],
      }
    );
    const prompt = svc.buildImageContextPrompt(SESSION);
    expect(prompt).not.toContain(longPrompt);
    expect(prompt).toContain('x'.repeat(100));
  });
});
